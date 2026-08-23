/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Node 22+'s native (experimental) global `localStorage` shadows jsdom's
    // own implementation with a non-functional stub (missing .clear(), no
    // real prototype) unless a --localstorage-file is configured — disabling
    // it lets vitest-environment-jsdom install its real Storage shim instead.
    execArgv: ['--no-experimental-webstorage'],
  },
})
