import React, { useMemo, useState, useEffect, useRef, Suspense } from "react";
import { Download, Settings2, RefreshCw, X, WifiOff } from "lucide-react";
const LazyWeekView = React.lazy(() => import("./WeekView"));

/**
 * ========================= Remediation Plan for Console Warnings/Errors =========================
 *
 * You reported these at app start:
 * 1) Intercom not booted or setup incomplete. => External script; we do NOT load Intercom here.
 *    - Action: No change in app. If you embed Intercom later, ensure window.Intercom is configured before boot.
 * 2) Autofocus processing blocked... => Happens if a page tries autofocus when focus already present.
 *    - Action: We avoid autofocus attrs. We also manage focus explicitly in fullscreen dialogs.
 * 3) gapi OAuth: client_id and scope must both be provided => External Google API init elsewhere.
 *    - Action: Not from this app. Ensure any gapi.init includes client_id & scope.
 * 4) t1.gstatic.com favicon 404s => Harmless network fetch for favicons.
 *    - Action: None required.
 * 5) TextSelection endpoint not pointing into a node... => Likely from a rich-text editor extension/content-script.
 *    - Action: None inside this codebase.
 * 6) "Blocked aria-hidden ... descendant retained focus" => Can happen when opening overlays without moving focus.
 *    - Action: We added a11y-safe modal handling with focus trap + background "inert" while overlays are open.
 * 7) "null undefined" from a third-party bundle => External.
 * 8) /backend-api/celsius/ws/user net::ERR_INTERNET_DISCONNECTED => Network state.
 *    - Action: We added a small Offline banner that reacts to navigator.onLine.
 *
 * Code changes in this file:
 *  - Single declaration of dayOrderMonStart (fixed duplicate identifier error).
 *  - A11y-focused overlay management (role="dialog", aria-modal, focus trap, inert background, scroll lock).
 *  - LocalStorage-persistent Settings collapse + keyboard toggle (S).
 *  - OfflineBanner for visibility when offline.
 *  - Kept and expanded self-tests.
 * ===============================================================================================
 */

// ------------------------- Types -------------------------
export type DistanceKey = "70.3" | "140.6";
export type Philosophy = "polarized" | "pyramidal";

export type Session = {
  id: string;
  sport: "Swim" | "Bike" | "Run" | "Strength" | "Mobility";
  day: number; // 0..6, where 0=Sun ... 6=Sat
  title: string;
  focus: string; // Endurance, Tempo, Threshold, VO2, Technique, Recovery
  durationMin: number;
  details: string;
  intensityZone: "Z1" | "Z2" | "Z3" | "Z4" | "Z5" | "Mixed";
  optional?: boolean;
  missed?: boolean; // user can mark
};

export type WeekPlan = {
  weekIndex: number;
  phase: "Base" | "Build" | "Peak" | "Taper" | "Recovery";
  totalMin: number;
  sessions: Session[];
  notes: string[]; // nutrition & recovery highlights
};

// ------------------------- Helpers -------------------------
const DUR = {
  STR: 45, // strength (min)
  MOB: 20, // mobility (min)
};

// ✅ FIX: Provide a defined defaultAvailability (used by useState)
const defaultAvailability = {
  longRideDay: 6, // Saturday
  longRunDay: 0, // Sunday
  restDay: 1, // Monday
};


function uid(prefix = "s") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// --- Color system (Tailwind utility maps) ---
// (moved to WeekView chunk) helper removed here to avoid duplication

// ------------------------- Generator Core -------------------------
function getPeakHours(distance: DistanceKey) {
  return distance === "70.3" ? 12 : 16; // intermediate targets (hours)
}

function splitPhases(totalWeeks: number) {
  // Base 40%, Build 30%, Peak 20%, Taper 10%
  const base = Math.max(4, Math.round(totalWeeks * 0.4));
  const build = Math.max(3, Math.round(totalWeeks * 0.3));
  const peak = Math.max(2, Math.round(totalWeeks * 0.2));
  const taper = Math.max(1, totalWeeks - base - build - peak);
  return { base, build, peak, taper };
}

