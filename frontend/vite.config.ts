import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // A fixed port of its own, so it never silently moves when another Vite app holds 5173.
    port: 5180,
    strictPort: true,
    // Same origin as the API in development, so there is no CORS to configure.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
