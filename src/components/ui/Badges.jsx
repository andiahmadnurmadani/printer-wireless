import { useApp } from '../../context/AppContext'

const statusStyle = {
  online: 'bg-ok-100 text-ok-500 border-dark-black-900',
  offline: 'bg-surface-gray-300 text-dark-gray-600 border-dark-black-900',
  error: 'bg-err-100 text-err-500 border-err-500',
  paused: 'bg-warn-100 text-warn-500 border-dark-black-900',
}

const dotStyle = {
  online: 'bg-ok-500',
  offline: 'bg-dark-gray-600',
  error: 'bg-err-500',
  paused: 'bg-warn-500',
}

export default function StatusBadge({ status, label, dot = true, className = '' }) {
  const s = statusStyle[status] || statusStyle.offline
  const d = dotStyle[status] || dotStyle.offline
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[12px] font-semibold font-figtree ${s} ${className}`}
    >
      {dot && <span className={`w-2 h-2 rounded-full ${d} ${status === 'online' ? 'animate-pulse' : ''}`} />}
      {label || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

export function FileTypeBadge({ type }) {
  const colors = {
    PDF: 'bg-err-100 text-err-500',
    PNG: 'bg-sky-blue-100 text-sky-blue-500',
    JPG: 'bg-warn-100 text-warn-500',
    TXT: 'bg-lime-300 text-dark-black-900',
    DOCX: 'bg-sky-blue-100 text-sky-blue-500',
    DOC: 'bg-sky-blue-100 text-sky-blue-500',
    XLSX: 'bg-ok-100 text-ok-500',
    PPTX: 'bg-err-100 text-err-500',
    CSV: 'bg-lime-300 text-dark-black-900',
    BMP: 'bg-surface-gray-300 text-dark-gray-600',
    WEBP: 'bg-surface-gray-300 text-dark-gray-600',
    HEIC: 'bg-surface-gray-300 text-dark-gray-600',
  }
  const c = colors[type] || 'bg-vanilla-300 text-dark-black-900'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold font-geist border border-dark-black-900/60 ${c}`}>
      {type}
    </span>
  )
}
