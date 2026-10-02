import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Defaults for the per-cafe branding placeholders in index.html
const HTML_DEFAULTS = {
  VITE_CAFE_NAME: 'Cafe ERP',
  VITE_CAFE_TAGLINE: 'Fresh food, served fast',
  VITE_CAFE_THEME_COLOR: '#C87316',
  VITE_CAFE_LOGO_URL: '/logo.svg',
}

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
    ],
    define: {
      'import.meta.env.VITE_CAFE_THEME_COLOR': JSON.stringify(env.VITE_CAFE_THEME_COLOR),
    },
  }
})
