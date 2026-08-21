import { useEffect, useRef, useState, useMemo } from 'react'
import { renderPdfPageToCanvas } from '../../utils/pdfHelper'
import { IconEye, IconRefresh } from '../ui/icons'

/**
 * High-fidelity interactive print sheet preview component.
 * Dynamically reacts to Paper Size, Orientation, Scaling Mode, Print Quality, Color Mode, and Duplex.
 */
export default function PrintSheetPreview({
  file,
  fileType = 'PDF',
  pdfDoc = null,
  currentPage = 1,
  totalPages = 1,
  paperDim,
  orientation = 'Portrait',
  color = true,
  scaling = 'Fit to page',
  quality = 'Standard',
  duplex = false,
  onPrevPage,
  onNextPage,
  onSelectPage,
  onOpenFinalModal,
  showMargins = true,
  isFlipped = false,
  onToggleFlip,
}) {
  const canvasRef = useRef(null)
  const [renderLoading, setRenderLoading] = useState(false)
  const [imgUrl, setImgUrl] = useState(null)
  const [textContent, setTextContent] = useState('')
  const [textPages, setTextPages] = useState([])

  const isPdf = fileType === 'PDF' || file?.name?.toLowerCase().endsWith('.pdf')
  const isImage = ['PNG', 'JPG', 'JPEG', 'WEBP', 'BMP', 'HEIC', 'SVG'].includes(fileType) ||
    /\.(png|jpe?g|webp|bmp|heic|svg)$/i.test(file?.name || '')
  const isText = ['TXT', 'CSV', 'JSON', 'LOG', 'MD'].includes(fileType) ||
    /\.(txt|csv|json|log|md)$/i.test(file?.name || '')

  // Create image / text previews
  useEffect(() => {
    if (!file) {
      setImgUrl(null)
      setTextContent('')
      setTextPages([])
      return
    }

    if (isImage) {
      const url = URL.createObjectURL(file)
      setImgUrl(url)
      return () => URL.revokeObjectURL(url)
    }

    if (isText) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target.result || ''
        setTextContent(text)
        const lines = text.split('\n')
        const pages = []
        const perPage = 40
        for (let i = 0; i < lines.length; i += perPage) {
          pages.push(lines.slice(i, i + perPage).join('\n'))
        }
        setTextPages(pages.length > 0 ? pages : [text])
      }
      reader.readAsText(file)
    }
  }, [file, isImage, isText])

  // Render PDF page to canvas (re-renders on quality/page/pdfDoc change)
  useEffect(() => {
    if (!isPdf || !pdfDoc || !canvasRef.current) return

    let cancelled = false
    setRenderLoading(true)

    // Higher target width for High/Photo quality
    const targetW = quality === 'Photo' || quality === 'High' ? 1200 : quality === 'Draft' ? 600 : 900

    renderPdfPageToCanvas(pdfDoc, currentPage, canvasRef.current, targetW)
      .catch((err) => {
        console.warn('PDF render error:', err)
      })
      .finally(() => {
        if (!cancelled) setRenderLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isPdf, pdfDoc, currentPage, quality])

  // ── Compute Visual Scaling Styles ──
  const scalingStyles = useMemo(() => {
    switch (scaling) {
      case 'Shrink to fit':
        return {
          wrapperClass: 'p-6 flex items-center justify-center',
          transform: 'scale(0.86)',
          imgClass: 'object-contain max-h-full max-w-full rounded-[2px]',
          label: 'Shrink to Fit (86% + Extra Margins)',
        }
      case 'Actual size':
        return {
          wrapperClass: 'p-2 flex items-center justify-center overflow-hidden',
          transform: 'scale(1.16)',
          imgClass: 'object-none max-h-none max-w-none',
          label: 'Actual Size 1:1 (Full Unscaled Content)',
        }
      case 'Custom':
        return {
          wrapperClass: 'p-0 flex items-center justify-center',
          transform: 'scale(1.0)',
          imgClass: 'object-cover w-full h-full',
          label: 'Full Bleed / Borderless (Edge-to-Edge)',
        }
      case 'Fit to page':
      default:
        return {
          wrapperClass: 'p-3 flex items-center justify-center',
          transform: 'scale(1.0)',
          imgClass: 'object-contain max-h-full max-w-full',
          label: 'Fit to Page (Standard 5mm Margins)',
        }
    }
  }, [scaling])

  // ── Compute Visual Quality & Color Filter ──
  const { visualFilter, qualityBadge } = useMemo(() => {
    let filter = ''

    if (!color) {
      filter += 'grayscale(100%) '
    }

    let badge = { text: '300 DPI · Standard', cls: 'bg-sky-blue-100 text-dark-black-900', ink: '100% ink density' }
    let opacity = 1.0

    switch (quality) {
      case 'Draft':
        filter += color ? 'contrast(0.88) brightness(1.03)' : 'contrast(0.90) brightness(1.04)'
        opacity = 0.82
        badge = { text: '150 DPI · Draft (Ink Saver)', cls: 'bg-warn-100 text-warn-500', ink: 'Faint ink / Fast' }
        break
      case 'High':
        filter += color ? 'contrast(1.10) saturate(1.08)' : 'contrast(1.18)'
        opacity = 1.0
        badge = { text: '600 DPI · High Quality', cls: 'bg-lime-300 text-dark-black-900', ink: 'Rich deep blacks' }
        break
      case 'Photo':
        filter += color ? 'contrast(1.16) saturate(1.24)' : 'contrast(1.22)'
        opacity = 1.0
        badge = { text: '1200 DPI · Ultra Photo', cls: 'bg-watermelon-500/20 text-dark-black-900', ink: 'Ultra glossy / Fine' }
        break
      case 'Standard':
      default:
        filter += color ? 'contrast(1.0)' : 'contrast(1.08)'
        opacity = 1.0
        badge = { text: '300 DPI · Standard', cls: 'bg-vanilla-300 text-dark-black-900', ink: 'Standard coverage' }
        break
    }

    return {
      visualFilter: { filter: filter.trim(), opacity },
      qualityBadge: badge,
    }
  }, [quality, color])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Live Parameters Control & Status Strip ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap bg-vanilla-100 border-2 border-dark-black-900 p-2.5 rounded-[14px] shadow-[2px_2px_0_0_rgba(56,56,56,1)]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] bg-dark-black-900 text-lime-300 font-geist text-[11.5px] font-bold">
            {paperDim.name}
          </span>
          <span className="font-geist text-[11px] text-dark-black-900/60 font-medium">
            {paperDim.widthMm} × {paperDim.heightMm} mm
          </span>
          <span className="text-dark-black-900/30 font-geist">•</span>
          <span className="font-figtree text-[12px] font-semibold text-dark-black-900">
            {orientation}
          </span>
          <span className="text-dark-black-900/30 font-geist">•</span>
          <span className={`font-geist text-[11px] font-semibold px-2 py-0.5 rounded-[5px] ${qualityBadge.cls}`}>
            {qualityBadge.text}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {duplex && (
            <button
              type="button"
              onClick={onToggleFlip}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 text-[12px] font-figtree font-medium transition-colors cursor-pointer"
              title="Flip sheet to inspect front/back"
            >
              <IconRefresh size={13} />
              {isFlipped ? 'Back Side' : 'Front Side'}
            </button>
          )}

          {onOpenFinalModal && (
            <button
              type="button"
              onClick={onOpenFinalModal}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[8px] border border-dark-black-900 bg-lime-300 hover:bg-lime-400 text-[12px] font-figtree font-bold transition-colors cursor-pointer"
            >
              <IconEye size={14} /> Full Inspection
            </button>
          )}
        </div>
      </div>

      {/* ── Virtual Paper Stage (Responsive Preview Area) ── */}
      <div className="relative w-full rounded-[20px] border-2 border-dark-black-900 bg-dark-black-900/5 p-6 md:p-8 flex flex-col items-center justify-center min-h-[420px] overflow-hidden">
        {/* Background Grid Lines simulating real print bed */}
        <div
          className="absolute inset-0 opacity-[0.14] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, #383838 1px, transparent 1px), linear-gradient(to bottom, #383838 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />

        {/* ── Real-Size Virtual Paper Sheet ── */}
        <div
          style={{
            width: `${paperDim.baseWidthPx}px`,
            maxWidth: '100%',
            aspectRatio: `${paperDim.widthMm} / ${paperDim.heightMm}`,
          }}
          className={`relative bg-white rounded-[3px] border-2 border-dark-black-900 shadow-[8px_8px_0px_0px_rgba(56,56,56,0.95)] transition-all duration-300 flex flex-col overflow-hidden select-none ${
            isFlipped ? 'scale-x-[-1]' : ''
          }`}
        >
          {/* Printable Margin Guideline (5mm boundary) */}
          {showMargins && (
            <div className="absolute inset-[10px] border border-dashed border-sky-blue-500/60 pointer-events-none rounded-[2px] z-20 flex flex-col justify-between p-1">
              <span className="text-[7.5px] font-geist font-bold text-sky-blue-500/80 tracking-wider leading-none">
                PRINTABLE SAFE ZONE ({paperDim.name})
              </span>
              <span className="text-[7.5px] font-geist text-sky-blue-500/80 text-right tracking-wider leading-none">
                {paperDim.widthMm} × {paperDim.heightMm} mm · {orientation}
              </span>
            </div>
          )}

          {/* Registration Crop Marks at Corners */}
          <div className="absolute top-1 left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-dark-black-900/40 pointer-events-none z-20" />
          <div className="absolute top-1 right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-dark-black-900/40 pointer-events-none z-20" />
          <div className="absolute bottom-1 left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-dark-black-900/40 pointer-events-none z-20" />
          <div className="absolute bottom-1 right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-dark-black-900/40 pointer-events-none z-20" />

          {/* ── Document Content Area with Applied Scaling & Visual Quality Filter ── */}
          <div
            style={visualFilter}
            className={`w-full h-full flex-1 flex items-center justify-center relative overflow-hidden bg-white transition-all duration-200 ${scalingStyles.wrapperClass}`}
          >
            {renderLoading && isPdf && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex items-center justify-center z-10">
                <span className="w-6 h-6 border-2 border-dark-black-900 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Document Content */}
            <div
              style={{ transform: scalingStyles.transform }}
              className="w-full h-full flex items-center justify-center transition-transform duration-200"
            >
              {isPdf ? (
                <canvas
                  ref={canvasRef}
                  className="w-full h-full object-contain pointer-events-none"
                />
              ) : isImage && imgUrl ? (
                <img
                  src={imgUrl}
                  alt="Document preview"
                  className={`${scalingStyles.imgClass} transition-all duration-200`}
                />
              ) : isText ? (
                <div className="w-full h-full p-4 overflow-hidden flex flex-col justify-between">
                  <div className="border-b border-dark-black-900/15 pb-1 mb-2 flex justify-between font-geist text-[8.5px] text-dark-black-900/60 font-semibold">
                    <span>{file?.name}</span>
                    <span>Page {currentPage} of {Math.max(1, textPages.length)}</span>
                  </div>
                  <pre className="font-geist text-[9px] leading-relaxed text-dark-black-900/85 whitespace-pre-wrap break-words overflow-hidden font-normal flex-1">
                    {textPages[currentPage - 1] || textContent}
                  </pre>
                  <div className="border-t border-dark-black-900/15 pt-1 mt-auto flex justify-between font-geist text-[7.5px] text-dark-black-900/50">
                    <span>{paperDim.label}</span>
                    <span>KroomPrint Simulated Output</span>
                  </div>
                </div>
              ) : (
                // Office Doc / Generic File Mockup
                <div className="w-full h-full p-5 flex flex-col justify-between">
                  <div>
                    <div className="w-14 h-3 bg-dark-black-900/80 rounded-[2px] mb-3" />
                    <div className="w-3/4 h-2.5 bg-dark-black-900/35 rounded-[2px] mb-2" />
                    <div className="w-full h-2 bg-dark-black-900/20 rounded-[2px] mb-1.5" />
                    <div className="w-5/6 h-2 bg-dark-black-900/20 rounded-[2px] mb-1.5" />
                    <div className="w-4/5 h-2 bg-dark-black-900/20 rounded-[2px] mb-3" />
                    <div className="w-full h-24 bg-vanilla-300/40 rounded-[6px] border-2 border-dashed border-dark-black-900/20 flex flex-col items-center justify-center text-dark-black-900/50 font-geist text-[11px]">
                      <span className="font-bold">{fileType} Document</span>
                      <span className="text-[9px]">Scaled for {paperDim.name}</span>
                    </div>
                  </div>
                  <div className="flex justify-between font-geist text-[8.5px] text-dark-black-900/50">
                    <span>{file?.name}</span>
                    <span>Sheet {currentPage}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Parameter Feedback Indicator under Paper */}
        <div className="mt-4 flex items-center justify-center gap-3 text-[12px] font-geist text-dark-black-900/75 flex-wrap text-center">
          <span className="bg-vanilla-100 border border-dark-black-900/20 px-2.5 py-1 rounded-[6px]">
            📐 <span className="font-bold text-dark-black-900">{paperDim.label}</span>
          </span>
          <span className="bg-vanilla-100 border border-dark-black-900/20 px-2.5 py-1 rounded-[6px]">
            🔍 <span className="font-bold text-dark-black-900">{scalingStyles.label}</span>
          </span>
          <span className="bg-vanilla-100 border border-dark-black-900/20 px-2.5 py-1 rounded-[6px]">
            🎨 <span className={`font-bold ${color ? 'text-ok-500' : 'text-dark-black-900'}`}>{color ? 'Full Color (RGB)' : 'Grayscale (B&W)'}</span>
          </span>
        </div>
      </div>

      {/* ── Bottom Page Navigation Bar ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-vanilla-100 border-2 border-dark-black-900 rounded-[14px] p-2.5 shadow-[2px_2px_0px_0px_rgba(56,56,56,1)]">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="px-3.5 py-1.5 rounded-[9px] border border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 disabled:opacity-40 disabled:hover:bg-vanilla-200 font-figtree text-[13px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
          >
            ← Previous
          </button>

          <div className="flex items-center gap-2 font-figtree text-[13.5px] font-medium text-dark-black-900">
            <span>Page</span>
            <input
              type="number"
              min="1"
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (val >= 1 && val <= totalPages) onSelectPage(val)
              }}
              className="w-12 text-center py-1 rounded-[7px] border border-dark-black-900 bg-white font-geist text-[13px] font-bold focus:outline-none focus:bg-lime-300"
            />
            <span className="text-dark-black-900/60">of {totalPages}</span>
          </div>

          <button
            type="button"
            onClick={onNextPage}
            disabled={currentPage >= totalPages}
            className="px-3.5 py-1.5 rounded-[9px] border border-dark-black-900 bg-vanilla-200 hover:bg-lime-300 disabled:opacity-40 disabled:hover:bg-vanilla-200 font-figtree text-[13px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
