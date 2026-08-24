import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../api/client'
import Button from '../ui/Button'
import { FileTypeBadge } from '../ui/Badges'
import {
  IconUpload, IconFile, IconImage, IconTxt, IconCheck, IconPrinter,
  IconChevronDown, IconEye
} from '../ui/icons'
import { getPaperDimensions, PAPER_SIZES } from '../../utils/paperDimensions'
import { loadPdfDocument } from '../../utils/pdfHelper'
import PrintSheetPreview from '../preview/PrintSheetPreview'
import PageThumbnails from '../preview/PageThumbnails'
import FinalPrintModal from '../preview/FinalPrintModal'

function Select({ label, value, onChange, options, hint }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-figtree text-[13px] font-medium text-dark-black-900">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 pr-10 font-figtree text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors cursor-pointer"
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <IconChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-black-900/60 pointer-events-none" />
      </div>
      {hint && <span className="font-figtree font-light text-dark-black-900/40 text-[11.5px]">{hint}</span>}
    </label>
  )
}

function Toggle({ label, desc, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 w-full text-left py-2.5 cursor-pointer group"
    >
      <span>
        <span className="block font-figtree text-[14px] font-medium text-dark-black-900">{label}</span>
        {desc && <span className="block font-figtree font-light text-dark-black-900/50 text-[12px]">{desc}</span>}
      </span>
      <span
        className={`relative w-[46px] h-[26px] rounded-full border-2 border-dark-black-900 transition-colors duration-200 shrink-0 ${
          checked ? 'bg-lime-400' : 'bg-vanilla-300'
        }`}
      >
        <span
          className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-vanilla-100 border border-dark-black-900 transition-all duration-200 ${
            checked ? 'left-[22px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  )
}

export default function PrintPage() {
  const { printers, submitJob, defaultPrinter, toast } = useApp()
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [printerId, setPrinterId] = useState(defaultPrinter?.id || '')
  const [copies, setCopies] = useState(1)
  const [paperSize, setPaperSize] = useState('A4')
  const [orientation, setOrientation] = useState('Portrait')
  const [color, setColor] = useState(false)
  const [duplex, setDuplex] = useState(false)
  const [range, setRange] = useState('')
  const [quality, setQuality] = useState('Standard')
  const [scaling, setScaling] = useState('Fit to page')
  const [pageCount, setPageCount] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [isFlipped, setIsFlipped] = useState(false)

  // PDF Document object from pdfjs
  const [pdfDoc, setPdfDoc] = useState(null)
  const [loadingPdf, setLoadingPdf] = useState(false)

  // Final Print Inspection modal state
  const [finalModalOpen, setFinalModalOpen] = useState(false)

  // Fallback / Auto-sync printerId
  useEffect(() => {
    if (!printerId && defaultPrinter?.id) {
      setPrinterId(defaultPrinter.id)
    }
  }, [defaultPrinter, printerId])

  const extOf = (name) => (name?.split('.').pop() || '').toLowerCase()
  const isImage = (name) => ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'heic', 'svg'].includes(extOf(name))
  const isPdf = (name) => extOf(name) === 'pdf'
  const isOfficeDoc = (name) => ['docx', 'doc', 'odt', 'rtf', 'pptx', 'ppt', 'xlsx', 'xls'].includes(extOf(name))
  const isText = (name) => ['txt', 'csv', 'json', 'log', 'md'].includes(extOf(name))

  // ── Parse file on selection (PDF real pages / Office conversion / Image / Text) ──
  useEffect(() => {
    if (!file) {
      setPdfDoc(null)
      setPageCount(1)
      setCurrentPage(1)
      setIsFlipped(false)
      return
    }

    let active = true
    const ext = extOf(file.name)

    if (ext === 'pdf') {
      setLoadingPdf(true)
      loadPdfDocument(file)
        .then((doc) => {
          if (!active) return
          setPdfDoc(doc)
          setPageCount(doc.numPages)
          setCurrentPage(1)
        })
        .catch((err) => {
          console.warn('Cannot parse PDF with pdfjs:', err)
          if (!active) return
          setPageCount(1)
        })
        .finally(() => {
          if (active) setLoadingPdf(false)
        })
    } else if (isOfficeDoc(file.name)) {
      // Convert Office document to real PDF for instant 1:1 layout preview
      setLoadingPdf(true)
      api.convertForPreview(file)
        .then((blob) => loadPdfDocument(blob))
        .then((doc) => {
          if (!active) return
          setPdfDoc(doc)
          setPageCount(doc.numPages)
          setCurrentPage(1)
        })
        .catch((err) => {
          console.warn('Cannot convert Office doc for preview:', err)
          if (!active) return
          setPageCount(Math.max(1, Math.round(file.size / 150000)) || 1)
        })
        .finally(() => {
          if (active) setLoadingPdf(false)
        })
    } else if (isText(file.name)) {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (!active) return
        const text = e.target.result || ''
        const lines = text.split('\n').length
        const pages = Math.max(1, Math.ceil(lines / 42))
        setPageCount(pages)
        setCurrentPage(1)
      }
      reader.readAsText(file)
    } else if (isImage(file.name)) {
      setPageCount(1)
      setCurrentPage(1)
    } else {
      setPageCount(1)
      setCurrentPage(1)
    }

    return () => {
      active = false
    }
  }, [file])

  // ── Capabilities of the selected printer (from backend) ──
  const selectedPrinter = printers.find((p) => p.id === printerId) || defaultPrinter
  const caps = selectedPrinter?.caps

  const qualities = useMemo(() => caps?.qualities?.length ? caps.qualities : ['Draft', 'Standard', 'High'], [caps])
  const scalings = useMemo(() => caps?.scalings?.length ? caps.scalings : ['Fit to page', 'Shrink to fit', 'Actual size', 'Custom'], [caps])
  const orientations = useMemo(() => caps?.orientations?.length ? caps.orientations : ['Portrait', 'Landscape'], [caps])
  const paperSizes = useMemo(() => caps?.paperSizes?.length ? caps.paperSizes : PAPER_SIZES, [caps])

  // Keep state in sync when capabilities change
  const effectivePaper = paperSizes.includes(paperSize) ? paperSize : paperSizes[0] || 'A4'
  const effectiveQuality = qualities.includes(quality) ? quality : qualities[0] || 'Standard'
  const effectiveScaling = scalings.includes(scaling) ? scaling : scalings[0] || 'Fit to page'
  const effectiveOrient = orientations.includes(orientation) ? orientation : orientations[0] || 'Portrait'
  const canColor = !!caps?.color
  const canDuplex = !!caps?.duplex
  const effColor = color && canColor

  // Paper Dimension object (mm, aspect ratio)
  const paperDim = useMemo(() => {
    return getPaperDimensions(effectivePaper, effectiveOrient)
  }, [effectivePaper, effectiveOrient])

  const fileMeta = (name) => {
    const ext = name.split('.').pop().toUpperCase()
    if (['PDF'].includes(ext)) return { icon: <IconFile size={20} />, bg: 'bg-err-100' }
    if (['PNG', 'JPG', 'BMP', 'WEBP', 'HEIC'].includes(ext)) return { icon: <IconImage size={20} />, bg: 'bg-sky-blue-100' }
    if (['TXT', 'CSV'].includes(ext)) return { icon: <IconTxt size={20} />, bg: 'bg-lime-300' }
    return { icon: <IconFile size={20} />, bg: 'bg-vanilla-300' }
  }

  const onFileDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0]
    if (!f) return
    const ext = f.name.split('.').pop()?.toUpperCase()
    if (!ext || !['PDF', 'PNG', 'JPG', 'JPEG', 'TXT', 'DOCX', 'DOC', 'XLSX', 'PPTX', 'CSV', 'BMP', 'WEBP', 'HEIC', 'SVG'].includes(ext)) {
      toast('Unsupported file type', 'error')
      return
    }
    setFile(f)
  }

  const handleSubmit = async () => {
    if (!file) {
      toast('Please add a document first', 'error')
      return
    }
    try {
      await submitJob({
        fileType: file.name.split('.').pop()?.toUpperCase() || 'PDF',
        pages: pageCount,
        copies,
        color: effColor,
        duplex: duplex && canDuplex,
        paperSize: effectivePaper,
        orientation: effectiveOrient,
        quality: effectiveQuality,
        scaling: effectiveScaling,
        pageRange: range,
        priority: 3,
        printerId: selectedPrinter?.id || printerId,
        size: file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`,
      }, file)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="flex flex-col gap-7">
      {/* Page Title & Breadcrumb */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[2px] inline-block" />
          <span className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60 font-medium">New job</span>
        </div>
        <h1 className="font-figtree font-semibold text-[36px] leading-tight text-dark-black-900">Print a document</h1>
        <p className="font-figtree font-light text-dark-black-900/60 text-[15px] mt-0.5">
          Upload your file, inspect the true paper size & simulated output, and send to any printer.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Dropzone & Interactive Print Sheet Simulation (7 cols) */}
        <div className="xl:col-span-7 flex flex-col gap-5">
          {!file ? (
            /* Upload Dropzone */
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className="relative border-2 border-dashed border-dark-black-900/60 rounded-[20px] p-10 flex flex-col items-center justify-center text-center cursor-pointer bg-vanilla-100 hover:bg-lime-300/30 transition-all duration-200 min-h-[360px]"
            >
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFileDrop} />
              <div className="w-16 h-16 rounded-[18px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center text-dark-black-900 mb-4 shadow-[4px_4px_0_0_rgba(56,56,56,1)]">
                <IconUpload size={28} />
              </div>
              <div className="font-figtree font-bold text-dark-black-900 text-[18px]">Drag & drop your document here</div>
              <div className="font-figtree font-light text-dark-black-900/60 text-[14px] mt-1 max-w-sm">
                Click to browse files — PDF documents, high-res images, spreadsheets, and text files.
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-5">
                {['PDF', 'PNG', 'JPG', 'TXT', 'DOCX', 'XLSX', 'CSV'].map((t) => (
                  <FileTypeBadge key={t} type={t} />
                ))}
              </div>
            </div>
          ) : (
            /* Active File Preview Container */
            <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[22px] p-5 md:p-6 shadow-[4px_4px_0_0_rgba(56,56,56,1)] flex flex-col gap-5">
              {/* File details bar */}
              <div className="flex items-center justify-between gap-3 flex-wrap pb-4 border-b-2 border-dark-black-900/15">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-11 h-11 rounded-[12px] border-2 border-dark-black-900 ${fileMeta(file.name).bg} flex items-center justify-center text-dark-black-900 shrink-0`}>
                    {fileMeta(file.name).icon}
                  </div>
                  <div className="min-w-0">
                    <div className="font-figtree font-bold text-dark-black-900 text-[15.5px] truncate max-w-xs md:max-w-md">
                      {file.name}
                    </div>
                    <div className="font-geist text-[11.5px] text-dark-black-900/50 flex items-center gap-1.5 mt-0.5">
                      <span>{file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span>
                      <span>·</span>
                      <span className="font-semibold text-dark-black-900">{pageCount} page{pageCount > 1 ? 's' : ''}</span>
                      {loadingPdf && <span className="text-lime-500 animate-pulse">· rendering…</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFinalModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 font-figtree font-bold text-[12.5px] transition-colors cursor-pointer shadow-[2px_2px_0_0_rgba(56,56,56,1)]"
                  >
                    <IconEye size={15} /> Final Inspection
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="px-3 py-1.5 rounded-[9px] border border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 font-figtree text-[12px] font-medium text-dark-black-900 cursor-pointer"
                  >
                    Replace
                  </button>
                </div>
              </div>

              {/* Conversion Loading Banner for real-time document rendering */}
              {loadingPdf && (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-[12px] bg-lime-300/60 border-2 border-dark-black-900 shadow-[2px_2px_0_0_rgba(56,56,56,1)] text-[13px] font-figtree font-bold text-dark-black-900 animate-pulse">
                  <span className="w-4 h-4 border-2 border-dark-black-900 border-t-transparent rounded-full animate-spin shrink-0" />
                  <span>Mengonversi halaman dokumen ke preview real-time (1:1 Layout & True Fonts)...</span>
                </div>
              )}

              {/* ── Virtual Paper Sheet Preview ── */}
              <PrintSheetPreview
                file={file}
                fileType={extOf(file.name).toUpperCase()}
                pdfDoc={pdfDoc}
                currentPage={currentPage}
                totalPages={pageCount}
                paperDim={paperDim}
                orientation={effectiveOrient}
                color={effColor}
                scaling={effectiveScaling}
                quality={effectiveQuality}
                duplex={duplex && canDuplex}
                copies={copies}
                onPrevPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
                onNextPage={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                onSelectPage={(p) => setCurrentPage(p)}
                onOpenFinalModal={() => setFinalModalOpen(true)}
                isFlipped={isFlipped}
                onToggleFlip={() => setIsFlipped(!isFlipped)}
              />

              {/* ── Page Thumbnails Strip ── */}
              {pageCount > 1 && (
                <div className="pt-3 border-t-2 border-dark-black-900/10">
                  <PageThumbnails
                    totalPages={pageCount}
                    currentPage={currentPage}
                    onSelectPage={(p) => setCurrentPage(p)}
                    pdfDoc={pdfDoc}
                    file={file}
                    isImage={isImage(file.name)}
                    isText={isText(file.name)}
                    paperDim={paperDim}
                    color={effColor}
                    duplex={duplex && canDuplex}
                    pageRange={range}
                  />
                </div>
              )}
            </div>
          )}

          {/* Destination Printer Selection Card */}
          <div className="bg-vanilla-200 border-2 border-dark-black-900 rounded-[20px] p-5 shadow-[4px_4px_0_0_rgba(56,56,56,1)]">
            <div className="flex items-center justify-between mb-3">
              <span className="font-figtree font-bold text-[15.5px] text-dark-black-900">Destination Printer</span>
              <span className="font-geist text-[11px] text-dark-black-900/50 uppercase tracking-wider">
                {printers.filter((p) => p.enabled).length} available
              </span>
            </div>

            <div className="flex flex-col gap-2.5">
              {printers
                .filter((p) => p.enabled)
                .map((p) => {
                  const isSelected = (selectedPrinter?.id || printerId) === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPrinterId(p.id)
                        if (p.caps?.paperSizes?.length && !p.caps.paperSizes.includes(paperSize)) {
                          setPaperSize(p.caps.paperSizes[0])
                        }
                      }}
                      disabled={p.status === 'offline'}
                      className={`flex items-center gap-3 px-3.5 py-3 rounded-[13px] border-2 transition-all duration-150 text-left cursor-pointer ${
                        isSelected
                          ? 'border-dark-black-900 bg-lime-300 shadow-[3px_3px_0_0_rgba(56,56,56,1)] -translate-y-0.5'
                          : 'border-dark-black-900/25 bg-vanilla-100 hover:border-dark-black-900 hover:bg-vanilla-100'
                      } ${p.status === 'offline' ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <div className="w-10 h-10 rounded-[10px] border border-dark-black-900 bg-vanilla-100 flex items-center justify-center text-dark-black-900 shrink-0">
                        <IconPrinter size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-figtree font-bold text-[14px] text-dark-black-900 truncate">
                          {p.name} {p.isDefault && <span className="font-geist text-[10px] font-normal uppercase text-dark-black-900/60 ml-1">· default</span>}
                        </div>
                        <div className="font-figtree font-light text-dark-black-900/60 text-[12px] flex items-center gap-1.5 flex-wrap">
                          <span>{p.brand} {p.model}</span>
                          <span>·</span>
                          <span className="font-geist">{p.connection}</span>
                          <span>·</span>
                          <span>{p.caps?.color ? 'Color' : 'Monochrome'}</span>
                          {p.caps?.duplex && <span>· Duplex</span>}
                        </div>
                      </div>
                      {isSelected && (
                        <span className="w-6 h-6 rounded-full bg-dark-black-900 text-lime-300 flex items-center justify-center shrink-0">
                          <IconCheck size={14} />
                        </span>
                      )}
                    </button>
                  )
                })}
            </div>
          </div>
        </div>

        {/* Right Column: Print Options & Configuration (5 cols) */}
        <div className="xl:col-span-5">
          <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[22px] p-6 shadow-[6px_6px_0_0_rgba(56,56,56,1)]">
            <div className="absolute -top-[9px] -right-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />
            <h2 className="font-figtree font-bold text-[19px] text-dark-black-900 mb-5">Print Settings</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Paper Size"
                value={effectivePaper}
                onChange={(v) => setPaperSize(v)}
                options={paperSizes}
                hint={`${paperDim.widthMm} × ${paperDim.heightMm} mm`}
              />
              <Select
                label="Quality"
                value={effectiveQuality}
                onChange={(v) => setQuality(v)}
                options={qualities}
              />
              <Select
                label="Scaling"
                value={effectiveScaling}
                onChange={(v) => setScaling(v)}
                options={scalings}
              />

              {/* Orientation Switcher */}
              <div className="flex flex-col gap-1.5">
                <span className="font-figtree text-[13px] font-medium text-dark-black-900">Orientation</span>
                <div className="flex gap-2">
                  {orientations.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOrientation(o)}
                      className={`flex-1 px-3 py-2.5 rounded-[11px] border-2 font-figtree text-[13.5px] font-semibold transition-all cursor-pointer ${
                        effectiveOrient === o
                          ? 'border-dark-black-900 bg-dark-black-900 text-vanilla-100 shadow-[2px_2px_0_0_rgba(56,56,56,1)]'
                          : 'border-dark-black-900/25 bg-vanilla-100 hover:border-dark-black-900 text-dark-black-900'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Copies & Page Range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-figtree text-[13px] font-medium text-dark-black-900">Copies</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(999, parseInt(e.target.value) || 1)))}
                  className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-geist font-bold text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-figtree text-[13px] font-medium text-dark-black-900">Page Range</span>
                <input
                  type="text"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder="e.g. 1-5, 8, 11-13"
                  className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-geist text-[13px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
                />
              </label>
            </div>

            {/* Color & Duplex Toggles */}
            <div className="border-t-2 border-dark-black-900/15 mt-5 pt-3 flex flex-col divide-y divide-dark-black-900/10">
              <div className={!canColor ? 'opacity-45 pointer-events-none select-none' : ''}>
                <Toggle
                  label="Print in Color"
                  desc={canColor ? 'Render full color palette (simulated in preview)' : 'Printer is monochrome (grayscale only)'}
                  checked={effColor}
                  onChange={setColor}
                />
              </div>
              <div className={!canDuplex ? 'opacity-45 pointer-events-none select-none' : ''}>
                <Toggle
                  label="Two-Sided (Duplex)"
                  desc={canDuplex ? 'Print on both sides of each sheet' : 'Printer does not support hardware duplex'}
                  checked={duplex && canDuplex}
                  onChange={setDuplex}
                />
              </div>
            </div>

            {/* Summary Box */}
            <div className="mt-5 p-4 rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 flex flex-col gap-2">
              <div className="flex justify-between items-center text-[12.5px] font-figtree">
                <span className="text-dark-black-900/60">Estimated Output:</span>
                <span className="font-geist font-bold text-dark-black-900">
                  {Math.ceil(pageCount / (duplex && canDuplex ? 2 : 1)) * copies} physical sheet{Math.ceil(pageCount / (duplex && canDuplex ? 2 : 1)) * copies > 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex justify-between items-center text-[12.5px] font-figtree">
                <span className="text-dark-black-900/60">Format & Quality:</span>
                <span className="font-geist text-dark-black-900">
                  {effectivePaper} · {effectiveOrient} · {effColor ? 'Color' : 'Monochrome'}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 pt-4 border-t-2 border-dark-black-900/15 flex flex-col gap-3">
              <Button
                variant="lime"
                size="lg"
                onClick={handleSubmit}
                icon={<IconUpload size={18} />}
              >
                {file ? `Send to Printer (${copies} cop${copies > 1 ? 'ies' : 'y'})` : 'Upload a Document First'}
              </Button>

              {file && (
                <button
                  type="button"
                  onClick={() => setFinalModalOpen(true)}
                  className="inline-flex items-center justify-center gap-2 py-2.5 rounded-[12px] border border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 font-figtree font-semibold text-[13.5px] text-dark-black-900 transition-colors cursor-pointer"
                >
                  <IconEye size={16} /> Open Full Print Inspection
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Final Fullscreen Print Inspection Modal ── */}
      <FinalPrintModal
        isOpen={finalModalOpen}
        onClose={() => setFinalModalOpen(false)}
        file={file}
        fileType={file ? extOf(file.name).toUpperCase() : 'PDF'}
        pdfDoc={pdfDoc}
        totalPages={pageCount}
        currentPage={currentPage}
        onSelectPage={(p) => setCurrentPage(p)}
        paperDim={paperDim}
        orientation={effectiveOrient}
        color={effColor}
        duplex={duplex && canDuplex}
        copies={copies}
        quality={effectiveQuality}
        scaling={effectiveScaling}
        selectedPrinter={selectedPrinter}
        onSubmitJob={handleSubmit}
      />
    </div>
  )
}