function weeklyVolumeSeries(totalWeeks: number, peakHours: number) {
  const { base, build, peak, taper } = splitPhases(totalWeeks);
  const series: number[] = [];
  const peakMin = peakHours * 60;
  const startMin = Math.round(peakMin * 0.6);
  const total = base + build + peak + taper;

  let current = startMin;
  for (let w = 0; w < total; w++) {
    // Every 4th week = recovery (~70% of previous) except taper section
    if ((w + 1) % 4 === 0 && w < total - taper) {
      current = Math.round(current * 0.7);
      series.push(current);
      continue;
    }
    // Phase-based ramp
    const phase = w < base ? "Base" : w < base + build ? "Build" : w < base + build + peak ? "Peak" : "Taper";

    if (phase === "Base") current = Math.min(current + 60 * 1.0, Math.round(peakMin * 0.85)); // +1h
    if (phase === "Build") current = Math.min(current + 60 * 0.75, Math.round(peakMin * 0.95));
    if (phase === "Peak") current = Math.min(peakMin, Math.round(current + 60 * 0.5));
    if (phase === "Taper") current = Math.round(peakMin * (w === total - 1 ? 0.5 : 0.7));

    series.push(current);
  }
  return series;
}

function phaseOfWeek(w: number, totalWeeks: number): WeekPlan["phase"] {
  const { base, build, peak, taper } = splitPhases(totalWeeks);
  if (w < base) return "Base";
  if (w < base + build) return "Build";
  if (w < base + build + peak) return "Peak";
  if (w < base + build + peak + taper) return "Taper";
  return "Base";
}

function disciplineSplit(distance: DistanceKey) {
  // % of weekly minutes to Swim/Bike/Run. Bike dominates long-course
  return distance === "70.3"
    ? { Swim: 0.2, Bike: 0.5, Run: 0.3 }
    : { Swim: 0.18, Bike: 0.52, Run: 0.3 };
}

// Reserved for future use
// function intensityDistribution(philosophy: Philosophy) {
//   // Returns fraction of HARD minutes (Z3+)
//   if (philosophy === "polarized") return { hard: 0.2, easy: 0.8 };
//   return { hard: 0.35, easy: 0.65 }; // pyramidal has more tempo/threshold
// }

