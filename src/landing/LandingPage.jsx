import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  IconAndroid, IconApple, IconArrowRight, IconCamera, IconCheck, IconDownload,
  IconLayoutGrid, IconLock, IconPrinter, IconQueue, IconShare, IconUpload, IconX,
} from '../components/ui/icons'

/**
 * Halaman depan publik: pengenalan KroomPrint + unduhan aplikasi
 * Android (APK) dan pemasangan di iPhone (PWA / App Store).
 */

const card = 'bg-vanilla-100 border-2 border-dark-black-900 rounded-[20px] shadow-[4px_4px_0_0_rgba(56,56,56,1)]'
const btnBase = 'inline-flex items-center justify-center gap-2 h-[52px] px-6 rounded-[14px] border-2 border-dark-black-900 font-figtree font-bold text-[15px] text-dark-black-900 cursor-pointer transition-all active:translate-y-0.5 active:shadow-none'

const FEATURES = [
  { icon: IconUpload, title: 'Upload apa saja', text: 'PDF, foto, Word, Excel, dan TXT langsung dari HP atau laptop.', bg: 'bg-lime-300' },
  { icon: IconLayoutGrid, title: 'Preview sebelum cetak', text: 'Atur ukuran kertas, N-up, booklet, duplex, dan watermark. Lihat hasilnya dulu.', bg: 'bg-sky-blue-100' },
  { icon: IconQueue, title: 'Antrean live', text: 'Status cetak berubah real-time. Pause, batalkan, atau pindahkan job ke printer lain.', bg: 'bg-vanilla-300' },
  { icon: IconCamera, title: 'Scan pakai kamera', text: 'Foto dokumen fisik, rapikan, lalu langsung cetak ulang.', bg: 'bg-warn-100' },
  { icon: IconPrinter, title: 'Banyak printer', text: 'Epson, HP, Canon, Brother lewat CUPS. Cek tinta dan kesehatan printer.', bg: 'bg-ok-100' },
  { icon: IconLock, title: 'Akun dan peran', text: 'Admin, user, dan tamu punya akses berbeda. Riwayat cetak per orang.', bg: 'bg-err-100' },
]

const STEPS = [
  { title: 'Pasang aplikasinya', text: 'Unduh APK untuk Android, atau tambahkan ke Home Screen di iPhone.' },
  { title: 'Hubungkan ke server', text: 'Isi alamat server KroomPrint kantor kamu, lalu login.' },
  { title: 'Pilih file, lalu cetak', text: 'Pilih printer, atur layout, dan kirim. Ambil hasilnya di printer.' },
]

const FAQ = [
  {
    q: 'Bagaimana cara memasang APK di Android?',
    a: 'Unduh file APK, lalu buka dari notifikasi atau folder Download. Kalau muncul peringatan, buka Setelan → izinkan "Install aplikasi tidak dikenal" untuk browser yang kamu pakai, lalu ketuk Install.',
  },
  {
    q: 'Apakah APK ini aman?',
    a: 'APK dibangun langsung dari kode KroomPrint dan hanya diunduh dari server ini. Aplikasi hanya berbicara dengan server KroomPrint yang kamu isi sendiri.',
  },
  {
    q: 'Kenapa iPhone tidak ada file unduhan?',
    a: 'Apple tidak mengizinkan instalasi aplikasi di luar App Store. Di iPhone, KroomPrint dipasang sebagai web app lewat Safari: Share → Add to Home Screen. Tampilannya tetap layar penuh seperti aplikasi biasa.',
  },
  {
    q: 'Apakah HP harus satu jaringan dengan printer?',
    a: 'HP harus bisa menjangkau server KroomPrint: lewat Wi-Fi kantor yang sama, atau lewat Tailscale kalau sedang di luar kantor.',
  },
]

function detectPlatform() {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
}

// publicOrigin adalah alamat yang bisa dibuka HP. "localhost" di laptop menunjuk
// ke HP itu sendiri, jadi saat dibuka lewat localhost dipakai VITE_PUBLIC_URL
// (kalau diset) atau IP jaringan komputer ini yang diisi vite.config.js.
function publicOrigin() {
  const configured = import.meta.env.VITE_PUBLIC_URL
  if (configured) return configured.replace(/\/+$/, '')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  if (local && import.meta.env.VITE_LAN_ORIGIN) return import.meta.env.VITE_LAN_ORIGIN
  return window.location.origin
}

