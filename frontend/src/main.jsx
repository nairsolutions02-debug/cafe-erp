import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { captureQrTable } from './lib/qrTable'

captureQrTable()

// Per-cafe primary colour (falls back to the CSS default)
if (import.meta.env.VITE_CAFE_THEME_COLOR) {
  const root = document.documentElement.style
  const color = import.meta.env.VITE_CAFE_THEME_COLOR
  root.setProperty('--primary', color)
  root.setProperty('--bg-primary', color)
  root.setProperty('--primary-dark', `color-mix(in srgb, ${color} 80%, black)`)
  root.setProperty('--primary-light', `color-mix(in srgb, ${color} 80%, white)`)
}

// Offline shell + phone alerts while the app is closed (not inside the Android app, which has its own)
if ('serviceWorker' in navigator && import.meta.env.PROD && !globalThis.Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