function buildWeek(
  wIndex: number,
  totalWeeks: number,
  distance: DistanceKey,
  minutes: number,
  _philosophy: Philosophy, // reserved for future use
  availability: { longRideDay: number; longRunDay: number; restDay: number },
  includeStrength: boolean,
  includeMobility: boolean,
  adaptFatigue: boolean
): WeekPlan {
  const phase = phaseOfWeek(wIndex, totalWeeks);
  // split, distMin, and intensityDistribution reserved for future use
  // const split = disciplineSplit(distance);
  // const distMin = {
  //   Swim: Math.round(minutes * split.Swim),
  //   Bike: Math.round(minutes * split.Bike),
  //   Run: Math.round(minutes * split.Run),
  // };
  // intensityDistribution(philosophy);

  // Long sessions
  const longBikeMin = distance === "70.3" ? (phase === "Peak" ? 210 : 180) : phase === "Peak" ? 330 : 300; // 3–3.5h vs 5–5.5h
  const longRunMin = distance === "70.3" ? (phase === "Peak" ? 110 : 90) : phase === "Peak" ? 160 : 140; // 1.5–1.8h vs 2.3–2.6h

  const sessions: Session[] = [];

  // Rest day – keep it light
  const restDay = availability.restDay;

  // Swim x3: Technique, Endurance, Threshold/Tempo
  for (let i = 0; i < 3; i++) {
    const day = (2 + i * 2) % 7; // Tue/Thu/Sat baseline
    sessions.push({
      id: uid("sw"),
      sport: "Swim",
      day,
      title: i === 0 ? "Swim – Technique & Drills" : i === 1 ? "Swim – Endurance" : "Swim – Threshold/Tempo",
      focus: i === 0 ? "Technique" : i === 1 ? "Endurance" : phase === "Base" ? "Tempo" : "Threshold",
      durationMin: i === 1 ? 60 : 50,
      details:
        i === 0
          ? "WU 10m easy + 8–12×50m drills (catch, scull, 6-1-6) w/ 20s rest + CD"
          : i === 1
          ? "Continuous aerobic. Breathe bilateral. Add pull buoy / paddles optional."
          : "WU + 4–6×400m @ CSS/threshold w/ 45s rest + CD",
      intensityZone: i === 1 ? "Z2" : i === 0 ? "Mixed" : phase === "Base" ? "Z3" : "Z4",
    });
  }

  // Bike x3: long, intervals, tempo
  for (let i = 0; i < 3; i++) {
    const day = i === 0 ? availability.longRideDay : (3 + i) % 7;
    const isLong = i === 0;
    sessions.push({
      id: uid("bk"),
      sport: "Bike",
      day,
      title: isLong ? "Bike – Long Endurance" : i === 1 ? "Bike – Intervals" : "Bike – Aerobic Tempo",
      focus: isLong ? "Endurance" : i === 1 ? (phase === "Base" ? "Tempo" : "Threshold") : "Tempo",
      durationMin: isLong ? longBikeMin : i === 1 ? 75 : 60,
      details: isLong
        ? "Steady Z2. Practice fueling: 60–90g carbs/h + electrolytes. Stay aero."
        : i === 1
        ? phase === "Base"
          ? "WU + 3×10m @ Z3 w/ 5m Z1 between + CD"
          : "WU + 5×8m @ Z4 (FTP-ish) w/ 4m Z1 between + CD"
        : "Aerobic tempo Z2–Z3 continuous. High cadence blocks 2×10m.",
      intensityZone: isLong ? "Z2" : i === 1 ? (phase === "Base" ? "Z3" : "Z4") : "Z3",
    });
  }

  // Optional Brick (Bike->Run)
  sessions.push({
    id: uid("brk"),
    sport: "Run",
    day: availability.longRideDay,
    title: "Brick Run – Off the Bike",
    focus: "Tempo",
    durationMin: distance === "70.3" ? 30 : 40,
    details: "Immediately after ride: steady Z2–Z3. Quick cadence, relaxed upper body.",
    intensityZone: "Z3",
    optional: true,
  });

  // Run x3: long, intervals/threshold, easy
  for (let i = 0; i < 3; i++) {
    const isLong = i === 0;
    const day = isLong ? availability.longRunDay : (4 + i) % 7; // Sun long run by default
    sessions.push({
      id: uid("rn"),
      sport: "Run",
      day,
      title: isLong ? "Run – Long Endurance" : i === 1 ? "Run – Intervals/Threshold" : "Run – Easy + Strides",
      focus: isLong ? "Endurance" : phase === "Base" ? "Tempo" : "Threshold",
      durationMin: isLong ? longRunMin : i === 1 ? 60 : 45,
      details: isLong
        ? "Steady Z2. Final 15m slightly faster if fresh. Fuel 30–60g carbs/h, hydrate."
        : phase === "Base"
        ? "WU + 3×8m @ Z3 w/ 3m easy + CD"
        : "WU + 5×6m @ Z4 w/ 3m easy + CD",
      intensityZone: isLong ? "Z2" : phase === "Base" ? "Z3" : "Z4",
    });
  }

  // Strength & Mobility
  if (includeStrength) {
    sessions.push({ id: uid("st"), sport: "Strength", day: 1, title: "Strength – Full Body A", focus: "Strength", durationMin: DUR.STR, details: "Squat/hinge/push/pull/core. 2–3×6–8 reps. Quality movement.", intensityZone: "Mixed" });
    sessions.push({ id: uid("st"), sport: "Strength", day: 5, title: "Strength – Full Body B", focus: "Strength", durationMin: DUR.STR, details: "Single-leg work + posterior chain + anti-rotation core.", intensityZone: "Mixed" });
  }
  if (includeMobility) {
    sessions.push({ id: uid("mb"), sport: "Mobility", day: restDay, title: "Mobility – Reset", focus: "Mobility", durationMin: DUR.MOB, details: "Hips, T-spine, calves, shoulders. 10–12 drills.", intensityZone: "Mixed" });
    sessions.push({ id: uid("mb"), sport: "Mobility", day: 3, title: "Mobility – Post-Run", focus: "Mobility", durationMin: DUR.MOB, details: "After run: calves, hamstrings, hip flexors. 30–60s holds.", intensityZone: "Mixed" });
  }

  // Shift sessions off the rest day (mobility allowed)
  sessions.forEach(s => {
    if (s.day === restDay && s.sport !== "Mobility") {
      s.day = (s.day + 1) % 7; // push to next day
    }
  });

  // Adjust total minutes to match weekly target roughly
  const currentTotal = sessions.reduce((a, b) => a + b.durationMin, 0);
  const scale = minutes / Math.max(currentTotal, 1);
  sessions.forEach(s => {
    if (["Strength", "Mobility"].includes(s.sport)) return; // keep fixed
    s.durationMin = Math.max(20, Math.round(s.durationMin * scale));
  });

  // Adaptation: if fatigued, reduce hard work and convert a hard session to easy
  if (adaptFatigue) {
    sessions.forEach(s => {
      if (["Bike", "Run", "Swim"].includes(s.sport) && ["Z3", "Z4", "Z5"].includes(s.intensityZone)) {
        s.intensityZone = "Z2";
        s.details = `Adapted for fatigue: ${s.details.replace(/@.*? /, "")}`;
        s.title = s.title.replace(/ – .+$/, " – Aerobic");
      }
    });
  }

  // Week notes (nutrition & recovery)
  const notes: string[] = [];
  notes.push("Fuel long sessions: 60–90g carbs/h on bike, 30–60g on run. Aim 500–750ml/h fluids + electrolytes.");
  notes.push("Post-workout: carbs + 20–30g protein within 60 min. Prioritize sleep (7–9h). Hydrate throughout day.");
  if (phase === "Taper") notes.push("Taper: reduce volume, keep a touch of intensity. Increase carbohydrate availability race week.");
  if (phase === "Build" || phase === "Peak") notes.push("Include 1–2 race-pace (Z3–Z4) segments each week. Rehearse race fueling & gear.");

  return { weekIndex: wIndex, phase, totalMin: minutes, sessions, notes };
}

