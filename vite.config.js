import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // Abaikan folder backend (SQLite DB ditulis scheduler tiap 2.5s,
      // uploads, dan build output) agar tidak memicu full page reload.
      ignored: ['**/backend/**', '**/data/**', '**/uploads/**', '**/dist/**', '**/node_modules/**'],
    },
  },
})
