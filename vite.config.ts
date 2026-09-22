import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the same build works at a domain root, inside a
  // GitHub Pages project path, or from any folder on a local server.
  base: './',
})
