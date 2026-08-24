import { useApp } from '../../context/AppContext'

const styles = {
  success: { border: 'border-dark-black-900', bg: 'bg-lime-300', dot: 'bg-ok-500', label: '✓' },
  error: { border: 'border-err-500', bg: 'bg-err-100', dot: 'bg-err-500', label: '!' },
  info: { border: 'border-dark-black-900', bg: 'bg-sky-blue-100', dot: 'bg-sky-blue-500', label: 'i' },
  warn: { border: 'border-dark-black-900', bg: 'bg-warn-100', dot: 'bg-warn-500', label: '!' },
}

/**
 * Toast stack — bottom right, Bugster-styled.
 */
export default function ToastStack() {
  const { toasts } = useApp()
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3">
      {toasts.map((t) => {
        const s = styles[t.type] || styles.info
        return (
          <div
            key={t.id}
            className={`toast-in flex items-center gap-3 pl-3 pr-5 py-3 border-2 ${s.border} ${s.bg} rounded-[14px] shadow-lg max-w-sm`}
          >
            <span
              className={`w-6 h-6 shrink-0 rounded-full ${s.dot} border border-dark-black-900 text-white flex items-center justify-center text-[12px] font-bold`}
            >
              {s.label}
            </span>
            <span className="font-figtree font-medium text-dark-black-900 text-[14px] leading-snug">{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}
