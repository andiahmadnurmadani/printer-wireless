// ─────────────────────────────────────────────
// KroomPrint inline SVG icons
// Line icons matching the Bugster stroke aesthetic
// ─────────────────────────────────────────────

const base = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const IconPrinter = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
    <circle cx="18" cy="8" r="0.8" fill="currentColor" />
  </svg>
)

export const IconPlus = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} {...base} strokeWidth={2} className={className} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconSearch = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

export const IconTrash = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

export const IconPencil = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
)

export const IconCheck = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} strokeWidth={2.4} className={className} aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const IconCheckCircle = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </svg>
)

export const IconPower = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <path d="M12 2v10" />
  </svg>
)

export const IconPause = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
)

export const IconPlay = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="m6 4 14 8-14 8Z" />
  </svg>
)

export const IconRefresh = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

export const IconWifi = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M5 13a10 10 0 0 1 14 0" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <circle cx="12" cy="19.5" r="1" fill="currentColor" />
    <path d="M2 9.5a15 15 0 0 1 20 0" opacity="0.5" />
  </svg>
)

export const IconUsb = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M10 2h4v4h-4z" />
    <path d="M12 6v5" />
    <rect x="9" y="11" width="6" height="9" rx="1" />
    <path d="M9 14h6" />
  </svg>
)

export const IconStar = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z" />
  </svg>
)

export const IconUpload = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
)

export const IconFile = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
  </svg>
)

export const IconImage = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>
)

export const IconTxt = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h5" />
  </svg>
)

export const IconClock = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconGear = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export const IconHistory = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconQueue = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M4 6h16M4 12h10M4 18h7" />
    <circle cx="18" cy="17" r="3" />
    <path d="m19.5 15.5-2 2" opacity="0.6" />
  </svg>
)

export const IconHome = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M9 22V12h6v10" />
  </svg>
)

export const IconLogout = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </svg>
)

export const IconChevronDown = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} strokeWidth={2.2} className={className} aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const IconChevronUp = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} strokeWidth={2.2} className={className} aria-hidden="true">
    <path d="m18 15-6-6-6 6" />
  </svg>
)

export const IconArrowRight = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} strokeWidth={2.2} className={className} aria-hidden="true">
    <path d="M5 12h14m-6-6 6 6-6 6" />
  </svg>
)

export const IconFilter = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M22 3H2l8 9.46V19l4 2v-8.54Z" />
  </svg>
)

export const IconCopy = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
)

export const IconAlert = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

export const IconDownload = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
)

export const IconEye = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const IconDrag = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} {...base} className={className} aria-hidden="true">
    <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)
