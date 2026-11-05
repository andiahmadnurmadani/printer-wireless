import { lazy } from 'react'
import { isNativeApp, getServerUrl } from './native/server'

// Landing page dan dashboard dipisah jadi chunk sendiri supaya halaman
// depan tidak ikut memuat pdf.js dan seluruh dashboard.
const App = lazy(() => import('./App.jsx'))
const LandingPage = lazy(() => import('./landing/LandingPage.jsx'))
const ServerSetup = lazy(() => import('./native/ServerSetup.jsx'))

export default function Root() {
  if (isNativeApp()) return getServerUrl() ? <App /> : <ServerSetup />
  if (window.location.pathname.startsWith('/app')) return <App />
  return <LandingPage />
}
