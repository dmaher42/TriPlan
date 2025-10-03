import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/TriPlan/', // 👈 MUST match your repo name exactly (case-sensitive)
})
