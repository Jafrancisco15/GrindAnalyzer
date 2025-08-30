// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'  // o '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],   // 👈 fuerza una sola copia
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],  // 👈 pre-bundle único
  },
})
