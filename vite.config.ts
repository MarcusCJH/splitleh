/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set base to '/splitsia/' for GitHub Pages; change to '/' for custom domains.
export default defineConfig({
  plugins: [react()],
  base: '/SplitSia/',
  optimizeDeps: {
    // tesseract.js is CJS; Vite must pre-bundle it to ESM for the dev server.
    // The production build handles it fine via rollup regardless.
    include: ['tesseract.js'],
  },
  test: {
    environment: 'node',
  },
})
