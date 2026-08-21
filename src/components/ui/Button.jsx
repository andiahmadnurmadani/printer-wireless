import { useApp } from '../../context/AppContext'

const variants = {
  lime: 'bg-lime-300 text-dark-black-900 hover:bg-lime-500 border-dark-black-900',
  vanilla: 'bg-vanilla-200 text-dark-black-900 hover:bg-vanilla-300 border-dark-black-900',
  dark: 'bg-dark-black-900 text-vanilla-100 hover:bg-black border-dark-black-900',
  ghost: 'bg-transparent text-dark-black-900 hover:bg-dark-black-900/5 border-dark-black-900',
  danger: 'bg-err-500 text-white hover:bg-red-600 border-err-500',
}

const sizes = {
  sm: 'px-3 py-1.5 text-[13px] h-[36px] rounded-[10px]',
  md: 'px-4 py-2 text-[14px] h-[42px] rounded-[12px]',
  lg: 'px-6 py-3 text-[16px] h-[50px] rounded-[13px]',
}

export default function Button({
  children,
  variant = 'lime',
  size = 'md',
  onClick,
  type = 'button',
  disabled = false,
  className = '',
  icon,
  title,
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-2 font-semibold border transition-all duration-200 select-none whitespace-nowrap ${variants[variant]} ${sizes[size]} ${
        disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : 'cursor-pointer active:scale-[0.98]'
      } ${className}`}
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      {children}
    </button>
  )
}
