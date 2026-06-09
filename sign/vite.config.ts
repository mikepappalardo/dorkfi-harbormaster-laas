import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public/sign',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/repay': 'http://localhost:3456',
    },
  },
  define: {
    global: 'globalThis',
  },
})