function assemblePlan(opts: {
  distance: DistanceKey;
  totalWeeks: number;
  philosophy: Philosophy;
  availability: { longRideDay: number; longRunDay: number; restDay: number };
  includeStrength: boolean;
  includeMobility: boolean;
  adaptFatigueWeeks: number[];
}) {
  const peak = getPeakHours(opts.distance);
  const series = weeklyVolumeSeries(opts.totalWeeks, peak);
  const weeks: WeekPlan[] = [];
  for (let w = 0; w < series.length; w++) {
    const wk = buildWeek(
      w,
      opts.totalWeeks,
      opts.distance,
      series[w],
      opts.philosophy,
      opts.availability,
      opts.includeStrength,
      opts.includeMobility,
      opts.adaptFatigueWeeks.includes(w)
    );
    weeks.push(wk);
  }
  return weeks;
}

// ------------------------- UI -------------------------
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // base index 0=Sun
// Show the week starting on Monday (Mon..Sun) while keeping internal index 0=Sun
const dayOrderMonStart = [1, 2, 3, 4, 5, 6, 0];

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="flex-1" />
      <div className="min-w-[220px] flex items-center justify-end gap-2">{children}</div>
    </div>
  );
}

// WeekView (SessionCard, Pill, etc.) moved to a lazily-loaded chunk: ./WeekView

