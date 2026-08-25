import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../api/client'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { FileTypeBadge } from '../ui/Badges'
import {
  IconUpload, IconFile, IconImage, IconTxt, IconCheck, IconPrinter,
  IconChevronDown, IconEye, IconRefresh, IconAlert, IconWrench, IconDroplet, IconCamera,
} from '../ui/icons'
import { getPaperDimensions, PAPER_SIZES } from '../../utils/paperDimensions'
import { loadPdfDocument } from '../../utils/pdfHelper'
import PrintSheetPreview from '../preview/PrintSheetPreview'
import PageThumbnails from '../preview/PageThumbnails'
import FinalPrintModal from '../preview/FinalPrintModal'
import CameraScanModal from '../scanner/CameraScanModal'

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

function Input({ label, value, onChange, placeholder, hint, type = 'text', maxLength, autoFocus }) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="font-figtree text-[13px] font-medium text-dark-black-900">{label}</span>}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-figtree text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
      />
      {hint && <span className="font-figtree font-light text-dark-black-900/40 text-[11.5px]">{hint}</span>}
    </label>
  )
}

function Toggle({ label, desc, hint, checked, onChange, disabled }) {
  const description = desc || hint
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex items-center justify-between gap-4 w-full text-left py-2.5 cursor-pointer group ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span>
        <span className="block font-figtree text-[14px] font-medium text-dark-black-900">{label}</span>
        {description && <span className="block font-figtree font-light text-dark-black-900/50 text-[12px]">{description}</span>}
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

export default function PrintPage({ onNavigate }) {
  const { printers, submitJob, defaultPrinter, toast } = useApp()
  const fileInputRef = useRef(null)

  const [submitting, setSubmitting] = useState(false)
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
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [finalModalOpen, setFinalModalOpen] = useState(false)
  const [cameraModalOpen, setCameraModalOpen] = useState(false)

  // Domain 2 & 3: Advanced Layout, Imposition, Media & PPD States
  const [nUp, setNUp] = useState(1)
  const [collate, setCollate] = useState(true)
  const [mediaType, setMediaType] = useState('Plain Paper (Standard)')
  const [inputTray, setInputTray] = useState('Auto Select')
  const [borderless, setBorderless] = useState(false)
  const [booklet, setBooklet] = useState(false)
  const [watermark, setWatermark] = useState('')
  const [manualDuplex, setManualDuplex] = useState(false)
  const [manualDuplexModalOpen, setManualDuplexModalOpen] = useState(false)
  const [manualDuplexStep, setManualDuplexStep] = useState('odd')
  const [activeTab, setActiveTab] = useState('basic') // basic | layout | media | watermark | security
  const [ppdOptions, setPpdOptions] = useState([])

  // Domain 4 & 5: Security PIN, Enterprise Quota & Department
  const [secureRelease, setSecureRelease] = useState(false)
  const [pin, setPin] = useState('')
  const [department, setDepartment] = useState('Engineering')

  // PDF Document object from pdfjs
  const [pdfDoc, setPdfDoc] = useState(null)

  // Fallback / Auto-sync printerId & PPD Introspection
  useEffect(() => {
    if (!printerId && defaultPrinter?.id) {
      setPrinterId(defaultPrinter.id)
    }
  }, [defaultPrinter, printerId])

  useEffect(() => {
    const targetId = printerId || defaultPrinter?.id
    if (!targetId) return
    let active = true
    api.getPPDOptions(targetId)
      .then((res) => {
        if (active && res?.options) setPpdOptions(res.options)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [printerId, defaultPrinter])

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
    if (['PNG', 'JPG', 'JPEG', 'BMP', 'WEBP', 'HEIC', 'GIF', 'TIF', 'TIFF', 'SVG'].includes(ext)) return { icon: <IconImage size={20} />, bg: 'bg-sky-blue-100' }
    if (['TXT', 'CSV'].includes(ext)) return { icon: <IconTxt size={20} />, bg: 'bg-lime-300' }
    return { icon: <IconFile size={20} />, bg: 'bg-vanilla-300' }
  }

  const onFileDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0]
    if (!f) return
    const ext = f.name.split('.').pop()?.toUpperCase()
    if (!ext || !['PDF', 'PNG', 'JPG', 'JPEG', 'TXT', 'DOCX', 'DOC', 'XLSX', 'XLS', 'PPTX', 'PPT', 'CSV', 'BMP', 'WEBP', 'HEIC', 'SVG', 'GIF', 'TIF', 'TIFF', 'ODT', 'ODP', 'ODS', 'RTF'].includes(ext)) {
      toast('Unsupported file type', 'error')
      return
    }
    setFile(f)
  }

  // Real-time Cost Estimation (Domain 5 Enterprise Accounting)
  const estimatedCost = useMemo(() => {
    const base = effColor ? 1500 : 500
    let total = Math.max(1, pageCount) * Math.max(1, copies) * base
    if (duplex || manualDuplex) total = Math.round(total * 0.9) // 10% discount for paper savings
    return total
  }, [effColor, pageCount, copies, duplex, manualDuplex])

  const handleSubmit = () => {
    if (!file) {
      toast('Please add a document first', 'error')
      return
    }
    if (submitting) return

    // Manual Duplex Assistant Workflow (for printers without hardware duplex like Epson L3210)
    if (manualDuplex) {
      setManualDuplexStep('odd')
      setManualDuplexModalOpen(true)
      const oddPayload = {
        fileType: file.name.split('.').pop()?.toUpperCase() || 'PDF',
        pages: pageCount,
        copies,
        color: effColor,
        duplex: false,
        paperSize: effectivePaper,
        orientation: effectiveOrient,
        quality: effectiveQuality,
        scaling: effectiveScaling,
        pageRange: range || 'odd',
        priority: 3,
        printerId: selectedPrinter?.id || printerId,
        size: file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`,
        nUp,
        collate,
        mediaType,
        inputTray,
        borderless,
        booklet,
        watermark,
        manualDuplex: true,
        duplexStep: 'odd',
        secureRelease,
        pin: secureRelease ? pin : '',
        cost: estimatedCost,
        department,
      }
      submitJob(oddPayload, file).catch((e) => {
        toast(`Gagal kirim langkah 1 manual duplex: ${e.message}`, 'error')
      })
      return
    }

    setSubmitting(true)

    // Capture all values before clearing state
    const capturedFile = file
    const jobPayload = {
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
      nUp,
      collate,
      mediaType,
      inputTray,
      borderless,
      booklet,
      watermark,
      manualDuplex: false,
      secureRelease,
      pin: secureRelease ? pin : '',
      cost: estimatedCost,
      department,
    }

    // Optimistic reset + navigate BEFORE the network call — feels instant
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setSubmitting(false)
    if (onNavigate) onNavigate('queue')

    // Upload and CUPS spooling run in background
    submitJob(jobPayload, capturedFile).catch((e) => {
      toast(`Gagal kirim ke printer: ${e.message}`, 'error')
    })
  }

  const handleProceedEvenPages = () => {
    if (!file) {
      setManualDuplexModalOpen(false)
      if (onNavigate) onNavigate('queue')
      return
    }
    setManualDuplexStep('even')
    const evenPayload = {
      fileType: file.name.split('.').pop()?.toUpperCase() || 'PDF',
      pages: pageCount,
      copies,
      color: effColor,
      duplex: false,
      paperSize: effectivePaper,
      orientation: effectiveOrient,
      quality: effectiveQuality,
      scaling: effectiveScaling,
      pageRange: range || 'even',
      priority: 3,
      printerId: selectedPrinter?.id || printerId,
      size: file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`,
      nUp,
      collate,
      mediaType,
      inputTray,
      borderless,
      booklet,
      watermark,
      manualDuplex: true,
      duplexStep: 'even',
    }
    submitJob(evenPayload, file)
      .then(() => {
        toast('Langkah 2: Halaman genap telah dikirim ke printer!', 'success')
      })
      .catch((e) => {
        toast(`Gagal kirim langkah 2 manual duplex: ${e.message}`, 'error')
      })
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

              {/* Domain 6: Mobile & Camera Document Scanner */}
              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-dark-black-900/15">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCameraModalOpen(true)
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 font-figtree font-bold text-[13.5px] text-dark-black-900 shadow-[3px_3px_0_0_rgba(56,56,56,1)] transition-all cursor-pointer"
                >
                  <IconCamera size={18} /> Scan Document with Camera
                </button>
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
                nUp={nUp}
                watermark={watermark}
                mediaType={mediaType}
                inputTray={inputTray}
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
                          {p.inkLevels && p.inkLevels.length > 0 && (
                            <span className="inline-flex items-center gap-1 ml-1 pl-1 border-l border-dark-black-900/20">
                              {p.inkLevels.map((ink) => (
                                <span
                                  key={ink.color}
                                  title={`${ink.name}: ${ink.level}%`}
                                  className={`w-2 h-2 rounded-full inline-block ${
                                    ink.color === 'black' ? 'bg-dark-black-900' : ink.color === 'cyan' ? 'bg-sky-400' : ink.color === 'magenta' ? 'bg-pink-500' : 'bg-amber-400'
                                  }`}
                                />
                              ))}
                            </span>
                          )}
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
            <h2 className="font-figtree font-bold text-[19px] text-dark-black-900 mb-4">Print Settings</h2>

            {/* Settings Tab Switcher */}
            <div className="flex border-b-2 border-dark-black-900/15 mb-5 gap-1 overflow-x-auto pb-1">
              {[
                { id: 'basic', label: 'Basic' },
                { id: 'layout', label: 'Layout (N-Up)' },
                { id: 'media', label: 'Paper & Tray' },
                { id: 'watermark', label: 'Watermark' },
                { id: 'security', label: 'Security & Quota' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`px-3 py-1.5 rounded-[9px] font-figtree text-[12.5px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === t.id
                      ? 'bg-dark-black-900 text-lime-300 shadow-xs'
                      : 'bg-vanilla-100 text-dark-black-900/70 hover:text-dark-black-900 hover:bg-vanilla-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab 1: Basic Options */}
            {activeTab === 'basic' && (
              <div className="flex flex-col gap-4">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                {/* Color & Hardware Duplex Toggles */}
                <div className="border-t-2 border-dark-black-900/15 pt-2 flex flex-col divide-y divide-dark-black-900/10">
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
                      label="Hardware Two-Sided (Duplex)"
                      desc={canDuplex ? 'Automatic hardware duplex on supported printer' : 'Printer does not support hardware duplex'}
                      checked={duplex && canDuplex}
                      onChange={setDuplex}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Advanced Layout & Imposition */}
            {activeTab === 'layout' && (
              <div className="flex flex-col gap-4">
                {/* N-Up Multi-Page Selector */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-figtree text-[13px] font-bold text-dark-black-900">
                      N-Up (Pages per Sheet)
                    </span>
                    <span className="font-geist text-[12px] font-bold text-dark-black-900 bg-lime-300 px-2 py-0.5 rounded-[6px] border border-dark-black-900/30">
                      {nUp === 1 ? '1 Page/Sheet (Normal)' : `${nUp}-Up Multi Page`}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: 1, label: '1 (Single)' },
                      { val: 2, label: '2-Up' },
                      { val: 4, label: '4-Up (2×2)' },
                      { val: 6, label: '6-Up' },
                      { val: 9, label: '9-Up (3×3)' },
                      { val: 16, label: '16-Up' },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setNUp(item.val)}
                        className={`py-2 px-1 rounded-[10px] border-2 font-figtree text-[12.5px] font-bold transition-all cursor-pointer text-center ${
                          nUp === item.val
                            ? 'border-dark-black-900 bg-dark-black-900 text-lime-300 shadow-[2px_2px_0_0_rgba(56,56,56,1)]'
                            : 'border-dark-black-900/25 bg-vanilla-100 hover:border-dark-black-900 text-dark-black-900'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t-2 border-dark-black-900/15 pt-2 flex flex-col divide-y divide-dark-black-900/10">
                  {/* Manual Duplex Assistant */}
                  <Toggle
                    label="Manual Duplex Assistant (Ganjil-Genap)"
                    desc="Mencetak bolak-balik interaktif untuk printer single-sided seperti Epson L3210"
                    checked={manualDuplex}
                    onChange={setManualDuplex}
                  />
                  {/* Collate Switch */}
                  <Toggle
                    label="Collate Copies (Urutkan Berkas)"
                    desc={collate ? '1, 2, 3... lalu 1, 2, 3... (Tersusun rapi per rangkap)' : '1, 1... 2, 2... 3, 3... (Berkelompok per halaman)'}
                    checked={collate}
                    onChange={setCollate}
                  />
                  {/* Borderless Photo Toggle */}
                  <Toggle
                    label="Borderless Photo Mode"
                    desc="Mencetak foto full bleed tanpa tepi putih pada kertas foto"
                    checked={borderless}
                    onChange={setBorderless}
                  />
                  {/* Booklet Mode */}
                  <Toggle
                    label="Booklet Printing (Buku Lipat)"
                    desc="Imposisi halaman lipat tengah (saddle-stitch booklet)"
                    checked={booklet}
                    onChange={setBooklet}
                  />
                </div>
              </div>
            )}

            {/* Tab 3: Media & Input Tray */}
            {activeTab === 'media' && (
              <div className="flex flex-col gap-4">
                <Select
                  label="Media / Paper Type"
                  value={mediaType}
                  onChange={(v) => setMediaType(v)}
                  options={[
                    'Plain Paper (Standard)',
                    'Plain Paper (High Quality)',
                    'Premium Glossy Photo Paper',
                    'Matte Paper (Heavyweight)',
                    'Photo Quality Inkjet Paper',
                    'Envelope (DL/C6/No.10)',
                    'Sticker / Adhesive Label',
                  ]}
                  hint="Pilih jenis media yang sesuai untuk kalibrasi densitas tinta"
                />

                <Select
                  label="Input Paper Slot / Tray"
                  value={inputTray}
                  onChange={(v) => setInputTray(v)}
                  options={[
                    'Auto Select',
                    'Main Cassette / Tray 1',
                    'Rear Manual Feed Slot',
                  ]}
                  hint="Sumber baki kertas fisik pada printer tujuan"
                />

                {ppdOptions.length > 0 && (
                  <div className="mt-2 p-3 rounded-[12px] bg-vanilla-100 border border-dark-black-900/20 text-[12px] font-geist">
                    <span className="font-bold text-dark-black-900">Introspected CUPS PPD Driver:</span>
                    <div className="text-[11px] text-dark-black-900/70 mt-1">
                      {ppdOptions.map((opt) => opt.name).slice(0, 6).join(' · ')}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: Watermark & Security Stamp */}
            {activeTab === 'watermark' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <span className="font-figtree text-[13px] font-bold text-dark-black-900">
                    Watermark Text Stamp
                  </span>
                  <input
                    type="text"
                    value={watermark}
                    onChange={(e) => setWatermark(e.target.value)}
                    placeholder="e.g. DRAFT, CONFIDENTIAL, LUNAS, RAHASIA"
                    className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-geist font-bold text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-figtree text-[12.5px] font-medium text-dark-black-900">
                    Quick Stamp Presets:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Clear', val: '' },
                      { label: 'DRAFT', val: 'DRAFT' },
                      { label: 'CONFIDENTIAL', val: 'CONFIDENTIAL' },
                      { label: 'LUNAS', val: 'LUNAS' },
                      { label: 'SALINAN', val: 'SALINAN' },
                      { label: 'SAMPLE', val: 'SAMPLE' },
                      { label: 'RAHASIA', val: 'RAHASIA' },
                    ].map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setWatermark(chip.val)}
                        className={`px-3 py-1 rounded-[8px] border text-[12px] font-figtree font-bold transition-all cursor-pointer ${
                          watermark === chip.val
                            ? 'bg-dark-black-900 text-lime-300 border-dark-black-900 shadow-xs'
                            : 'bg-vanilla-100 text-dark-black-900 border-dark-black-900/30 hover:border-dark-black-900'
                        }`}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 5: Security PIN & Enterprise Quota (Domain 5) */}
            {activeTab === 'security' && (
              <div className="flex flex-col gap-4">
                <Toggle
                  label="Secure Print Release (PIN / Code)"
                  checked={secureRelease}
                  onChange={setSecureRelease}
                  hint="Tahan dokumen di server sampai PIN 4-digit dimasukkan di layar antrean"
                />

                {secureRelease && (
                  <div className="p-4 bg-warn-100/40 border-2 border-warn-500/50 rounded-[14px] flex flex-col gap-3">
                    <Input
                      label="4-Digit Release PIN"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      placeholder="e.g. 1234"
                      hint="Hanya dokumen dengan PIN ini yang dapat dicetak fisik"
                    />
                    <div className="flex gap-2 items-center">
                      <span className="text-[11.5px] font-figtree text-dark-black-900/70 font-medium">Quick PIN:</span>
                      {['1234', '7777', '9999'].map((pVal) => (
                        <button
                          key={pVal}
                          type="button"
                          onClick={() => setPin(pVal)}
                          className="px-2 py-0.5 bg-vanilla-100 border border-dark-black-900/40 rounded-[6px] text-[11px] font-mono font-bold hover:bg-lime-300 transition-colors"
                        >
                          {pVal}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <Select
                  label="Billing Department"
                  value={department}
                  onChange={setDepartment}
                  options={['Engineering', 'Product & Design', 'Finance & Admin', 'Operations', 'Executive']}
                  hint="Alokasi kuota dan biaya cetak per departemen"
                />

                <div className="p-3 bg-vanilla-100 border border-dark-black-900/20 rounded-[12px] flex items-center justify-between text-[12.5px] font-figtree">
                  <div>
                    <span className="text-dark-black-900/60 block">Monthly Department Quota:</span>
                    <span className="font-geist font-bold text-dark-black-900">485 / 500 pages remaining</span>
                  </div>
                  <span className="px-2.5 py-1 rounded-[8px] bg-ok-100 border border-ok-500 text-ok-700 font-bold text-[11px]">
                    Quota OK
                  </span>
                </div>
              </div>
            )}

            {/* Summary Box */}
            <div className="mt-5 p-4 rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 flex flex-col gap-2">
              <div className="flex justify-between items-center text-[12.5px] font-figtree">
                <span className="text-dark-black-900/60">Estimated Output:</span>
                <span className="font-geist font-bold text-dark-black-900">
                  {Math.ceil(pageCount / (nUp * (duplex && canDuplex ? 2 : 1))) * copies} physical sheet{Math.ceil(pageCount / (nUp * (duplex && canDuplex ? 2 : 1))) * copies > 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex justify-between items-center text-[12.5px] font-figtree">
                <span className="text-dark-black-900/60">Configuration:</span>
                <span className="font-geist text-dark-black-900 text-right truncate max-w-[200px]">
                  {effectivePaper} · {nUp > 1 ? `${nUp}-Up` : '1-Up'} · {effColor ? 'Color' : 'Grayscale'}
                </span>
              </div>
              <div className="flex justify-between items-center text-[12.5px] font-figtree pt-1 border-t border-dark-black-900/10">
                <span className="text-dark-black-900/60">Estimated Cost:</span>
                <span className="font-geist font-bold text-dark-black-900">
                  Rp {estimatedCost.toLocaleString('id-ID')}
                </span>
              </div>
              {secureRelease && (
                <div className="flex justify-between items-center text-[12px] font-figtree text-dark-black-900 bg-warn-100 px-2 py-1 rounded-[6px] border border-warn-500/40">
                  <span className="font-bold">🔒 Secure Release:</span>
                  <span>PIN {pin ? `**** (${pin})` : 'Required'}</span>
                </div>
              )}
              {manualDuplex && (
                <div className="flex justify-between items-center text-[12px] font-figtree text-dark-black-900 bg-lime-300/50 px-2 py-1 rounded-[6px] border border-dark-black-900/20">
                  <span className="font-bold">Manual Duplex:</span>
                  <span>Odd/Even 2-Phase Flow</span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="mt-6 pt-4 border-t-2 border-dark-black-900/15 flex flex-col gap-3">
              <Button
                variant="lime"
                size="lg"
                onClick={handleSubmit}
                disabled={!file || submitting}
                icon={submitting ? (
                  <span className="w-4 h-4 border-2 border-dark-black-900 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <IconUpload size={18} />
                )}
              >
                {submitting
                  ? 'Menambahkan ke Antrean...'
                  : file
                  ? manualDuplex
                    ? 'Start Manual Duplex Flow →'
                    : `Send to Printer (${copies} cop${copies > 1 ? 'ies' : 'y'})`
                  : 'Upload a Document First'}
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
        nUp={nUp}
        watermark={watermark}
        selectedPrinter={selectedPrinter}
        onSubmitJob={handleSubmit}
      />

      {/* ── Interactive Manual Duplex Guidance Modal ── */}
      <Modal
        open={manualDuplexModalOpen}
        onClose={() => setManualDuplexModalOpen(false)}
        title="Manual Duplex Assistant (Cetak 2 Sisi)"
        subtitle={
          manualDuplexStep === 'odd'
            ? 'Langkah 1 Selesai: Halaman Ganjil (Depan) Telah Dicetak'
            : 'Langkah 2 Selesai: Halaman Genap (Belakang) Telah Dicetak'
        }
        size="md"
        footer={
          manualDuplexStep === 'odd' ? (
            <div className="flex gap-2 w-full justify-end">
              <Button variant="ghost" onClick={() => setManualDuplexModalOpen(false)}>
                Batal
              </Button>
              <Button variant="lime" onClick={handleProceedEvenPages}>
                Lanjutkan Cetak Sisi Belakang →
              </Button>
            </div>
          ) : (
            <Button variant="dark" onClick={() => { setManualDuplexModalOpen(false); if (onNavigate) onNavigate('queue'); }}>
              Lihat Antrean Cetak ✓
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {manualDuplexStep === 'odd' ? (
            <>
              <div className="p-4 rounded-[16px] border-2 border-dark-black-900 bg-vanilla-100 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full bg-lime-300 border-2 border-dark-black-900 flex items-center justify-center font-figtree font-black text-lg">
                    1
                  </span>
                  <div>
                    <h4 className="font-figtree font-bold text-dark-black-900 text-[15px]">
                      Ambil Tumpukan Kertas dari Baki Keluaran
                    </h4>
                    <p className="font-geist text-[12.5px] text-dark-black-900/70">
                      Halaman ganjil (1, 3, 5, ...) telah selesai dicetak.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full bg-lime-300 border-2 border-dark-black-900 flex items-center justify-center font-figtree font-black text-lg">
                    2
                  </span>
                  <div>
                    <h4 className="font-figtree font-bold text-dark-black-900 text-[15px]">
                      Balik Tumpukan Kertas (180° Flip)
                    </h4>
                    <p className="font-geist text-[12.5px] text-dark-black-900/70">
                      Balik tumpukan kertas sehingga sisi kosong menghadap ke atas/ke arah cetak baki feeder tanpa mengubah urutan halaman.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full bg-lime-300 border-2 border-dark-black-900 flex items-center justify-center font-figtree font-black text-lg">
                    3
                  </span>
                  <div>
                    <h4 className="font-figtree font-bold text-dark-black-900 text-[15px]">
                      Masukkan Kembali ke Baki Kertas Masuk
                    </h4>
                    <p className="font-geist text-[12.5px] text-dark-black-900/70">
                      Rapatkan pemandu kertas dan klik tombol di bawah untuk mencetak halaman genap secara otomatis.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-sky-blue-100 rounded-[12px] border border-dark-black-900/30 text-[12px] font-geist text-dark-black-900 flex items-center gap-2">
                <IconAlert size={18} className="shrink-0 text-sky-blue-500" />
                <span>
                  KroomPrint secara otomatis membalik urutan cetak halaman genap (reverse order) agar urutan dokumen tetap 1, 2, 3...
                </span>
              </div>
            </>
          ) : (
            <div className="p-6 rounded-[16px] border-2 border-dark-black-900 bg-lime-300/40 text-center flex flex-col items-center gap-2">
              <span className="w-12 h-12 rounded-full bg-dark-black-900 text-lime-300 flex items-center justify-center text-2xl font-bold">
                ✓
              </span>
              <h3 className="font-figtree font-bold text-[17px] text-dark-black-900">
                Pencetakan Bolak-Balik Selesai!
              </h3>
              <p className="font-geist text-[13px] text-dark-black-900/75 max-w-sm">
                Kedua sisi dokumen Anda telah berhasil dikirim dan dicetak dengan rapi.
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* ── Mobile & Camera Document Scanner Modal (Domain 6) ── */}
      <CameraScanModal
        open={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        onScanComplete={(scannedFile) => {
          setFile(scannedFile)
          toast('Dokumen hasil scan kamera berhasil dimuat ke Print Studio!', 'ok')
        }}
      />
    </div>
  )
}
