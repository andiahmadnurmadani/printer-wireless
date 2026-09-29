import { useEffect, useRef, useState, useMemo } from 'react'
import { renderPdfPageToCanvas } from '../../utils/pdfHelper'
import {
  IconEye,
  IconRefresh,
  IconRuler,
  IconSearch,
  IconFile,
  IconDroplet,
  IconCheck,
  IconCrop,
  IconRotateCw,
  IconOrientationPortrait,
  IconOrientationLandscape,
} from '../ui/icons'
import {
  calculateImageLayout,
  DEFAULT_IMAGE_CONFIG,
  ALIGNMENT_GRID,
} from '../../utils/imageLayoutHelper'
import { DEFAULT_DOC_CONFIG } from './DocumentLayoutControls'

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
  nUp = 1,
  watermark = '',
  mediaType = 'Plain Paper',
  inputTray = 'Auto Select',
  onPrevPage,
  onNextPage,
  onSelectPage,
  onOpenFinalModal,
  showMargins = true,
  isFlipped = false,
  onToggleFlip,
  imgConfig = DEFAULT_IMAGE_CONFIG,
  onUpdateImgConfig,
  docConfig = DEFAULT_DOC_CONFIG,
  onUpdateDocConfig,
  onSetOrientation,
}) {
  const canvasRef = useRef(null)
  const photoContainerRef = useRef(null)
  const [renderLoading, setRenderLoading] = useState(false)
  const [imgUrl, setImgUrl] = useState(null)
  const [imgNatural, setImgNatural] = useState({ width: 1200, height: 800 })
  const [textContent, setTextContent] = useState('')
  const [textPages, setTextPages] = useState([])
  const [isDraggingCrop, setIsDraggingCrop] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, startCropX: 50, startCropY: 50 })

  const handleCropMouseDown = (e) => {
    if (imgConfig?.fitMode !== 'cover' || !onUpdateImgConfig) return
    e.preventDefault()
    setIsDraggingCrop(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startCropX: imgConfig?.cropPositionX ?? 50,
      startCropY: imgConfig?.cropPositionY ?? 50,
    }
  }

  useEffect(() => {
    if (!isDraggingCrop) return
    const handleCropMouseMove = (e) => {
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      const zoom = (imgConfig?.zoomLevel ?? 100) / 100
      const sensitivity = 0.45 / Math.max(0.4, zoom)

      // Calculate effective image aspect ratio vs container box aspect ratio
      const imgW = imgNatural?.width || 1200
      const imgH = imgNatural?.height || 800
      const rot = (imgConfig?.rotation || 0) % 360
      const isRot90 = rot === 90 || rot === 270
      const naturalW = isRot90 ? imgH : imgW
      const naturalH = isRot90 ? imgW : imgH
      const imgAspect = naturalW / naturalH

      const item = imageLayout?.gridItems?.[0]
      const boxAspect = item && item.wPx && item.hPx ? (item.wPx / item.hPx) : (210 / 297)

      const hasZoom = zoom > 1.05
      // If image is wider than box, only X overflows (Y fits perfectly, lock Y at center 50%)
      // If image is taller than box, only Y overflows (X fits perfectly, lock X at center 50%)
      const canScrollX = hasZoom || imgAspect > boxAspect * 1.02
      const canScrollY = hasZoom || imgAspect < boxAspect * 0.98

      let nextX = dragStartRef.current.startCropX
      let nextY = dragStartRef.current.startCropY

      if (canScrollX && !canScrollY) {
        // Only horizontal can move; vertical MUST stay strictly at center 50%
        nextX = Math.max(0, Math.min(100, Math.round(dragStartRef.current.startCropX - dx * sensitivity)))
        nextY = 50
      } else if (canScrollY && !canScrollX) {
        // Only vertical can move; horizontal MUST stay strictly at center 50%
        nextY = Math.max(0, Math.min(100, Math.round(dragStartRef.current.startCropY - dy * sensitivity)))
        nextX = 50
      } else if (canScrollX && canScrollY) {
        // Both can move (e.g. zoomed in). Use axis snapping so intentional horizontal/vertical drags don't drift
        const absX = Math.abs(dx)
        const absY = Math.abs(dy)
        if (absX > absY * 1.6) {
          // Dominant horizontal drag: keep Y unchanged
          nextX = Math.max(0, Math.min(100, Math.round(dragStartRef.current.startCropX - dx * sensitivity)))
          nextY = dragStartRef.current.startCropY
        } else if (absY > absX * 1.6) {
          // Dominant vertical drag: keep X unchanged
          nextX = dragStartRef.current.startCropX
          nextY = Math.max(0, Math.min(100, Math.round(dragStartRef.current.startCropY - dy * sensitivity)))
        } else {
          // Diagonal drag
          nextX = Math.max(0, Math.min(100, Math.round(dragStartRef.current.startCropX - dx * sensitivity)))
          nextY = Math.max(0, Math.min(100, Math.round(dragStartRef.current.startCropY - dy * sensitivity)))
        }
      }

      onUpdateImgConfig({
        ...imgConfig,
        cropPositionX: nextX,
        cropPositionY: nextY,
      })
    }
    const handleCropMouseUp = () => {
      setIsDraggingCrop(false)
    }
    window.addEventListener('mousemove', handleCropMouseMove)
    window.addEventListener('mouseup', handleCropMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleCropMouseMove)
      window.removeEventListener('mouseup', handleCropMouseUp)
    }
  }, [isDraggingCrop, imgConfig, onUpdateImgConfig])

  // Wheel zoom handler on virtual paper photo preview — ONLY active in Fill (Crop) mode
  useEffect(() => {
    const el = photoContainerRef.current
    if (!el || !onUpdateImgConfig) return
    // Only allow zoom when user chooses Fill (Crop)
    if (imgConfig?.fitMode !== 'cover') return

    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY < 0 ? 5 : -5
      const currentZoom = imgConfig?.zoomLevel ?? 100
      const nextZoom = Math.max(30, Math.min(250, currentZoom + delta))
      if (nextZoom !== currentZoom) {
        onUpdateImgConfig({
          ...imgConfig,
          zoomLevel: nextZoom,
        })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
    }
  }, [imgConfig, onUpdateImgConfig])

  const isPdf = !!pdfDoc || fileType === 'PDF' || file?.name?.toLowerCase().endsWith('.pdf')
  const isImage = ['PNG', 'JPG', 'JPEG', 'WEBP', 'BMP', 'HEIC', 'SVG'].includes(fileType) ||
    /\.(png|jpe?g|webp|bmp|heic|svg)$/i.test(file?.name || '')
  const isText = ['TXT', 'CSV', 'JSON', 'LOG', 'MD'].includes(fileType) ||
    /\.(txt|csv|json|log|md)$/i.test(file?.name || '')

  // Create image / text previews & measure image natural dimensions
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
      const probe = new Image()
      probe.onload = () => {
        setImgNatural({ width: probe.naturalWidth, height: probe.naturalHeight })
      }
      probe.src = url
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

  // ── Compute Image Layout & Placement (for photo/image printing) ──
  const imageLayout = useMemo(() => {
    if (!isImage) return null
    return calculateImageLayout({
      paperDim,
      imgConfig: imgConfig || DEFAULT_IMAGE_CONFIG,
      imgNaturalWidth: imgNatural.width,
      imgNaturalHeight: imgNatural.height,
      showMargins,
    })
  }, [isImage, paperDim, imgConfig, imgNatural, showMargins])

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

          {/* Quick interactive Paper Orientation button */}
          {onSetOrientation ? (
            <button
              type="button"
              onClick={() => onSetOrientation(orientation === 'Portrait' ? 'Landscape' : 'Portrait')}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] border border-dark-black-900 bg-white hover:bg-lime-300 text-dark-black-900 font-figtree text-[11.5px] font-bold transition-all shadow-[1px_1px_0_0_rgba(56,56,56,1)] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
              title="Klik untuk ganti orientasi kertas cetak (Portrait / Landscape)"
            >
              {orientation === 'Landscape' ? (
                <IconOrientationLandscape size={13} className="text-dark-black-900" />
              ) : (
                <IconOrientationPortrait size={13} className="text-dark-black-900" />
              )}
              <span>Kertas: {orientation}</span>
            </button>
          ) : (
            <span className="font-figtree text-[12px] font-semibold text-dark-black-900">
              Kertas: {orientation}
            </span>
          )}

          {/* Quick Photo Rotation Button: 0° / 90° / 180° / 270° */}
          {isImage && onUpdateImgConfig && (
            <>
              <span className="text-dark-black-900/30 font-geist">•</span>
              <button
                type="button"
                onClick={() => {
                  const nextRot = ((imgConfig?.rotation || 0) + 90) % 360
                  onUpdateImgConfig({
                    ...imgConfig,
                    rotation: nextRot,
                  })
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] border border-dark-black-900 font-figtree text-[11.5px] font-bold transition-all shadow-[1px_1px_0_0_rgba(56,56,56,1)] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer ${
                  (imgConfig?.rotation || 0) !== 0
                    ? 'bg-amber-300 text-dark-black-900'
                    : 'bg-white hover:bg-lime-300 text-dark-black-900'
                }`}
                title="Putar / Rotasi Foto di atas kertas (0°, 90°, 180°, 270°)"
              >
                <IconRotateCw size={12} className="text-dark-black-900" />
                <span>Rotasi Foto: {imgConfig?.rotation || 0}°</span>
              </button>
            </>
          )}

          {/* Quick Fit Utuh (Tanpa Potong) vs Fill (Crop Tepi) segmented selector for Photos */}
          {isImage && onUpdateImgConfig && (
            <>
              <span className="text-dark-black-900/30 font-geist">•</span>
              <div className="inline-flex items-center rounded-[7px] border border-dark-black-900 bg-white p-0.5 shadow-xs">
                <button
                  type="button"
                  onClick={() => {
                    onUpdateImgConfig({
                      ...imgConfig,
                      sizePreset: 'fit',
                      fitMode: 'contain',
                      zoomLevel: 100,
                      cropPositionX: 50,
                      cropPositionY: 50,
                    })
                  }}
                  className={`px-2 py-0.5 rounded-[5px] font-figtree text-[11px] font-bold transition-all cursor-pointer ${
                    imgConfig?.fitMode !== 'cover'
                      ? 'bg-dark-black-900 text-lime-300 shadow-xs'
                      : 'text-dark-black-900/70 hover:text-dark-black-900 hover:bg-vanilla-200'
                  }`}
                  title="Foto Utuh 100% tanpa terpotong (Sangat disarankan untuk poster/foto yang sudah dipotong sendiri)"
                >
                  Fit Utuh (Tanpa Potong)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateImgConfig({
                      ...imgConfig,
                      sizePreset: 'fill',
                      fitMode: 'cover',
                    })
                  }}
                  className={`px-2 py-0.5 rounded-[5px] font-figtree text-[11px] font-bold transition-all cursor-pointer ${
                    imgConfig?.fitMode === 'cover'
                      ? 'bg-dark-black-900 text-lime-300 shadow-xs'
                      : 'text-dark-black-900/70 hover:text-dark-black-900 hover:bg-vanilla-200'
                  }`}
                  title="Penuh Kertas (Sisi tepi foto akan terpotong jika rasio foto berbeda dengan kertas)"
                >
                  Fill (Crop Tepi)
                </button>
              </div>
            </>
          )}

          <span className="text-dark-black-900/30 font-geist">•</span>
          <span className={`font-geist text-[11px] font-semibold px-2 py-0.5 rounded-[5px] ${qualityBadge.cls}`}>
            {qualityBadge.text}
          </span>
          {isImage && imageLayout && (
            <>
              <span className="text-dark-black-900/30 font-geist">•</span>
              <span className="font-geist text-[11px] font-bold text-dark-black-900 bg-lime-300/80 px-2 py-0.5 rounded-[5px] border border-dark-black-900/20">
                {imageLayout.dimensionLabel}
              </span>
            </>
          )}

          {/* Quick PDF / Document Rotation Button */}
          {!isImage && onUpdateDocConfig && (
            <>
              <span className="text-dark-black-900/30 font-geist">•</span>
              <button
                type="button"
                onClick={() => {
                  const nextRot = ((docConfig?.rotation || 0) + 90) % 360
                  onUpdateDocConfig({ rotation: nextRot })
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] border border-dark-black-900 font-figtree text-[11.5px] font-bold transition-all shadow-[1px_1px_0_0_rgba(56,56,56,1)] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer ${
                  (docConfig?.rotation || 0) !== 0
                    ? 'bg-amber-300 text-dark-black-900'
                    : 'bg-white hover:bg-lime-300 text-dark-black-900'
                }`}
                title="Putar / Rotasi Dokumen (0°, 90°, 180°, 270°)"
              >
                <IconRotateCw size={12} className="text-dark-black-900" />
                <span>Rotasi: {docConfig?.rotation || 0}°</span>
              </button>
            </>
          )}

          {/* Quick PDF Scale Indicator */}
          {!isImage && docConfig?.scaleMode && (
            <>
              <span className="text-dark-black-900/30 font-geist">•</span>
              <span className="font-geist text-[11px] font-bold text-dark-black-900 bg-lime-300/80 px-2 py-0.5 rounded-[5px] border border-dark-black-900/20">
                Skala: {docConfig.scaleMode === 'custom' ? `${docConfig.customScale}%` : docConfig.scaleMode === 'actual' ? '100%' : docConfig.scaleMode === 'shrink' ? 'Kecilkan' : docConfig.scaleMode === 'fill' ? 'Penuh' : 'Fit'}
              </span>
            </>
          )}
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
          {/* Printable Margin Guideline (hidden for images or when margins disabled) */}
          {showMargins && !isImage && (
            <div
              style={{ inset: `${paperDim.safeZoneInsetPx}px` }}
              className="absolute border border-dashed border-sky-blue-500/60 pointer-events-none rounded-[2px] z-20 flex flex-col justify-between p-1"
            >
              <span className="text-[7.5px] font-geist font-bold text-sky-blue-500/80 tracking-wider leading-none">
                PRINTABLE SAFE ZONE ({paperDim.name})
              </span>
              <span className="text-[7.5px] font-geist text-sky-blue-500/80 text-right tracking-wider leading-none">
                {paperDim.widthMm} × {paperDim.heightMm} mm · {orientation}
              </span>
            </div>
          )}

          {/* ── Document Content Area with Applied Scaling & Visual Quality Filter ── */}
          <div
            style={visualFilter}
            className={`w-full h-full flex-1 relative overflow-hidden bg-white transition-all duration-200 ${
              isImage ? 'p-0' : `${scalingStyles.wrapperClass} flex items-center justify-center`
            }`}
          >
            {renderLoading && isPdf && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex items-center justify-center z-10">
                <span className="w-6 h-6 border-2 border-dark-black-900 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Watermark Overlay */}
            {watermark && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 overflow-hidden select-none">
                <span
                  className="font-figtree font-black uppercase text-dark-black-900/20 tracking-widest text-[36px] sm:text-[46px] md:text-[54px] -rotate-45 whitespace-nowrap"
                  style={{ letterSpacing: '0.2em' }}
                >
                  {watermark}
                </span>
              </div>
            )}

            {/* Document Content */}
            {isImage && imgUrl && imageLayout ? (
              /* Custom Photo Layout & Placement on Paper */
              <div ref={photoContainerRef} className="relative w-full h-full overflow-hidden select-none">
                {imageLayout.gridItems.map((item) => (
                  <div
                    key={item.index}
                    style={{
                      position: 'absolute',
                      left: `${item.xPx}px`,
                      top: `${item.yPx}px`,
                      width: `${item.wPx}px`,
                      height: `${item.hPx}px`,
                    }}
                    className={`overflow-hidden ${
                      imgConfig?.repeat > 1 ? 'border border-dashed border-dark-black-900/30 shadow-xs' : ''
                    } bg-white transition-all duration-150 ${
                      imageLayout.isOverflow ? 'ring-2 ring-warn-500' : ''
                    } ${imgConfig?.fitMode === 'cover' ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    onMouseDown={imgConfig?.fitMode === 'cover' ? handleCropMouseDown : undefined}
                  >
                    {(() => {
                      const isCover = imgConfig?.fitMode === 'cover'
                      const zoom = isCover ? ((imgConfig?.zoomLevel ?? 100) / 100) : 1
                      const cropX = isCover ? (imgConfig?.cropPositionX ?? 50) : 50
                      const cropY = isCover ? (imgConfig?.cropPositionY ?? 50) : 50
                      const hasZoom = zoom !== 1
                      const rot = (imgConfig?.rotation || 0) % 360
                      const isRot90 = rot === 90 || rot === 270

                      const imgStyle = isRot90
                        ? {
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            width: `${item.hPx}px`,
                            height: `${item.wPx}px`,
                            transform: `translate(-50%, -50%) rotate(${rot}deg)${hasZoom ? ` scale(${zoom})` : ''}`,
                            transformOrigin: 'center center',
                            objectPosition: (isCover || hasZoom) ? `${cropX}% ${cropY}%` : 'center center',
                          }
                        : {
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: '100%',
                            height: '100%',
                            transform: rot !== 0
                              ? `rotate(${rot}deg)${hasZoom ? ` scale(${zoom})` : ''}`
                              : hasZoom
                                ? `scale(${zoom})`
                                : undefined,
                            transformOrigin: (isCover || hasZoom) ? `${cropX}% ${cropY}%` : 'center center',
                            objectPosition: (isCover || hasZoom) ? `${cropX}% ${cropY}%` : 'center center',
                          }

                      return (
                        <img
                          src={imgUrl}
                          alt="Print document item"
                          style={imgStyle}
                          className={`pointer-events-none select-none transition-transform duration-75 ${
                            isCover ? 'object-cover' : 'object-contain'
                          }`}
                        />
                      )
                    })()}
                    {imgConfig?.repeat > 1 && (
                      <div className="absolute bottom-0.5 right-0.5 pointer-events-none bg-dark-black-900/80 text-white font-geist text-[6.5px] font-bold px-1 rounded-[1.5px] leading-tight">
                        {Math.round(item.wMm)}×{Math.round(item.hMm)}mm
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  transform: docConfig?.scaleMode === 'custom'
                    ? `scale(${Math.max(0.25, Math.min(2.0, (docConfig?.customScale || 100) / 100))}) rotate(${docConfig?.rotation || 0}deg)`
                    : docConfig?.rotation
                      ? `${scalingStyles.transform} rotate(${docConfig.rotation}deg)`
                      : scalingStyles.transform,
                  padding: docConfig?.marginPreset === 'none'
                    ? '0px'
                    : docConfig?.marginPreset === 'minimum'
                      ? '6px'
                      : docConfig?.marginPreset === 'custom' && docConfig?.margins
                        ? `${docConfig.margins.top}px ${docConfig.margins.right}px ${docConfig.margins.bottom}px ${docConfig.margins.left}px`
                        : undefined,
                  transition: 'transform 0.15s ease-out, padding 0.15s ease-out',
                }}
                className="w-full h-full flex items-center justify-center"
              >
                {nUp > 1 ? (
                  /* N-Up Multi-Page Grid Simulation */
                  <div
                    className={`w-full h-full p-2 grid gap-1.5 items-center justify-center ${
                      nUp === 2 ? 'grid-cols-2' : nUp === 4 ? 'grid-cols-2 grid-rows-2' : nUp === 6 ? 'grid-cols-3 grid-rows-2' : nUp === 9 ? 'grid-cols-3 grid-rows-3' : 'grid-cols-4 grid-rows-4'
                    }`}
                  >
                    {Array.from({ length: nUp }).map((_, idx) => {
                      const subPage = (currentPage - 1) * nUp + idx + 1
                      return (
                        <div
                          key={idx}
                          className="w-full h-full border border-dark-black-900/30 rounded-[2px] bg-vanilla-100 p-1 flex flex-col justify-between overflow-hidden shadow-xs"
                        >
                          <div className="flex justify-between items-center font-geist text-[6px] text-dark-black-900/50">
                            <span>P.{subPage}</span>
                            <span>{subPage <= totalPages ? <IconCheck size={7} strokeWidth={3} className="text-ok-500" /> : '—'}</span>
                          </div>
                          <div className="w-full h-full flex flex-col gap-0.5 my-auto justify-center px-1">
                            <div className="w-2/3 h-1 bg-dark-black-900/40 rounded-[1px]" />
                            <div className="w-full h-0.5 bg-dark-black-900/20 rounded-[1px]" />
                            <div className="w-4/5 h-0.5 bg-dark-black-900/20 rounded-[1px]" />
                          </div>
                          <div className="text-[5.5px] font-geist text-dark-black-900/40 text-center">
                            {nUp}-Up Sheet
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : isPdf ? (
                  <canvas
                    ref={canvasRef}
                    className="w-full h-full object-contain pointer-events-none"
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
            )}
          </div>
        </div>

        {/* Dynamic Parameter Feedback Indicator under Paper */}
        <div className="mt-4 flex items-center justify-center gap-2.5 text-[11.5px] font-geist text-dark-black-900/75 flex-wrap text-center">
          <span className="inline-flex items-center gap-1 bg-vanilla-100 border border-dark-black-900/20 px-2.5 py-1 rounded-[6px]">
            <IconRuler size={13} className="text-dark-black-900/60" />
            <span className="font-bold text-dark-black-900">{paperDim.label}</span>
          </span>
          {isImage && imageLayout ? (
            <span className="inline-flex items-center gap-1 bg-lime-300 border border-dark-black-900/30 px-2.5 py-1 rounded-[6px] font-bold text-dark-black-900">
              <IconCrop size={13} />
              <span>Foto: {imageLayout.dimensionLabel} · Posisi: {ALIGNMENT_GRID.find((a) => a.id === imgConfig?.alignment)?.hint || 'Center'}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 bg-vanilla-100 border border-dark-black-900/20 px-2.5 py-1 rounded-[6px]">
              <IconSearch size={13} className="text-dark-black-900/60" />
              <span className="font-bold text-dark-black-900">{scalingStyles.label}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1 bg-vanilla-100 border border-dark-black-900/20 px-2.5 py-1 rounded-[6px]">
            <IconDroplet size={13} className="text-dark-black-900/60" />
            <span className={`font-bold ${color ? 'text-ok-500' : 'text-dark-black-900'}`}>{color ? 'Full Color' : 'Grayscale'}</span>
          </span>
          {isImage && imgConfig?.repeat > 1 && (
            <span className="inline-flex items-center gap-1 bg-vanilla-100 border border-dark-black-900/30 px-2.5 py-1 rounded-[6px] font-bold text-dark-black-900">
              <IconFile size={13} />
              <span>{imgConfig.repeat}x Foto/Lembar</span>
            </span>
          )}
          {nUp > 1 && !isImage && (
            <span className="inline-flex items-center gap-1 bg-lime-300 border border-dark-black-900/40 px-2.5 py-1 rounded-[6px] font-bold text-dark-black-900">
              <IconFile size={13} />
              <span>{nUp}-Up Grid</span>
            </span>
          )}
          {watermark && (
            <span className="inline-flex items-center gap-1 bg-watermelon-500/20 border border-dark-black-900/30 px-2.5 py-1 rounded-[6px] font-bold text-dark-black-900">
              <span>Stamp: "{watermark}"</span>
            </span>
          )}
          {mediaType && mediaType !== 'Plain Paper' && (
            <span className="inline-flex items-center gap-1 bg-sky-blue-100 border border-dark-black-900/30 px-2.5 py-1 rounded-[6px] font-bold text-dark-black-900">
              <IconFile size={13} />
              <span>{mediaType}</span>
            </span>
          )}
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