// ------------------------- Self-tests (kept + a few extras) -------------------------
function runSelfTests(): { passed: boolean; messages: string[] } {
  const messages: string[] = [];
  let passed = true;

  const TEST_DISTANCE: DistanceKey = "70.3";
  const TEST_WEEKS = 12;
  const basePlan = assemblePlan({
    distance: TEST_DISTANCE,
    totalWeeks: TEST_WEEKS,
    philosophy: "polarized",
    availability: defaultAvailability,
    includeStrength: true,
    includeMobility: true,
    adaptFatigueWeeks: [1],
  });

  // Test 1: length equals weeks
  if (basePlan.length !== TEST_WEEKS) {
    passed = false;
    messages.push(`Expected ${TEST_WEEKS} weeks, got ${basePlan.length}`);
  } else {
    messages.push("✓ plan length matches weeks");
  }

  // Test 2: rest day contains no non-mobility sessions
  const restDay = defaultAvailability.restDay;
  const restViolations = basePlan.flatMap((w, wi) => w.sessions.filter(s => s.day === restDay && s.sport !== "Mobility").map(() => wi + 1));
  if (restViolations.length > 0) {
    passed = false;
    messages.push(`Rest-day violation in week(s): ${Array.from(new Set(restViolations)).join(", ")}`);
  } else {
    messages.push("✓ rest day contains only mobility or is empty");
  }

  // Test 3: strength included -> at least 2 strength sessions in each week
  const strengthOk = basePlan.every(w => w.sessions.filter(s => s.sport === "Strength").length >= 2);
  if (!strengthOk) {
    passed = false;
    messages.push("Each week should include ≥2 strength sessions when enabled");
  } else {
    messages.push("✓ strength sessions present (≥2/wk)");
  }

  // Test 4: adaptFatigue week should downgrade hard sessions to Z2
  const adaptedWeek = basePlan[1];
  const hasHard = adaptedWeek.sessions.some(s => ["Z3", "Z4", "Z5"].includes(s.intensityZone) && ["Swim","Bike","Run"].includes(s.sport));
  if (hasHard) {
    passed = false;
    messages.push("Fatigue adaptation failed: found hard session in adapted week #2");
  } else {
    messages.push("✓ fatigue adaptation downgrades hard sessions to Z2 in week #2");
  }

  // Extra Test 5: disabling strength removes strength sessions
  const noStrengthPlan = assemblePlan({
    distance: TEST_DISTANCE,
    totalWeeks: 8,
    philosophy: "polarized",
    availability: defaultAvailability,
    includeStrength: false,
    includeMobility: true,
    adaptFatigueWeeks: [],
  });
  const anyStrength = noStrengthPlan.some(w => w.sessions.some(s => s.sport === "Strength"));
  if (anyStrength) {
    passed = false;
    messages.push("Strength disabled but strength sessions still present");
  } else {
    messages.push("✓ disabling strength removes strength sessions");
  }

  // Extra Test 6: durations are positive and >= 20 for primary sessions
  const badDur = basePlan.some(w => w.sessions.some(s => !["Strength","Mobility"].includes(s.sport) && s.durationMin < 20));
  if (badDur) {
    passed = false;
    messages.push("Found a primary session under 20 minutes");
  } else {
    messages.push("✓ session durations valid (>=20m for primary)");
  }

  // Extra Test 7: taper weeks should reduce volume vs peak
  {
    const peakHours = getPeakHours(TEST_DISTANCE);
    const series = weeklyVolumeSeries(TEST_WEEKS, peakHours);
    const last = series[series.length - 1];
    const secondLast = series[series.length - 2];
    if (!(last < secondLast)) {
      passed = false;
      messages.push("Taper check failed: last week volume should be < penultimate week volume");
    } else {
      messages.push("✓ taper reduces volume in final week");
    }
  }

  // Extra Test 8: discipline split sums to ~1
  {
    const s = disciplineSplit(TEST_DISTANCE);
    const sum = s.Swim + s.Bike + s.Run;
    if (Math.abs(sum - 1) > 1e-6) {
      passed = false;
      messages.push(`Discipline split must sum to 1 (got ${sum.toFixed(4)})`);
    } else {
      messages.push("✓ discipline split sums to 1");
    }
  }

  // Extra Test 9: weeklyVolumeSeries length equals total weeks
  {
    const peakHours = getPeakHours(TEST_DISTANCE);
    const series = weeklyVolumeSeries(TEST_WEEKS, peakHours);
    if (series.length !== TEST_WEEKS) {
      passed = false;
      messages.push(`Volume series length mismatch: expected ${TEST_WEEKS}, got ${series.length}`);
    } else {
      messages.push("✓ volume series length matches total weeks");
    }
  }

  // Extra Test 10: week entries have at least two notes
  {
    const ok = basePlan.every(w => Array.isArray(w.notes) && w.notes.length >= 2);
    if (!ok) {
      passed = false;
      messages.push("Each week should contain ≥2 notes");
    } else {
      messages.push("✓ week notes present (≥2)");
    }
  }

  return { passed, messages };
}

// ------------------------- Small UI helpers -------------------------
function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (online) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] px-3 py-2 rounded-lg border bg-amber-50 text-amber-900 border-amber-200 shadow">
      <div className="flex items-center gap-2 text-sm"><WifiOff className="w-4 h-4"/> You are offline. Some resources may fail to load.</div>
    </div>
  );
}

