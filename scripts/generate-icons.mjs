// Membuat ikon PNG untuk PWA dan sumber ikon Android dari logo KroomPrint.
// Jalankan: npm run icons
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const glyph = `
  <path d="M6 9V3.5h12V9" stroke="#383838" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M6 17.5H4.5a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5h15a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H18" stroke="#383838" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <rect x="7" y="13" width="10" height="7" rx="1" stroke="#383838" stroke-width="1.6" fill="none"/>
  <circle cx="18.5" cy="6.5" r="1.5" fill="#058BFF" stroke="#383838" stroke-width="1"/>`

// Ikon biasa: kotak lime membulat dengan garis tepi, seperti favicon.
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="1" y="1" width="22" height="22" rx="6" fill="#F4FFC9" stroke="#383838" stroke-width="1.6"/>
  ${glyph}
</svg>`

// Ikon maskable: latar penuh, glyph diperkecil ke zona aman 60% di tengah.
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" fill="#F4FFC9"/>
  <g transform="translate(4.8 4.8) scale(0.6)">${glyph}</g>
</svg>`

const out = [
  ['public/icons/icon-192.png', rounded, 192],
  ['public/icons/icon-512.png', rounded, 512],
  ['public/icons/maskable-512.png', fullBleed, 512],
  ['public/icons/apple-touch-icon.png', fullBleed, 180],
  // Sumber untuk `npx @capacitor/assets generate --android`.
  ['assets/icon-only.png', fullBleed, 1024],
  ['assets/icon-foreground.png', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="translate(6 6) scale(0.5)">${glyph}</g></svg>`, 1024],
  ['assets/icon-background.png', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#F4FFC9"/></svg>`, 1024],
  ['assets/splash.png', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#F6F2EE"/><g transform="translate(48 48)">${rounded.replace(/<\/?svg[^>]*>/g, '')}</g></svg>`, 2732],
]

mkdirSync('public/icons', { recursive: true })
mkdirSync('assets', { recursive: true })
for (const [file, svg, size] of out) {
  await sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(file)
  console.log('✓', file)
}
