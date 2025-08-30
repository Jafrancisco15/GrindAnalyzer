// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'  // o '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(process.cwd(), 'node_modules/react'),
      'react-dom': path.resolve(process.cwd(), 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'], // fuerza una sola instancia
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
})
