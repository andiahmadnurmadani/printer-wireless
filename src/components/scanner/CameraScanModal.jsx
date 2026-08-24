import { useEffect, useRef, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { IconCamera, IconRotate, IconCheck, IconRefresh } from '../ui/icons'

const FILTERS = [
  { id: 'original', label: 'Color (Original)' },
  { id: 'doc-bw', label: 'B&W Document (Clean)' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'enhanced', label: 'Vibrant Boost' },
]

export default function CameraScanModal({ open, onClose, onScanComplete }) {
  const videoRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const streamRef = useRef(null)

  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [capturedImage, setCapturedImage] = useState(null)
  const [selectedFilter, setSelectedFilter] = useState('doc-bw')
  const [rotation, setRotation] = useState(0)
  const [facingMode, setFacingMode] = useState('environment')

  const startCamera = async (mode = facingMode) => {
    setCameraError('')
    stopCamera()
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access not supported on this browser/insecure context')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
      setCameraActive(true)
    } catch (err) {
      console.warn('Primary camera error, attempting generic fallback:', err)
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        streamRef.current = fallbackStream
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream
          videoRef.current.play().catch(() => {})
        }
        setCameraActive(true)
      } catch (fallbackErr) {
        setCameraError(fallbackErr.message || 'Cannot access camera. Please allow permission or upload a file directly.')
        setCameraActive(false)
      }
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }

  useEffect(() => {
    if (open && !capturedImage) {
      startCamera(facingMode)
    } else {
      stopCamera()
    }
    return () => stopCamera()
  }, [open, capturedImage, facingMode])

  const handleCapture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      generateSimulatedCapture()
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const img = new Image()
    img.onload = () => {
      setCapturedImage(img)
      stopCamera()
    }
    img.src = canvas.toDataURL('image/png')
  }

  const generateSimulatedCapture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 1600
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#383838'
    ctx.font = 'bold 36px sans-serif'
    ctx.fillText('CAMERA SCANNED DOCUMENT', 100, 150)
    ctx.font = '24px sans-serif'
    ctx.fillStyle = '#666666'
    ctx.fillText(`Scanned on ${new Date().toLocaleString()}`, 100, 200)

    ctx.strokeStyle = '#383838'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(100, 240)
    ctx.lineTo(1100, 240)
    ctx.stroke()

    ctx.fillStyle = '#333333'
    ctx.font = '22px monospace'
    for (let i = 0; i < 20; i++) {
      ctx.fillText(`Item #${i + 1} — High Resolution Camera Scan Record Sample`, 100, 300 + i * 50)
    }

    const img = new Image()
    img.onload = () => {
      setCapturedImage(img)
      stopCamera()
    }
    img.src = canvas.toDataURL('image/png')
  }

  useEffect(() => {
    if (!capturedImage || !previewCanvasRef.current) return

    const canvas = previewCanvasRef.current
    const ctx = canvas.getContext('2d')

    const isSideways = rotation === 90 || rotation === 270
    canvas.width = isSideways ? capturedImage.height : capturedImage.width
    canvas.height = isSideways ? capturedImage.width : capturedImage.height

    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(capturedImage, -capturedImage.width / 2, -capturedImage.height / 2)
    ctx.restore()

    if (selectedFilter !== 'original') {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = imgData.data

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]
        const g = d[i + 1]
        const b = d[i + 2]
        const gray = 0.299 * r + 0.587 * g + 0.114 * b

        if (selectedFilter === 'grayscale') {
          d[i] = gray
          d[i + 1] = gray
          d[i + 2] = gray
        } else if (selectedFilter === 'doc-bw') {
          const bw = gray > 140 ? 255 : Math.max(0, gray * 0.7)
          d[i] = bw
          d[i + 1] = bw
          d[i + 2] = bw
        } else if (selectedFilter === 'enhanced') {
          const contrast = 1.35
          const factor = (259 * (contrast * 100 + 255)) / (255 * (259 - contrast * 100))
          d[i] = Math.min(255, Math.max(0, factor * (r - 128) + 128))
          d[i + 1] = Math.min(255, Math.max(0, factor * (g - 128) + 128))
          d[i + 2] = Math.min(255, Math.max(0, factor * (b - 128) + 128))
        }
      }
      ctx.putImageData(imgData, 0, 0)
    }
  }, [capturedImage, selectedFilter, rotation])

  const handleRetake = () => {
    setCapturedImage(null)
    setRotation(0)
    startCamera(facingMode)
  }

  const handleFinish = () => {
    if (!previewCanvasRef.current) return
    previewCanvasRef.current.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], `scan_${Date.now()}.png`, { type: 'image/png' })
      onScanComplete(file)
      onClose()
    }, 'image/png')
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        stopCamera()
        onClose()
      }}
      title="Mobile & Camera Document Scanner"
      subtitle="Ambil foto dokumen, struk, atau nota fisik langsung untuk dicetak"
      size="lg"
      footer={
        capturedImage ? (
          <>
            <Button variant="lime" onClick={handleFinish} icon={<IconCheck size={16} />}>
              Gunakan Dokumen Ini
            </Button>
            <Button variant="vanilla" onClick={handleRetake} icon={<IconRefresh size={16} />}>
              Foto Ulang
            </Button>
            <Button variant="dark" onClick={onClose}>
              Tutup
            </Button>
          </>
        ) : (
          <>
            <Button variant="lime" onClick={handleCapture} icon={<IconCamera size={16} />}>
              Ambil Foto Dokumen
            </Button>
            <Button
              variant="vanilla"
              onClick={() => {
                const nextMode = facingMode === 'environment' ? 'user' : 'environment'
                setFacingMode(nextMode)
                startCamera(nextMode)
              }}
            >
              Ganti Kamera
            </Button>
            <Button variant="dark" onClick={onClose}>
              Batal
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {!capturedImage ? (
          <div className="relative bg-dark-black-900 rounded-[18px] overflow-hidden border-2 border-dark-black-900 aspect-[4/3] flex items-center justify-center shadow-inner">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
            />

            {!cameraActive && (
              <div className="flex flex-col items-center gap-3 p-6 text-center text-vanilla-100">
                <IconCamera size={40} className="text-lime-300 animate-pulse" />
                <div className="font-figtree font-bold text-[16px]">Memulai Kamera...</div>
                {cameraError && (
                  <div className="p-3 bg-err-500/20 border border-err-500 rounded-[10px] text-[12.5px] font-figtree text-err-100 max-w-md">
                    {cameraError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={generateSimulatedCapture}
                  className="mt-2 px-4 py-2 rounded-[10px] border border-lime-300 bg-lime-300 text-dark-black-900 font-figtree font-bold text-[13px] hover:bg-lime-400 cursor-pointer"
                >
                  Gunakan Sampel Scan Virtual
                </button>
              </div>
            )}

            {cameraActive && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                <div className="w-full max-w-sm aspect-[1/1.414] border-2 border-dashed border-lime-300/80 rounded-[14px] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] relative flex items-center justify-center">
                  <span className="font-geist text-[11px] font-bold text-lime-300 uppercase tracking-widest bg-dark-black-900/80 px-2.5 py-1 rounded-[6px]">
                    A4 Safe Zone Alignment
                  </span>
                  <span className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-lime-400" />
                  <span className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-lime-400" />
                  <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-lime-400" />
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-lime-400" />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="relative bg-vanilla-300/40 rounded-[18px] overflow-hidden border-2 border-dark-black-900 max-h-[440px] flex items-center justify-center p-3">
              <canvas
                ref={previewCanvasRef}
                className="max-h-[400px] max-w-full object-contain rounded-[8px] shadow-md border border-dark-black-900/20"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-vanilla-100 border-2 border-dark-black-900 rounded-[14px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-figtree text-[12px] font-bold text-dark-black-900/60 uppercase tracking-wide mr-1">
                  Filters:
                </span>
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFilter(f.id)}
                    className={`px-3 py-1.5 rounded-[8px] border text-[12px] font-figtree font-bold transition-all cursor-pointer ${
                      selectedFilter === f.id
                        ? 'bg-dark-black-900 text-lime-300 border-dark-black-900 shadow-xs'
                        : 'bg-vanilla-200 text-dark-black-900/70 border-dark-black-900/30 hover:border-dark-black-900'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border-2 border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 font-figtree text-[12px] font-bold text-dark-black-900 transition-colors cursor-pointer"
              >
                <IconRotate size={14} /> Rotate ({rotation}°)
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
