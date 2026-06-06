import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_ELECTRON === '1' ? './' : '/',
  resolve: {
    conditions: ['browser', 'module', 'import', 'default'],
  },
  optimizeDeps: {
    include: ['firebase/app', 'firebase/firestore'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
})
