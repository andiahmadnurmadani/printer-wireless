import { useEffect } from 'react'

/**
 * Modal with the Bugster design language:
 * thick black border, rounded corners, lime corner squares.
 */
export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', showClose = true }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-dark-black-900/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div className={`modal-in relative w-full ${widths[size]} bg-vanilla-200 border-2 border-dark-black-900 rounded-[24px] shadow-2xl max-h-[88vh] flex flex-col`}>
        {/* Corner squares */}
        <div className="absolute -top-[9px] -left-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] z-10 pointer-events-none" />
        <div className="absolute -bottom-[9px] -right-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] z-10 pointer-events-none" />

        {title && (
          <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-4 border-b border-dark-black-900/15">
            <div>
              <h3 className="font-figtree font-semibold text-dark-black-900 text-[22px] leading-tight">{title}</h3>
              {subtitle && <p className="font-figtree font-light text-dark-black-900/60 text-[14px] mt-1">{subtitle}</p>}
            </div>
            {showClose && (
              <button
                onClick={onClose}
                className="w-9 h-9 shrink-0 rounded-[10px] border border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 transition-colors flex items-center justify-center text-dark-black-900 font-semibold cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        )}

        <div className="px-7 py-5 overflow-y-auto flex-1">{children}</div>

        {footer && <div className="px-7 py-4 border-t border-dark-black-900/15 flex items-center justify-end gap-3">{footer}</div>}
      </div>
    </div>
  )
}