// ------------------------- App -------------------------
export default function TriPlanAI() {
  const [distance, setDistance] = useState<DistanceKey>("70.3");
  const [weeks, setWeeks] = useState<number>(20);
  const [philosophy, setPhilosophy] = useState<Philosophy>("polarized");
  const [availability, setAvailability] = useState(defaultAvailability);
  const [strength, setStrength] = useState(true);
  const [mobility, setMobility] = useState(true);
  const [fatigueWeeks, setFatigueWeeks] = useState<number[]>([]);

  const [seed, setSeed] = useState(1); // force re-gen

  const plan: WeekPlan[] = useMemo(() => {
    return assemblePlan({
      distance,
      totalWeeks: weeks,
      philosophy,
      availability,
      includeStrength: strength,
      includeMobility: mobility,
      adaptFatigueWeeks: fatigueWeeks,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distance, weeks, philosophy, availability, strength, mobility, fatigueWeeks, seed]);

  const [activeWeek, setActiveWeek] = useState(0);
  const [showWeekScreen, setShowWeekScreen] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);

  // Refs for a11y focus/inert handling
  const mainRef = useRef<HTMLDivElement | null>(null);
  const overlayContainerRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);

  // Remember collapsed state in localStorage
  useEffect(() => {
    try {
      const v = localStorage.getItem("tri_settingsCollapsed");
      if (v !== null) setSettingsCollapsed(v === "1");
    } catch {
      // localStorage not available
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("tri_settingsCollapsed", settingsCollapsed ? "1" : "0");
    } catch {
      // localStorage not available
    }
  }, [settingsCollapsed]);

  // Keyboard shortcut: press "S" to toggle settings (ignored when typing in inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || "").toUpperCase();
      const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (target?.isContentEditable ?? false);
      if (typing) return;
      if (e.key.toLowerCase() === "s") {
        setSettingsCollapsed(c => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keyboard navigation for fullscreen week view + focus/inert management
  useEffect(() => {
    if (!showWeekScreen) return;

    // Make background inert + lock scroll
    const mainEl = mainRef.current as unknown as HTMLElement & { inert?: boolean } | null;
    if (mainEl) mainEl.setAttribute('inert', '');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus management
    prevFocusedRef.current = document.activeElement as HTMLElement | null;
    setTimeout(() => closeBtnRef.current?.focus(), 0);

    // Trap Tab focus within overlay
    const container = overlayContainerRef.current;
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !container) return;
      const focusables = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleTab);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setActiveWeek(w => Math.max(0, w - 1));
      } else if (e.key === "ArrowRight") {
        setActiveWeek(w => Math.min(plan.length - 1, w + 1));
      } else if (e.key === "Escape") {
        setShowWeekScreen(false);
      } else if (e.key === "Home") {
        setActiveWeek(0);
      } else if (e.key === "End") {
        setActiveWeek(plan.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener('keydown', handleTab);
      if (mainEl) mainEl.removeAttribute('inert');
      document.body.style.overflow = prevOverflow;
      prevFocusedRef.current?.focus?.();
    };
  }, [showWeekScreen, plan.length]);

  const toggleMissed = (id: string) => {
    const w = plan[activeWeek];
    const session = w.sessions.find(s => s.id === id);
    if (!session) return;
    session.missed = !session.missed;
    if (session.missed && ["Z3", "Z4", "Z5"].includes(session.intensityZone)) {
      const next = plan[activeWeek + 1];
      if (next) {
        const candidate = next.sessions.find(s => s.sport === session.sport && ["Z3", "Z4", "Z5"].includes(s.intensityZone));
        if (candidate) {
          candidate.intensityZone = "Z2";
          candidate.title = candidate.title.replace(/ – .+$/, " – Aerobic");
          candidate.details = `Adapted for prior miss: ${candidate.details}`;
        }
      }
    }
    setSeed(x => x + 1);
  };

  const exportJSON = () => {
    const payload = { distance, weeks, philosophy, availability, plan };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TriPlanAI_${distance}_${weeks}w.json`;
    a.click();
  };

  const handleRunTests = () => {
    const { passed, messages } = runSelfTests();
    const summary = messages.join("\n");
    alert((passed ? "✅ All self-tests passed" : "❌ Some self-tests failed") + "\n\n" + summary);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-rose-50 text-gray-900">
      <OfflineBanner />
      <header className="max-w-7xl mx-auto px-6 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-sky-600 to-blue-700 text-white flex items-center justify-center shadow-md">TP</div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">TriPlan AI</h1>
          <span className="text-gray-400">— smart long-course triathlon planning</span>
        </div>
      </header>

      <main ref={mainRef} className="max-w-7xl mx-auto px-6 pb-24">
        {/* Controls */}
        {settingsCollapsed ? (
          <div className="grid lg:grid-cols-3 gap-6 mb-8 transition-all duration-300">
            {/* Slim header bar so you can expand later */}
            <div className="rounded-3xl border bg-white p-4 shadow-sm lg:col-span-3 flex items-center justify-between transition-all duration-300">
              <div className="flex items-center gap-2"><Settings2 className="w-4 h-4" /><div className="font-semibold">Plan Settings</div></div>
              <button
                onClick={() => setSettingsCollapsed(false)}
                aria-expanded={!settingsCollapsed}
                aria-controls="settings-panel"
                className="text-xs px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
              >Expand</button>
            </div>

            {/* Weekly plan takes the full width when settings are minimized */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm lg:col-span-3 transition-all duration-300">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
                <div className="font-semibold">Weekly Plan</div>
                <div className="flex items-center gap-2">
                  <button onClick={()=>setShowWeekScreen(true)} className="px-3 py-2 rounded-xl border bg-sky-50 hover:bg-sky-100">Open Fullscreen</button>
                </div>
              </div>
              <Suspense fallback={<div className="rounded-3xl border bg-white p-6 shadow-sm">Loading weekly plan…</div>}>
                <LazyWeekView w={plan[activeWeek]} toggleMissed={toggleMissed} />
              </Suspense>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6 mb-8 transition-all duration-300">
            <div className="rounded-3xl border bg-white p-6 shadow-sm transition-all duration-300">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><Settings2 className="w-4 h-4" /><div className="font-semibold">Plan Settings</div></div>
                <button
                  onClick={() => setSettingsCollapsed(true)}
                  aria-expanded={!settingsCollapsed}
                  aria-controls="settings-panel"
                  className="text-xs px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
                >Minimize</button>
              </div>

              <div id="settings-panel">
                <ControlRow label="Race distance">
                  <select
                    className="border rounded-xl px-3 py-2 bg-white"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value as DistanceKey)}
                  >
                    <option value="70.3">Half Ironman (70.3)</option>
                    <option value="140.6">Full Ironman (140.6)</option>
                  </select>
                </ControlRow>

                <ControlRow label="Weeks until race">
                  <input
                    type="number"
                    min={12}
                    max={36}
                    className="border rounded-xl px-3 py-2 w-24 text-right"
                    value={weeks}
                    onChange={(e) => setWeeks(Math.max(12, Math.min(36, Number(e.target.value))))}
                  />
                </ControlRow>

                <ControlRow label="Training philosophy">
                  <select
                    className="border rounded-xl px-3 py-2 bg-white"
                    value={philosophy}
                    onChange={(e) => setPhilosophy(e.target.value as Philosophy)}
                  >
                    <option value="polarized">Polarized (≈80/20)</option>
                    <option value="pyramidal">Pyramidal (more tempo)</option>
                  </select>
                </ControlRow>

                <div className="h-px bg-gray-200 my-3" />

                <ControlRow label="Long ride day">
                  <select className="border rounded-xl px-3 py-2 bg-white" value={availability.longRideDay} onChange={(e)=>setAvailability(a=>({...a,longRideDay:Number(e.target.value)}))}>
                    {dayOrderMonStart.map((i)=>(<option key={i} value={i}>{dayNames[i]}</option>))}
                  </select>
                </ControlRow>
                <ControlRow label="Long run day">
                  <select className="border rounded-xl px-3 py-2 bg-white" value={availability.longRunDay} onChange={(e)=>setAvailability(a=>({...a,longRunDay:Number(e.target.value)}))}>
                    {dayOrderMonStart.map((i)=>(<option key={i} value={i}>{dayNames[i]}</option>))}
                  </select>
                </ControlRow>
                <ControlRow label="Rest day">
                  <select className="border rounded-xl px-3 py-2 bg-white" value={availability.restDay} onChange={(e)=>setAvailability(a=>({...a,restDay:Number(e.target.value)}))}>
                    {dayOrderMonStart.map((i)=>(<option key={i} value={i}>{dayNames[i]}</option>))}
                  </select>
                </ControlRow>

                <div className="h-px bg-gray-200 my-3" />

                <ControlRow label="Include strength">
                  <button onClick={()=>setStrength(v=>!v)} className={`px-3 py-1 rounded-lg border ${strength?"bg-black text-white":"bg-white"}`}>{strength?"On":"Off"}</button>
                </ControlRow>
                <ControlRow label="Include mobility">
                  <button onClick={()=>setMobility(v=>!v)} className={`px-3 py-1 rounded-lg border ${mobility?"bg-black text-white":"bg-white"}`}>{mobility?"On":"Off"}</button>
                </ControlRow>

                <div className="h-px bg-gray-200 my-3" />

                <ControlRow label="Mark week fatigued">
                  <select
                    className="border rounded-xl px-3 py-2 bg-white"
                    onChange={(e)=>{
                      const idx = Number(e.target.value);
                      if (!Number.isFinite(idx)) return;
                      setFatigueWeeks(fw => fw.includes(idx) ? fw.filter(x=>x!==idx) : [...fw, idx]);
                    }}
                  >
                    <option>Choose week…</option>
                    {Array.from({length: weeks}).map((_,i)=>(<option key={i} value={i}>Week {i+1}</option>))}
                  </select>
                </ControlRow>

                <div className="mt-4 flex items-center gap-2">
                  <button onClick={()=>setSeed(s=>s+1)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border-0 text-white bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 shadow"><RefreshCw className="w-4 h-4"/>Regenerate</button>
                  <button onClick={exportJSON} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-gray-900 text-white hover:bg-black"><Download className="w-4 h-4"/>Export JSON</button>
                  <button onClick={handleRunTests} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-white hover:bg-gray-50">Run self-tests</button>
                </div>
              </div>
            </div>

            {/* Week Navigator now opens separate screen */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm lg:col-span-2 transition-all duration-300">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
                <div className="font-semibold">Weekly Plan</div>
                <div className="flex items-center gap-2">
                  <button onClick={()=>setShowWeekScreen(true)} className="px-3 py-2 rounded-xl border bg-sky-50 hover:bg-sky-100">Open Fullscreen</button>
                </div>
              </div>
              <Suspense fallback={<div className="rounded-3xl border bg-white p-6 shadow-sm">Loading weekly plan…</div>}>
                <LazyWeekView w={plan[activeWeek]} toggleMissed={toggleMissed} />
              </Suspense>
            </div>
          </div>
        )}

        {/* Plan Summary */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="font-semibold mb-2">Overview</div>
            <div className="text-sm text-gray-700 space-y-1">
              <div>Distance: <b>{distance === "70.3" ? "Half Ironman 70.3" : "Full Ironman 140.6"}</b></div>
              <div>Duration: <b>{weeks} weeks</b></div>
              <div>Philosophy: <b className="capitalize">{philosophy}</b></div>
              <div>Peak weekly volume target: <b>{getPeakHours(distance)}h</b></div>
            </div>
          </div>
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="font-semibold mb-2">Scheduling</div>
            <div className="text-sm text-gray-700 space-y-1">
              <div>Long ride: <b>{dayNames[availability.longRideDay]}</b></div>
              <div>Long run: <b>{dayNames[availability.longRunDay]}</b></div>
              <div>Rest day: <b>{dayNames[availability.restDay]}</b></div>
              <div>Strength/Mobility: <b>{strength?"Yes":"No"}</b> / <b>{mobility?"Yes":"No"}</b></div>
            </div>
          </div>
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="font-semibold mb-2">Guidelines</div>
            <ul className="text-sm text-gray-700 space-y-1 list-disc ml-4">
              <li>80/20 easy–hard (polarized) or slightly more tempo (pyramidal).</li>
              <li>Recovery week every ~4th week. Listen to fatigue signals.</li>
              <li>Practice race fueling on long bike/run. Test GI tolerance.</li>
              <li>Strength 2×/wk, Mobility 2×/wk for durability & economy.</li>
            </ul>
          </div>
        </div>
      </main>

      {/* Fullscreen Weekly Plan Overlay */}
      {showWeekScreen && (
        <div ref={overlayContainerRef} role="dialog" aria-modal="true" aria-label={`Weekly Plan – Week ${activeWeek+1}`} className="fixed inset-0 bg-white z-50 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="font-bold text-xl">Weekly Plan – Week {activeWeek+1}</div>
            <button ref={closeBtnRef} aria-label="Close" onClick={()=>setShowWeekScreen(false)} className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5"/></button>
          </div>
          <div className="text-xs text-gray-500 mb-4">Tip: use <kbd className="px-1.5 py-0.5 rounded border bg-gray-50">←</kbd>/<kbd className="px-1.5 py-0.5 rounded border bg-gray-50">→</kbd> to switch weeks, <kbd className="px-1.5 py-0.5 rounded border bg-gray-50">Esc</kbd> to close, <kbd className="px-1.5 py-0.5 rounded border bg-gray-50">Home</kbd>/<kbd className="px-1.5 py-0.5 rounded border bg-gray-50">End</kbd> to jump.</div>
          <div className="flex items-center gap-2 mb-4">
            <button disabled={activeWeek<=0} onClick={()=>setActiveWeek(w=>Math.max(0,w-1))} className="px-3 py-2 rounded-xl border disabled:opacity-40">Prev</button>
            <select className="border rounded-xl px-3 py-2 bg-white" value={activeWeek} onChange={(e)=>setActiveWeek(Number(e.target.value))}>
              {plan.map((_,i)=>(<option key={i} value={i}>Week {i+1}</option>))}
            </select>
            <button disabled={activeWeek>=plan.length-1} onClick={()=>setActiveWeek(w=>Math.min(plan.length-1,w+1))} className="px-3 py-2 rounded-xl border disabled:opacity-40">Next</button>
          </div>
          <Suspense fallback={<div className="rounded-3xl border bg-white p-6 shadow-sm">Loading weekly plan…</div>}>
            <LazyWeekView w={plan[activeWeek]} toggleMissed={toggleMissed} />
          </Suspense>
        </div>
      )}

      <footer className="max-w-7xl mx-auto px-6 pb-10 text-xs text-gray-500">
        Built with coach-informed heuristics. Always personalize to your context.
      </footer>
    </div>
  );
}
