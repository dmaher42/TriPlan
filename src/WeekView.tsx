import React from "react";
import { Bike, Dumbbell, StretchHorizontal, Zap, CheckCircle2, Calendar as CalendarIcon, Info } from "lucide-react";

export type Session = {
  id: string;
  sport: "Swim" | "Bike" | "Run" | "Strength" | "Mobility";
  day: number;
  title: string;
  focus: string;
  durationMin: number;
  details: string;
  intensityZone: "Z1" | "Z2" | "Z3" | "Z4" | "Z5" | "Mixed";
  optional?: boolean;
  missed?: boolean;
};

export type WeekPlan = {
  weekIndex: number;
  phase: "Base" | "Build" | "Peak" | "Taper" | "Recovery";
  totalMin: number;
  sessions: Session[];
  notes: string[];
};

const prettyDuration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const colorBySport: Record<Session["sport"], { pill: string; border: string; bar: string }> = {
  Swim:     { pill: "bg-sky-50 text-sky-800 border-sky-200",        border: "border-sky-200",      bar: "bg-sky-400" },
  Bike:     { pill: "bg-amber-50 text-amber-800 border-amber-200",  border: "border-amber-200",    bar: "bg-amber-400" },
  Run:      { pill: "bg-rose-50 text-rose-800 border-rose-200",     border: "border-rose-200",     bar: "bg-rose-400" },
  Strength: { pill: "bg-emerald-50 text-emerald-800 border-emerald-200", border: "border-emerald-200", bar: "bg-emerald-400" },
  Mobility: { pill: "bg-violet-50 text-violet-800 border-violet-200",   border: "border-violet-200",  bar: "bg-violet-400" },
};

const colorByZone: Record<Session["intensityZone"], string> = {
  Z1: "bg-gray-50 text-gray-800 border-gray-200",
  Z2: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Z3: "bg-amber-50 text-amber-800 border-amber-200",
  Z4: "bg-red-50 text-red-800 border-red-200",
  Z5: "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200",
  Mixed: "bg-slate-50 text-slate-800 border-slate-200",
};

const zoneBlurb: Record<Session["intensityZone"], string> = {
  Z1: "Easy aerobic (conversational).",
  Z2: "Steady aerobic. Nose-breathing mostly possible.",
  Z3: "Tempo / moderately hard. Sustainable for ~1h.",
  Z4: "Threshold. Hard but controlled. 10–20 min efforts.",
  Z5: "VO2max. Very hard. 1–5 min reps.",
  Mixed: "Mixed intensities / skills / drills.",
};

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayOrderMonStart = [1,2,3,4,5,6,0];

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs border ${className}`}>{children}</span>;
}

function SessionCard({ s, toggleMissed }: { s: Session; toggleMissed: (id: string) => void }) {
  const Icon = s.sport === "Bike" ? Bike : s.sport === "Swim" ? Zap : s.sport === "Run" ? Zap : s.sport === "Strength" ? Dumbbell : StretchHorizontal;
  const sportColors = colorBySport[s.sport];
  const zoneColors = colorByZone[s.intensityZone];
  return (
    <div className={`rounded-2xl border p-0 shadow-sm bg-white transition ${sportColors.border} ${s.missed ? "opacity-60" : ""}`}>
      <div className={`h-1 w-full rounded-t-2xl ${sportColors.bar}`} />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-4 h-4" />
          <div className="font-medium">{s.title}</div>
          <div className="ml-auto flex gap-2 items-center">
            <Pill className={sportColors.pill}>{s.sport}</Pill>
            <Pill className={zoneColors}>{s.intensityZone}</Pill>
            <Pill className="bg-gray-100 text-gray-700 border-gray-200">{prettyDuration(s.durationMin)}</Pill>
          </div>
        </div>
        <div className="text-xs text-gray-500 mb-2">{zoneBlurb[s.intensityZone]}</div>
        <div className="text-sm text-gray-700">{s.details}</div>
        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-gray-500">Day: {dayNames[s.day]}</div>
          <button onClick={() => toggleMissed(s.id)} className={`text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md border ${s.missed ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-gray-50 hover:bg-gray-100"}`}>
            <CheckCircle2 className="w-3 h-3" /> {s.missed ? "Mark as done" : "Mark missed"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WeekView({ w, toggleMissed }: { w: WeekPlan; toggleMissed: (id: string) => void }) {
  const grouped: Record<number, Session[]> = {};
  w.sessions.forEach(s => {
    grouped[s.day] = grouped[s.day] || [];
    grouped[s.day].push(s);
  });
  return (
    <div className="rounded-3xl border shadow-md bg-white p-6">
      <div className="flex items-center gap-3 mb-6">
        <CalendarIcon className="w-5 h-5" />
        <div className="text-lg font-semibold">Week {w.weekIndex + 1} <span className="text-gray-400">• {w.phase}</span></div>
        <div className="ml-auto text-sm text-gray-500">~{prettyDuration(w.totalMin)}</div>
      </div>

      <div className="xl:hidden flex gap-6 overflow-x-auto snap-x snap-mandatory pb-4 -mx-2 px-2">
        {dayOrderMonStart.map((idx) => (
          <div key={idx} className="min-w-[380px] snap-start rounded-2xl border bg-gradient-to-b from-gray-50 to-white p-5 shadow-sm">
            <div className="font-medium text-sm mb-3">{dayNames[idx]}</div>
            <div className="space-y-6">
              {(grouped[idx] || []).map(s => (
                <SessionCard key={s.id} s={s} toggleMissed={toggleMissed} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden xl:flex xl:gap-6 xl:overflow-x-auto xl:pb-4">
        {dayOrderMonStart.map((idx) => (
          <div key={idx} className="min-w-[300px] flex-shrink-0 rounded-2xl border bg-gradient-to-b from-gray-50 to-white p-5 shadow-sm">
            <div className="font-medium text-sm mb-3">{dayNames[idx]}</div>
            <div className="space-y-6">
              {(grouped[idx] || []).map(s => (
                <SessionCard key={s.id} s={s} toggleMissed={toggleMissed} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-2 text-sm shadow-sm">
        <Info className="w-4 h-4 mt-0.5" />
        <div>
          {w.notes.map((n, i) => (
            <div key={i} className="text-blue-900">• {n}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
