import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Saat dev, sajikan downloads/ (APK + latest.json) seperti server.cjs di produksi.
const serveDownloads = {
  name: 'kroomprint-downloads',
  configureServer(server) {
    server.middlewares.use('/downloads', (req, res, next) => {
      const file = path.join(process.cwd(), 'downloads', path.basename(req.url.split('?')[0]))
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next()
      res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/vnd.android.package-archive')
      fs.createReadStream(file).pipe(res)
    })
  },
}

// Alamat IP komputer ini yang bisa dijangkau HP, untuk QR code di landing page saat
// halaman dibuka lewat localhost. Utamakan Wi-Fi/Ethernet, lalu Tailscale; adapter
// virtual (WARP, vEthernet, VirtualBox, Docker, WSL) dilewati.
function lanAddress() {
  const virtual = /warp|vethernet|virtualbox|vmware|docker|wsl|hyper-v|loopback/i
  const list = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) list.push({ name, ip: a.address })
    }
  }
  const physical = list.find((a) => /wi-?fi|wlan|ethernet|^en|^eth/i.test(a.name) && !a.ip.startsWith('100.'))
  const tailscale = list.find((a) => a.ip.startsWith('100.'))
  return (physical || tailscale || list[0])?.ip || ''
}

const PORT = 5174

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serveDownloads],
  define: {
    'import.meta.env.VITE_LAN_ORIGIN': JSON.stringify(lanAddress() ? `http://${lanAddress()}:${PORT}` : ''),
  },
  server: {
    port: PORT,
    host: true,
    proxy: {
      '/api': {
        target: 'http://100.90.80.85:8088',
        changeOrigin: true,
      },
    },
    watch: {
      // Abaikan folder backend (SQLite DB ditulis scheduler tiap 2.5s,
      // uploads, dan build output) agar tidak memicu full page reload.
      ignored: ['**/backend/**', '**/data/**', '**/uploads/**', '**/dist/**', '**/node_modules/**'],
    },
  },
})
