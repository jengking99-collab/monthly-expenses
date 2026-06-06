import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_ELECTRON === '1' ? './' : '/',
  resolve: {
    alias: {
      'firebase/app':       resolve(__dirname, 'node_modules/firebase/app/dist/esm/index.esm.js'),
      'firebase/firestore': resolve(__dirname, 'node_modules/firebase/firestore/dist/esm/index.esm.js'),
    },
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
