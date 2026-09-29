import { useEffect, useRef, useState, useMemo } from 'react'
import Button from '../ui/Button'
import { renderPdfPageToCanvas } from '../../utils/pdfHelper'
import {
  IconPrinter, IconUpload, IconEye, IconRefresh, IconX,
} from '../ui/icons'
import {
  calculateImageLayout,
  DEFAULT_IMAGE_CONFIG,
  ALIGNMENT_GRID,
} from '../../utils/imageLayoutHelper'
import { DEFAULT_DOC_CONFIG } from './DocumentLayoutControls'

/**
 * Fullscreen / High-Res Final Print Inspection Modal
 */
export default function FinalPrintModal({
  isOpen,
  onClose,
  file,
  fileType,
  pdfDoc,
  totalPages,
  currentPage,
  onSelectPage,
  paperDim,
  orientation,
  color,
  duplex,
  copies,
  quality,
  scaling,
  nUp = 1,
  watermark = '',
  selectedPrinter,
  onSubmitJob,
  imgConfig = DEFAULT_IMAGE_CONFIG,
  docConfig = DEFAULT_DOC_CONFIG,
}) {
  const [zoom, setZoom] = useState(100)
  const [activePage, setActivePage] = useState(currentPage)
  const [simulateMono, setSimulateMono] = useState(!color)
  const [showMargins, setShowMargins] = useState(true)
  const [isFlipped, setIsFlipped] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const canvasRef = useRef(null)
  const [imgUrl, setImgUrl] = useState(null)
  const [imgNatural, setImgNatural] = useState({ width: 1200, height: 800 })
  const [textContent, setTextContent] = useState('')

  const isPdf = !!pdfDoc || fileType === 'PDF' || file?.name?.toLowerCase().endsWith('.pdf')
  const isImage = ['PNG', 'JPG', 'JPEG', 'WEBP', 'BMP', 'HEIC', 'SVG'].includes(fileType) ||
    /\.(png|jpe?g|webp|bmp|heic|svg)$/i.test(file?.name || '')
  const isText = ['TXT', 'CSV', 'JSON', 'LOG', 'MD'].includes(fileType) ||
    /\.(txt|csv|json|log|md)$/i.test(file?.name || '')

  useEffect(() => {
    setActivePage(currentPage)
  }, [currentPage])

  useEffect(() => {
    setSimulateMono(!color)
  }, [color])

  // Image / Text load
  useEffect(() => {
    if (!file) return
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
      reader.onload = (e) => setTextContent(e.target.result || '')
      reader.readAsText(file)
    }
  }, [file, isImage, isText])

  // PDF Page Render inside modal
  useEffect(() => {
    if (!isOpen || !isPdf || !pdfDoc || !canvasRef.current) return
    let active = true

    const targetW = Math.round(1400 * (zoom / 100))
    renderPdfPageToCanvas(pdfDoc, activePage, canvasRef.current, targetW).catch(() => {})

    return () => {
      active = false
    }
  }, [isOpen, isPdf, pdfDoc, activePage, zoom, quality])

  // Scaling styles
  const scalingStyles = useMemo(() => {
    switch (scaling) {
      case 'Shrink to fit':
        return {
          wrapperClass: 'p-6 flex items-center justify-center',
          transform: 'scale(0.86)',
          imgClass: 'object-contain max-h-full max-w-full rounded-[2px]',
          label: 'Shrink to Fit (86% + Safety Margins)',
        }
      case 'Actual size':
        return {
          wrapperClass: 'p-2 flex items-center justify-center overflow-hidden',
          transform: 'scale(1.16)',
          imgClass: 'object-none max-h-none max-w-none',
          label: 'Actual Size 1:1 (Unscaled 100%)',
        }
      case 'Custom':
        return {
          wrapperClass: 'p-0 flex items-center justify-center',
          transform: 'scale(1.0)',
          imgClass: 'object-cover w-full h-full',
          label: 'Full Bleed / Borderless',
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

  // Visual Quality & Mono Filter
  const visualFilter = useMemo(() => {
    let filter = ''
    if (simulateMono) filter += 'grayscale(100%) '

    let opacity = 1.0
    switch (quality) {
      case 'Draft':
        filter += 'contrast(0.88) brightness(1.03)'
        opacity = 0.82
        break
      case 'High':
        filter += 'contrast(1.10) saturate(1.08)'
        opacity = 1.0
        break
      case 'Photo':
        filter += 'contrast(1.16) saturate(1.24)'
        opacity = 1.0
        break
      case 'Standard':
      default:
        filter += 'contrast(1.0)'
        opacity = 1.0
        break
    }
    return { filter: filter.trim(), opacity }
  }, [quality, simulateMono])

  // Calculate paper width in modal based on paper base scale & zoom
  const modalPaperWidth = Math.round(
    (orientation === 'Landscape' ? 480 : 340) * paperDim.baseScale * (zoom / 100)
  )

  const modalPaperDim = useMemo(() => {
    return {
      ...paperDim,
      baseWidthPx: modalPaperWidth,
    }
  }, [paperDim, modalPaperWidth])

  const imageLayout = useMemo(() => {
    if (!isImage) return null
    return calculateImageLayout({
      paperDim: modalPaperDim,
      imgConfig: imgConfig || DEFAULT_IMAGE_CONFIG,
      imgNaturalWidth: imgNatural.width,
      imgNaturalHeight: imgNatural.height,
      showMargins,
    })
  }, [isImage, modalPaperDim, imgConfig, imgNatural, showMargins])

  if (!isOpen) return null

  const totalSheets = Math.ceil(totalPages / (duplex ? 2 : 1)) * copies

  const handlePrint = async () => {
    setSubmitting(true)
    try {
      await onSubmitJob()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-dark-black-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-6xl max-h-[92vh] bg-vanilla-200 border-2 border-dark-black-900 rounded-[24px] shadow-[10px_10px_0px_0px_rgba(56,56,56,1)] flex flex-col overflow-hidden modal-in">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b-2 border-dark-black-900 bg-vanilla-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center text-dark-black-900">
              <IconEye size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-figtree font-bold text-[18px] text-dark-black-900">
                  Final Print Inspection
                </span>
                <span className="font-geist text-[11px] px-2 py-0.5 rounded-[5px] bg-lime-300 border border-dark-black-900 font-bold">
                  {paperDim.name} · {orientation}
                </span>
              </div>
              <p className="font-figtree text-[12.5px] text-dark-black-900/60 font-light truncate max-w-md">
                {file?.name} — Full size inspection with real physical scale & quality simulation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-200 hover:bg-err-100 flex items-center justify-center text-dark-black-900 font-bold text-[16px] transition-colors cursor-pointer"
              aria-label="Close"
            >
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-y-auto">
          {/* Main Sheet View (8 cols) */}
          <div className="lg:col-span-8 flex flex-col border-b-2 lg:border-b-0 lg:border-r-2 border-dark-black-900 bg-dark-black-900/5 p-5 sm:p-6 overflow-y-auto">
            {/* View Toolbar */}
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap bg-vanilla-100 border border-dark-black-900 p-2.5 rounded-[12px]">
              <div className="flex items-center gap-2">
                <span className="font-figtree text-[12px] font-semibold text-dark-black-900">
                  Zoom:
                </span>
                {['75%', '100%', '125%'].map((zStr) => {
                  const zVal = parseInt(zStr, 10)
                  return (
                    <button
                      key={zStr}
                      type="button"
                      onClick={() => setZoom(zVal)}
                      className={`px-2.5 py-1 rounded-[6px] border font-geist text-[11px] font-semibold transition-all cursor-pointer ${
                        zoom === zVal
                          ? 'border-dark-black-900 bg-dark-black-900 text-vanilla-100'
                          : 'border-dark-black-900/30 bg-vanilla-200 hover:bg-lime-300 text-dark-black-900'
                      }`}
                    >
                      {zStr}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[12px] font-figtree cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simulateMono}
                    onChange={(e) => setSimulateMono(e.target.checked)}
                    className="accent-dark-black-900 rounded"
                  />
                  <span>Simulate Grayscale</span>
                </label>

                <label className="flex items-center gap-1.5 text-[12px] font-figtree cursor-pointer ml-2">
                  <input
                    type="checkbox"
                    checked={showMargins}
                    onChange={(e) => setShowMargins(e.target.checked)}
                    className="accent-dark-black-900 rounded"
                  />
                  <span>5mm Margins</span>
                </label>

                {duplex && (
                  <button
                    type="button"
                    onClick={() => setIsFlipped(!isFlipped)}
                    className="px-2.5 py-1 rounded-[6px] border border-dark-black-900 bg-lime-300 hover:bg-lime-500 font-figtree text-[11.5px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <IconRefresh size={12} /> {isFlipped ? 'Back' : 'Front'}
                  </button>
                )}
              </div>
            </div>

            {/* Centered High-Res Virtual Paper */}
            <div className="flex-1 flex items-center justify-center p-4">
              <div
                style={{
                  aspectRatio: `${paperDim.widthMm} / ${paperDim.heightMm}`,
                  width: `${modalPaperWidth}px`,
                  maxWidth: '100%',
                }}
                className={`relative bg-white rounded-[4px] border-2 border-dark-black-900 shadow-[10px_10px_0px_0px_rgba(56,56,56,0.95)] flex flex-col overflow-hidden transition-all duration-200 ${
                  isFlipped ? 'scale-x-[-1]' : ''
                }`}
              >
                {/* 5 mm printable area guide, scaled to the real sheet */}
                {showMargins && (
                  <div
                    style={{ inset: `${paperDim.safeZoneInsetPx}px` }}
                    className="absolute border border-dashed border-sky-blue-500/60 pointer-events-none z-20 flex flex-col justify-between p-1"
                  >
                    <span className="text-[7.5px] font-geist font-bold text-sky-blue-500/80 tracking-widest leading-none">
                      PRINTABLE AREA ({paperDim.name})
                    </span>
                    <span className="text-[7.5px] font-geist text-sky-blue-500/80 text-right tracking-widest leading-none">
                      {paperDim.widthMm} × {paperDim.heightMm} mm · {orientation}
                    </span>
                  </div>
                )}

                {/* Content */}
                <div
                  style={visualFilter}
                  className={`w-full h-full flex-1 relative overflow-hidden bg-white ${
                    isImage ? 'p-0' : `${scalingStyles.wrapperClass} flex items-center justify-center`
                  }`}
                >
                  {/* Watermark Overlay */}
                  {watermark && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 overflow-hidden select-none">
                      <span
                        className="font-figtree font-black uppercase text-dark-black-900/20 tracking-widest text-[46px] md:text-[68px] -rotate-45 whitespace-nowrap"
                        style={{ letterSpacing: '0.2em' }}
                      >
                        {watermark}
                      </span>
                    </div>
                  )}

                  <div
                    style={{
                      transform: isImage
                        ? 'none'
                        : docConfig?.scaleMode === 'custom'
                          ? `scale(${Math.max(0.25, Math.min(2.0, (docConfig?.customScale || 100) / 100))}) rotate(${docConfig?.rotation || 0}deg)`
                          : docConfig?.rotation
                            ? `${scalingStyles.transform} rotate(${docConfig.rotation}deg)`
                            : scalingStyles.transform,
                      padding: !isImage && docConfig?.marginPreset === 'none'
                        ? '0px'
                        : !isImage && docConfig?.marginPreset === 'minimum'
                          ? '6px'
                          : !isImage && docConfig?.marginPreset === 'custom' && docConfig?.margins
                            ? `${docConfig.margins.top}px ${docConfig.margins.right}px ${docConfig.margins.bottom}px ${docConfig.margins.left}px`
                            : undefined,
                      transition: 'transform 0.15s ease-out, padding 0.15s ease-out',
                    }}
                    className="w-full h-full flex items-center justify-center"
                  >
                    {nUp > 1 ? (
                      /* N-Up Multi-Page Grid Simulation */
                      <div
                        className={`w-full h-full p-4 grid gap-3 items-center justify-center ${
                          nUp === 2 ? 'grid-cols-2' : nUp === 4 ? 'grid-cols-2 grid-rows-2' : nUp === 6 ? 'grid-cols-3 grid-rows-2' : nUp === 9 ? 'grid-cols-3 grid-rows-3' : 'grid-cols-4 grid-rows-4'
                        }`}
                      >
                        {Array.from({ length: nUp }).map((_, idx) => {
                          const subPage = (activePage - 1) * nUp + idx + 1
                          return (
                            <div
                              key={idx}
                              className="w-full h-full border-2 border-dark-black-900/30 rounded-[4px] bg-vanilla-100 p-2 flex flex-col justify-between overflow-hidden shadow-xs"
                            >
                              <div className="flex justify-between font-geist text-[9px] text-dark-black-900/60 font-semibold">
                                <span>Page {subPage}</span>
                                <span>{subPage <= totalPages ? 'Available' : 'Blank'}</span>
                              </div>
                              <div className="w-full h-full flex flex-col gap-1.5 my-auto justify-center px-2">
                                <div className="w-3/4 h-2 bg-dark-black-900/40 rounded-[2px]" />
                                <div className="w-full h-1 bg-dark-black-900/20 rounded-[1px]" />
                                <div className="w-5/6 h-1 bg-dark-black-900/20 rounded-[1px]" />
                                <div className="w-2/3 h-1 bg-dark-black-900/20 rounded-[1px]" />
                              </div>
                              <div className="text-[8px] font-geist text-dark-black-900/40 text-center font-medium">
                                {nUp}-Up Grid Sheet
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : isPdf ? (
                      <canvas ref={canvasRef} className="w-full h-full object-contain pointer-events-none" />
                    ) : isImage && imgUrl && imageLayout ? (
                      <div className="relative w-full h-full overflow-hidden select-none">
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
                            className={`overflow-hidden border border-dashed border-dark-black-900/50 bg-white shadow-xs ${
                              imageLayout.isOverflow ? 'ring-2 ring-warn-500' : ''
                            }`}
                          >
                            {(() => {
                              const zoom = (imgConfig?.zoomLevel ?? 100) / 100
                              const cropX = imgConfig?.cropPositionX ?? 50
                              const cropY = imgConfig?.cropPositionY ?? 50
                              const isCover = imgConfig?.fitMode === 'cover'
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
                                  alt="Full Preview item"
                                  style={imgStyle}
                                  className={`pointer-events-none select-none transition-transform duration-75 ${
                                    isCover ? 'object-cover' : 'object-contain'
                                  }`}
                                />
                              )
                            })()}
                            <div className="absolute bottom-1 right-1 pointer-events-none bg-dark-black-900/80 text-white font-geist text-[8px] font-bold px-1 rounded-[2px] leading-tight">
                              {Math.round(item.wMm)}×{Math.round(item.hMm)}mm
                            </div>
                          </div>
                        ))}
                        <div className="absolute top-2 left-2 z-20 pointer-events-none">
                          <span className="font-geist text-[9px] font-bold bg-dark-black-900 text-lime-300 px-2 py-0.5 rounded-[4px] shadow-sm">
                            {imageLayout.dimensionLabel} · {ALIGNMENT_GRID.find((a) => a.id === imgConfig?.alignment)?.hint || 'Center'}
                          </span>
                        </div>
                      </div>
                    ) : isText ? (
                      <div className="w-full h-full p-6 overflow-hidden flex flex-col justify-between">
                        <div className="border-b border-dark-black-900/10 pb-1.5 mb-3 flex justify-between font-geist text-[9px] text-dark-black-900/50">
                          <span>{file?.name}</span>
                          <span>Page {activePage} of {totalPages}</span>
                        </div>
                        <pre className="font-geist text-[9.5px] leading-relaxed text-dark-black-900/80 whitespace-pre-wrap break-words overflow-hidden font-normal flex-1">
                          {textContent.slice(0, 1800)}
                        </pre>
                      </div>
                    ) : (
                      <div className="p-8 text-center font-geist text-[12px] text-dark-black-900/50">
                        {fileType} Document · Sheet {activePage}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={activePage <= 1}
                  onClick={() => {
                    const p = Math.max(1, activePage - 1)
                    setActivePage(p)
                    onSelectPage(p)
                  }}
                  className="px-3 py-1.5 rounded-[8px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 disabled:opacity-40 font-figtree text-[13px] font-semibold"
                >
                  ← Prev Page
                </button>
                <span className="font-geist text-[12px] font-bold text-dark-black-900">
                  Page {activePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={activePage >= totalPages}
                  onClick={() => {
                    const p = Math.min(totalPages, activePage + 1)
                    setActivePage(p)
                    onSelectPage(p)
                  }}
                  className="px-3 py-1.5 rounded-[8px] border border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 disabled:opacity-40 font-figtree text-[13px] font-semibold"
                >
                  Next Page →
                </button>
              </div>
            )}
          </div>

          {/* Right Specs & Confirmation Panel (4 cols) */}
          <div className="lg:col-span-4 p-5 sm:p-6 flex flex-col justify-between bg-vanilla-100">
            <div className="flex flex-col gap-4">
              <h3 className="font-figtree font-bold text-[17px] text-dark-black-900 border-b border-dark-black-900/15 pb-2">
                Print Specifications
              </h3>

              {/* Destination printer */}
              <div className="p-3.5 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-200 flex items-center gap-3">
                <div className="w-10 h-10 rounded-[10px] border border-dark-black-900 bg-lime-300 flex items-center justify-center text-dark-black-900 shrink-0">
                  <IconPrinter size={20} />
                </div>
                <div className="min-w-0">
                  <div className="font-figtree font-bold text-[14px] text-dark-black-900 truncate">
                    {selectedPrinter?.name || 'Default Printer'}
                  </div>
                  <div className="font-figtree text-[12px] text-dark-black-900/60 font-light">
                    {selectedPrinter?.brand} {selectedPrinter?.model}
                  </div>
                </div>
              </div>

              {/* Specs Table */}
              <div className="flex flex-col gap-2 font-figtree text-[13px]">
                <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                  <span className="text-dark-black-900/60">Paper format</span>
                  <span className="font-geist font-semibold text-dark-black-900">
                    {paperDim.name} ({paperDim.widthMm} × {paperDim.heightMm} mm)
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                  <span className="text-dark-black-900/60">Orientation</span>
                  <span className="font-medium text-dark-black-900">{orientation}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                  <span className="text-dark-black-900/60">Color mode</span>
                  <span className={`font-semibold ${color ? 'text-ok-500' : 'text-dark-black-900'}`}>
                    {color ? 'Full Color' : 'Monochrome (Grayscale)'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                  <span className="text-dark-black-900/60">Sides (Duplex)</span>
                  <span className="font-medium text-dark-black-900">
                    {duplex ? '2-Sided (Duplex)' : '1-Sided'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                  <span className="text-dark-black-900/60">Quality / Scaling</span>
                  <span className="font-medium text-dark-black-900">
                    {quality} · {docConfig?.scaleMode === 'custom' ? `Scale ${docConfig.customScale}%` : scaling}
                  </span>
                </div>
                {!isImage && (
                  <>
                    <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                      <span className="text-dark-black-900/60">Pages to print</span>
                      <span className="font-geist font-medium text-dark-black-900">
                        {docConfig?.pageRangeMode === 'current'
                          ? `Page ${activePage} only`
                          : docConfig?.pageRangeMode === 'custom' && docConfig?.customRange
                            ? docConfig.customRange
                            : `All (${totalPages} pages)`}
                        {docConfig?.pageSubset !== 'all' && ` · ${docConfig.pageSubset === 'odd' ? 'Odd only' : 'Even only'}`}
                        {docConfig?.reverseOrder && ' (Reverse)'}
                      </span>
                    </div>
                    {docConfig?.rotation !== 0 && (
                      <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                        <span className="text-dark-black-900/60">Rotation</span>
                        <span className="font-geist font-medium text-dark-black-900">{docConfig.rotation}°</span>
                      </div>
                    )}
                    {docConfig?.marginPreset !== 'default' && (
                      <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                        <span className="text-dark-black-900/60">Margin</span>
                        <span className="font-geist font-medium text-dark-black-900 capitalize">{docConfig.marginPreset}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between py-1.5 border-b border-dark-black-900/10">
                  <span className="text-dark-black-900/60">Copies</span>
                  <span className="font-geist font-bold text-dark-black-900">{copies}</span>
                </div>
                <div className="flex justify-between py-2 bg-lime-300/40 px-3 rounded-[8px] border border-dark-black-900/20 mt-1">
                  <span className="font-semibold text-dark-black-900">Total physical sheets</span>
                  <span className="font-geist font-bold text-[15px] text-dark-black-900">
                    {totalSheets} sheet{totalSheets > 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Confirm & Submit */}
            <div className="mt-6 pt-4 border-t-2 border-dark-black-900 flex flex-col gap-3">
              <Button
                variant="lime"
                size="lg"
                onClick={handlePrint}
                disabled={submitting}
                icon={<IconUpload size={18} />}
              >
                {submitting ? 'Sending to printer…' : `Confirm & Print (${copies} cop${copies > 1 ? 'ies' : 'y'})`}
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="text-center font-figtree text-[13px] text-dark-black-900/60 hover:text-dark-black-900 py-1 cursor-pointer"
              >
                Back to edit options
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
