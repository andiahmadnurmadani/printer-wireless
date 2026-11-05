import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { IconPrinter, IconDownload, IconCheck, IconRefresh } from '../ui/icons'
import { api } from '../../api/client'

const MODES = [
  { id: 'color', label: 'Warna' },
  { id: 'gray', label: 'Abu-abu' },
  { id: 'bw', label: 'Hitam putih' },
]
const RESOLUTIONS = [150, 300, 600]

// Scan flatbed (tanpa ADF): satu lembar per klik, halaman berikutnya ditambahkan ke PDF yang sama.
export default function PrinterScanModal({ open, onClose, printer, onScanComplete }) {
  const [mode, setMode] = useState('color')
  const [resolution, setResolution] = useState(300)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { blob, url, sessionId, pages }

  const reset = () => {
    if (result?.url) URL.revokeObjectURL(result.url)
    setResult(null)
    setError('')
  }
  useEffect(() => {
    if (!open) reset()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async () => {
    setScanning(true)
    setError('')
    try {
      const r = await api.scanFromPrinter({ printerId: printer?.id, sessionId: result?.sessionId, mode, resolution })
      if (result?.url) URL.revokeObjectURL(result.url)
      setResult({ ...r, url: URL.createObjectURL(r.blob) })
    } catch (e) {
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

  const fileName = () => `scan-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.pdf`
  const download = () => {
    const a = document.createElement('a')
    a.href = result.url
    a.download = fileName()
    a.click()
  }
  const usePdf = () => {
    onScanComplete(new File([result.blob], fileName(), { type: 'application/pdf' }))
    onClose()
  }

  const pages = result?.pages || 0
  return (
    <Modal
      open={open}
      onClose={scanning ? undefined : onClose}
      title="Scan dari Printer"
      subtitle={`${printer?.name || 'Printer'} — taruh satu lembar di kaca scanner, menghadap ke bawah`}
      size="lg"
      footer={
        <>
          <Button variant="lime" onClick={scan} disabled={scanning || !printer} icon={<IconRefresh size={16} />}>
            {scanning ? 'Memindai…' : pages ? `Scan halaman ${pages + 1}` : 'Mulai scan'}
          </Button>
          {pages > 0 && (
            <>
              <Button variant="vanilla" onClick={usePdf} disabled={scanning} icon={<IconPrinter size={16} />}>
                Cetak / pakai di Print Studio
              </Button>
              <Button variant="vanilla" onClick={download} disabled={scanning} icon={<IconDownload size={16} />}>
                Unduh / simpan PDF
              </Button>
            </>
          )}
          <Button variant="dark" onClick={onClose} disabled={scanning}>
            Tutup
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 font-figtree text-[14px] text-dark-black-900">
        <div className="flex flex-wrap gap-6">
          <label className="flex flex-col gap-1">
            <span className="font-bold">Mode</span>
            <select
              className="border-2 border-dark-black-900 rounded-[10px] px-3 py-2 bg-white"
              value={mode}
              disabled={scanning}
              onChange={(e) => setMode(e.target.value)}
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold">Resolusi</span>
            <select
              className="border-2 border-dark-black-900 rounded-[10px] px-3 py-2 bg-white"
              value={resolution}
              disabled={scanning}
              onChange={(e) => setResolution(Number(e.target.value))}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>{r} dpi</option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-dark-black-900/70">
          Scanner tidak punya pengumpan otomatis: setelah satu halaman selesai, ganti kertas di kaca lalu klik
          "Scan halaman berikutnya". Satu halaman butuh ±20 detik (lebih lama di 600 dpi / warna).
        </p>

        {error && (
          <div role="alert" className="border-2 border-err-500 rounded-[12px] p-3 text-err-500 font-bold">{error}</div>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 font-bold">
              <IconCheck size={16} /> {pages} halaman terscan
            </div>
            <iframe title="Hasil scan" src={result.url} className="w-full h-[50vh] border-2 border-dark-black-900 rounded-[12px] bg-white" />
          </div>
        )}
      </div>
    </Modal>
  )
}