function formatSize(bytes) {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Logo() {
  return (
    <a href="/" className="flex items-center gap-2.5 no-underline">
      <img src="/kroomprint.svg" alt="" className="w-10 h-10" />
      <span className="font-figtree font-bold text-[20px] text-dark-black-900 tracking-tight">KroomPrint</span>
    </a>
  )
}

function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[260px] sm:w-[280px]">
      <div className="absolute -left-12 top-40 hidden sm:flex items-center gap-2 px-3 py-2 rounded-[12px] border-2 border-dark-black-900 bg-sky-blue-100 font-geist text-[12px] font-bold text-dark-black-900 shadow-[3px_3px_0_0_rgba(56,56,56,1)] -rotate-6 z-10">
        <span className="w-2 h-2 rounded-full bg-ok-500 blink" /> Antrean live
      </div>
      <div className="absolute -right-8 bottom-24 hidden sm:flex items-center gap-2 px-3 py-2 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 font-geist text-[12px] font-bold text-dark-black-900 shadow-[3px_3px_0_0_rgba(56,56,56,1)] rotate-6 z-10">
        <IconCheck size={14} /> Selesai dicetak
      </div>
      <div className="rounded-[38px] border-2 border-dark-black-900 bg-dark-black-900 p-2 shadow-[6px_6px_0_0_rgba(56,56,56,1)]">
        <div className="rounded-[30px] bg-vanilla-200 overflow-hidden h-[520px] flex flex-col">
          <div className="h-7 flex items-center justify-center">
            <span className="w-20 h-4 rounded-full bg-dark-black-900" />
          </div>
          <div className="px-4 pt-2 pb-3 flex items-center gap-2 border-b-2 border-dark-black-900">
            <img src="/kroomprint.svg" alt="" className="w-7 h-7" />
            <span className="font-figtree font-bold text-[15px] text-dark-black-900">Print</span>
          </div>
          <div className="p-4 flex flex-col gap-3 flex-1">
            <div className="rounded-[14px] border-2 border-dashed border-dark-black-900/50 bg-vanilla-100 p-3 flex items-center gap-3">
              <span className="w-10 h-12 rounded-[6px] border-2 border-dark-black-900 bg-err-100 flex items-center justify-center font-geist text-[9px] font-bold text-dark-black-900">PDF</span>
              <div className="leading-tight min-w-0">
                <div className="font-figtree font-bold text-[13px] text-dark-black-900 truncate">Laporan-Q3.pdf</div>
                <div className="font-geist text-[11px] text-dark-black-900/60">12 halaman · A4</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {['A4', '2 salinan', 'Duplex', 'Warna'].map((t) => (
                <span key={t} className="rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 py-1.5 text-center font-geist text-[11px] font-semibold text-dark-black-900">{t}</span>
              ))}
            </div>
            <div className="rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 p-3 flex items-center gap-3">
              <span className="w-9 h-9 rounded-[10px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center text-dark-black-900"><IconPrinter size={18} /></span>
              <div className="leading-tight flex-1">
                <div className="font-figtree font-bold text-[13px] text-dark-black-900">Epson L3210</div>
                <div className="font-geist text-[11px] text-ok-500 font-semibold">Online · siap</div>
              </div>
            </div>
            <div className="rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 p-3">
              <div className="flex justify-between font-geist text-[11px] font-semibold text-dark-black-900 mb-2">
                <span>Mencetak…</span><span>7 / 12</span>
              </div>
              <div className="h-3 rounded-full border-2 border-dark-black-900 bg-vanilla-200 overflow-hidden">
                <div className="h-full w-[58%] bg-sky-blue-500 progress-stripes" />
              </div>
            </div>
            <div className="mt-auto h-11 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center font-figtree font-bold text-[14px] text-dark-black-900 shadow-[2px_2px_0_0_rgba(56,56,56,1)]">
              Cetak sekarang
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const btnVariant = (primary) =>
  primary
    ? 'bg-lime-300 hover:bg-lime-400 shadow-[4px_4px_0_0_rgba(56,56,56,1)]'
    : 'bg-vanilla-100 hover:bg-vanilla-300 shadow-[3px_3px_0_0_rgba(56,56,56,1)]'

function AndroidButton({ android, primary }) {
  if (!android) {
    return (
      <span className={`${btnBase} bg-vanilla-300 cursor-default opacity-70`}>
        <IconAndroid size={20} /> APK segera hadir
      </span>
    )
  }
  return (
    <a href={android.file} download className={`${btnBase} no-underline ${btnVariant(primary)}`}>
      <IconAndroid size={20} /> Unduh APK Android
    </a>
  )
}

function IosButton({ storeUrl, onGuide, primary }) {
  const cls = `${btnBase} no-underline ${btnVariant(primary)}`
  if (storeUrl) {
    return <a href={storeUrl} className={cls}><IconApple size={20} /> Unduh untuk iPhone</a>
  }
  return (
    <button type="button" onClick={onGuide} className={cls}><IconApple size={20} /> Pasang di iPhone</button>
  )
}

function IosGuide({ onClose }) {
  const steps = [
    { icon: IconApple, text: 'Buka halaman ini di Safari (bukan Chrome atau aplikasi lain).' },
    { icon: IconShare, text: 'Ketuk tombol Share di bagian bawah layar.' },
    { icon: IconDownload, text: 'Pilih "Add to Home Screen" (Tambahkan ke Layar Utama), lalu ketuk Add.' },
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-dark-black-900/50 backdrop-blur-[3px]" onClick={onClose}>
      <div className={`${card} w-full max-w-[420px] p-6 modal-in`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cara pasang di iPhone">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="font-figtree font-bold text-[20px] text-dark-black-900">Pasang di iPhone</div>
            <div className="text-[14px] text-dark-black-900/70">Tiga langkah, tanpa App Store.</div>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="w-9 h-9 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-200 flex items-center justify-center text-dark-black-900 cursor-pointer hover:bg-err-100">
            <IconX size={16} />
          </button>
        </div>
        <ol className="flex flex-col gap-3 m-0 p-0 list-none">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-9 h-9 shrink-0 rounded-[10px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center font-geist font-bold text-[14px] text-dark-black-900">{i + 1}</span>
              <span className="text-[15px] text-dark-black-900 pt-1.5 flex items-start gap-2">
                <s.icon size={18} className="shrink-0 mt-0.5" /> {s.text}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const [platform] = useState(detectPlatform)
  const [release, setRelease] = useState(null)
  const [installEvent, setInstallEvent] = useState(null)
  const [showIos, setShowIos] = useState(false)
  const [qr, setQr] = useState('')

  useEffect(() => {
    fetch('/downloads/latest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setRelease)
      .catch(() => setRelease(null))

    QRCode.toDataURL(`${publicOrigin()}/#unduh`, {
      margin: 1,
      width: 240,
      color: { dark: '#383838', light: '#ffffff' },
    }).then(setQr).catch(() => {})

    // Chrome/Edge di Android dan desktop menawarkan install PWA lewat event ini.
    const onPrompt = (e) => {
      e.preventDefault()
      setInstallEvent(e)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const android = release?.android
  const iosStoreUrl = release?.ios?.appStoreUrl || release?.ios?.testflightUrl

  const installPwa = async () => {
    if (!installEvent) return
    installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

  const openIos = () => setShowIos(true)

  return (
    <div className="min-h-full bg-kroom-noise text-dark-black-900 font-figtree">
      {/* Nav */}
      <header className="sticky top-0 z-40 bg-vanilla-200/90 backdrop-blur border-b-2 border-dark-black-900">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between gap-4">
          <Logo />
          <nav className="hidden md:flex items-center gap-7 font-semibold text-[15px]">
            <a href="#fitur" className="text-dark-black-900 no-underline hover:underline">Fitur</a>
            <a href="#cara-kerja" className="text-dark-black-900 no-underline hover:underline">Cara kerja</a>
            <a href="#unduh" className="text-dark-black-900 no-underline hover:underline">Unduh</a>
            <a href="#faq" className="text-dark-black-900 no-underline hover:underline">FAQ</a>
          </nav>
          <a href="/app" className="inline-flex items-center gap-2 h-[42px] px-4 rounded-[12px] border-2 border-dark-black-900 bg-dark-black-900 text-vanilla-100 font-bold text-[14px] no-underline hover:bg-black transition-colors">
            Buka web app <IconArrowRight size={16} />
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-12 pb-16 md:pt-20 md:pb-24 grid md:grid-cols-[1.15fr_1fr] gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] border-2 border-dark-black-900 bg-vanilla-100 font-geist text-[12px] font-bold uppercase tracking-widest mb-6">
            <span className="w-2 h-2 rounded-full bg-sky-blue-500" /> Wireless print
          </div>
          <h1 className="font-figtree font-extrabold text-[40px] sm:text-[54px] leading-[1.05] tracking-tight m-0">
            Cetak dari HP ke printer kantor,{' '}
            <span className="relative inline-block">
              <span className="relative z-10">tanpa kabel.</span>
              <span className="absolute left-0 right-0 bottom-1 h-4 bg-lime-400 -z-0 rounded-[4px]" />
            </span>
          </h1>
          <p className="text-[18px] leading-relaxed text-dark-black-900/75 mt-5 mb-8 max-w-[520px]">
            Upload PDF, foto, atau dokumen, atur layout, lalu kirim ke printer mana pun di jaringan. Pantau antreannya langsung dari genggaman.
          </p>
          <div className="flex flex-wrap gap-3">
            {platform === 'ios' ? (
              <><IosButton storeUrl={iosStoreUrl} onGuide={openIos} primary /><AndroidButton android={android} /></>
            ) : (
              <><AndroidButton android={android} primary /><IosButton storeUrl={iosStoreUrl} onGuide={openIos} /></>
            )}
          </div>
          <p className="font-geist text-[12px] text-dark-black-900/60 mt-4">
            {android
              ? `v${android.version}${android.size ? ` · ${formatSize(android.size)}` : ''} · Android ${android.minAndroid || '7.0'}+`
              : 'Versi Android sedang disiapkan'}
            {' · '}iPhone lewat Safari
          </p>
          {installEvent && platform !== 'ios' && (
            <button type="button" onClick={installPwa} className="mt-3 font-semibold text-[14px] text-dark-black-900 underline cursor-pointer bg-transparent border-0 p-0">
              Atau pasang sebagai web app tanpa unduh APK
            </button>
          )}
        </div>
        <PhoneMockup />
      </section>

      {/* Fitur */}
      <section id="fitur" className="border-y-2 border-dark-black-900 bg-vanilla-100 scroll-mt-[72px]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-16 md:py-20">
          <h2 className="font-figtree font-extrabold text-[32px] sm:text-[40px] tracking-tight m-0 mb-3">Semua urusan cetak, satu aplikasi</h2>
          <p className="text-[17px] text-dark-black-900/70 m-0 mb-10 max-w-[600px]">Fitur yang sama dengan dashboard web, dirapikan untuk layar HP.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className={`${card} bg-vanilla-200 p-6 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_rgba(56,56,56,1)] transition-all`}>
                <span className={`w-12 h-12 rounded-[12px] border-2 border-dark-black-900 ${f.bg} flex items-center justify-center mb-4`}>
                  <f.icon size={22} />
                </span>
                <div className="font-bold text-[18px] mb-1.5">{f.title}</div>
                <div className="text-[15px] leading-relaxed text-dark-black-900/70">{f.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cara kerja */}
      <section id="cara-kerja" className="max-w-[1200px] mx-auto px-4 sm:px-6 py-16 md:py-20 scroll-mt-[72px]">
        <h2 className="font-figtree font-extrabold text-[32px] sm:text-[40px] tracking-tight m-0 mb-10">Mulai dalam 3 langkah</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative pt-6">
              <span className="absolute top-0 left-6 w-12 h-12 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center font-geist font-bold text-[20px] shadow-[3px_3px_0_0_rgba(56,56,56,1)]">
                {i + 1}
              </span>
              <div className={`${card} p-6 pt-10 h-full`}>
                <div className="font-bold text-[18px] mb-1.5">{s.title}</div>
                <div className="text-[15px] leading-relaxed text-dark-black-900/70">{s.text}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Unduh */}
      <section id="unduh" className="border-y-2 border-dark-black-900 bg-dark-black-900 scroll-mt-[72px]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-16 md:py-20">
          <h2 className="font-figtree font-extrabold text-[32px] sm:text-[40px] tracking-tight m-0 mb-3 text-vanilla-100">Unduh KroomPrint</h2>
          <p className="text-[17px] text-vanilla-100/70 m-0 mb-10">Pilih sesuai perangkat kamu.</p>
          <div className="grid md:grid-cols-3 gap-5">
            <div className={`${card} p-6 flex flex-col gap-4 ${platform === 'android' ? 'ring-4 ring-lime-400' : ''}`}>
              <span className="w-12 h-12 rounded-[12px] border-2 border-dark-black-900 bg-ok-100 flex items-center justify-center"><IconAndroid size={24} /></span>
              <div>
                <div className="font-bold text-[20px]">Android</div>
                <div className="text-[15px] text-dark-black-900/70 mt-1">
                  {android ? `File APK v${android.version}${android.size ? `, ${formatSize(android.size)}` : ''}. Butuh izin "Install aplikasi tidak dikenal".` : 'APK sedang disiapkan. Sementara pakai web app.'}
                </div>
              </div>
              <div className="mt-auto"><AndroidButton android={android} primary /></div>
            </div>
            <div className={`${card} p-6 flex flex-col gap-4 ${platform === 'ios' ? 'ring-4 ring-lime-400' : ''}`}>
              <span className="w-12 h-12 rounded-[12px] border-2 border-dark-black-900 bg-sky-blue-100 flex items-center justify-center"><IconApple size={24} /></span>
              <div>
                <div className="font-bold text-[20px]">iPhone dan iPad</div>
                <div className="text-[15px] text-dark-black-900/70 mt-1">
                  {iosStoreUrl ? 'Tersedia lewat App Store.' : 'Pasang lewat Safari ke Home Screen. Tampil layar penuh seperti aplikasi.'}
                </div>
              </div>
              <div className="mt-auto"><IosButton storeUrl={iosStoreUrl} onGuide={openIos} primary /></div>
            </div>
            <div className={`${card} p-6 flex flex-col gap-4 ${platform === 'desktop' ? 'ring-4 ring-lime-400' : ''}`}>
              <div className="font-bold text-[20px]">Sedang di laptop?</div>
              <div className="text-[15px] text-dark-black-900/70 -mt-2">Scan QR ini pakai kamera HP untuk membuka halaman unduhan.</div>
              <div className="mx-auto w-[168px] h-[168px] rounded-[14px] border-2 border-dark-black-900 bg-white p-2 flex items-center justify-center">
                {qr ? <img src={qr} alt="QR code halaman unduh KroomPrint" className="w-full h-full" /> : null}
              </div>
              <div className="text-center font-geist text-[12px] text-dark-black-900/60 -mt-2 break-all">
                {publicOrigin().replace(/^https?:\/\//, '')}
              </div>
              <a href="/app" className="text-center font-semibold text-[14px] text-dark-black-900 underline">Atau langsung pakai web app</a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-[820px] mx-auto px-4 sm:px-6 py-16 md:py-20 scroll-mt-[72px]">
        <h2 className="font-figtree font-extrabold text-[32px] sm:text-[40px] tracking-tight m-0 mb-8">Pertanyaan umum</h2>
        <div className="flex flex-col gap-3">
          {FAQ.map((f) => (
            <details key={f.q} className={`${card} group p-0 shadow-[3px_3px_0_0_rgba(56,56,56,1)]`}>
              <summary className="cursor-pointer list-none px-5 py-4 font-bold text-[16px] flex items-center justify-between gap-4">
                {f.q}
                <span className="w-7 h-7 shrink-0 rounded-[8px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center font-geist text-[16px] group-open:rotate-45 transition-transform">+</span>
              </summary>
              <div className="px-5 pb-5 text-[15px] leading-relaxed text-dark-black-900/75">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-2 border-dark-black-900 bg-vanilla-100">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo />
          <div className="font-geist text-[12px] text-dark-black-900/60">© {new Date().getFullYear()} KroomPrint · Wireless printing</div>
          <a href="/app" className="font-semibold text-[14px] text-dark-black-900 underline">Masuk ke dashboard</a>
        </div>
      </footer>

      {showIos && <IosGuide onClose={() => setShowIos(false)} />}
    </div>
  )
}
