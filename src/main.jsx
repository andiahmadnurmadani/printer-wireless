import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.jsx'
import { isNativeApp } from './native/server'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div className="h-full bg-vanilla-200" />}>
      <Root />
    </Suspense>
  </StrictMode>
)

if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeApp()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
