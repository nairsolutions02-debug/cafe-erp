import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Defaults for the per-cafe branding placeholders in index.html
const HTML_DEFAULTS = {
  VITE_CAFE_NAME: 'Cafe ERP',
  VITE_CAFE_TAGLINE: 'Fresh food, served fast',
  VITE_CAFE_THEME_COLOR: '#C87316',
  VITE_CAFE_LOGO_URL: '/logo.svg',
}

// Installable app manifest with the cafe's name and colour (served in dev, emitted on build)
const manifest = (env) => JSON.stringify({
  name: env.VITE_CAFE_NAME || HTML_DEFAULTS.VITE_CAFE_NAME,
  short_name: (env.VITE_CAFE_NAME || HTML_DEFAULTS.VITE_CAFE_NAME).slice(0, 12),
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#FFFAEF',
  theme_color: env.VITE_CAFE_THEME_COLOR || HTML_DEFAULTS.VITE_CAFE_THEME_COLOR,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'My day', url: '/admin/me' },
    { name: 'Counter', url: '/admin/pos' },
    { name: 'Kitchen', url: '/admin/kitchen' },
  ],
}, null, 2)

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...HTML_DEFAULTS, ...loadEnv(mode, process.cwd(), 'VITE_CAFE_') }
  return {
    plugins: [
      react(),
      {
        name: 'cafe-branding-html',
        transformIndexHtml: (html) =>
          html.replace(/%(VITE_CAFE_[A-Z_]+)%/g, (match, key) => env[key] || HTML_DEFAULTS[key] || ''),
      },
      {
        name: 'cafe-manifest',
        configureServer(server) {
          server.middlewares.use('/manifest.webmanifest', (req, res) => {
            res.setHeader('Content-Type', 'application/manifest+json')
            res.end(manifest(env))
          })
        },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest(env) })
        },
      },
    ],
    define: {
      'import.meta.env.VITE_CAFE_THEME_COLOR': JSON.stringify(env.VITE_CAFE_THEME_COLOR),
    },
  }
})
