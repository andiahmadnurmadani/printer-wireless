// Build APK Android lalu taruh di downloads/ beserta latest.json untuk landing page.
// Jalankan: npm run apk
// Rilis bertanda tangan butuh android/keystore.properties; tanpa itu dibuat APK debug.
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const run = (cmd, cwd = '.') => execSync(cmd, { cwd, stdio: 'inherit' })

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const release = existsSync('android/keystore.properties')
const variant = release ? 'release' : 'debug'

run('npm run build')
run('npx cap sync android')
run(`${process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew'} assemble${release ? 'Release' : 'Debug'}`, 'android')

const built = join('android/app/build/outputs/apk', variant, `app-${variant}.apk`)
const file = `kroomprint-${version}.apk`
mkdirSync('downloads', { recursive: true })
copyFileSync(built, join('downloads', file))

const latestPath = join('downloads', 'latest.json')
const latest = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, 'utf8')) : {}
latest.android = {
  version,
  file: `/downloads/${file}`,
  size: statSync(join('downloads', file)).size,
  minAndroid: '7.0',
  signed: release,
  updatedAt: new Date().toISOString(),
}
writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n')

console.log(`\n✓ ${file} (${variant}) siap di downloads/`)
if (!release) console.log('  Catatan: APK debug. Buat android/keystore.properties untuk rilis resmi.')
