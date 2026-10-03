/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * A built dashboard has no default API address (src/api/client.ts): a build
 * without one would send every visitor's requests to their own `localhost`.
 * Refusing to build is the loud, early version of that failure — the host
 * (Cloudflare Pages) keeps serving the previous deployment instead of
 * publishing a dashboard that cannot reach the backend.
 */
function requireApiBaseUrl(mode: string): void {
  // Reads .env files AND the process environment, which is where a hosting
  // provider's build settings arrive.
  const value = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL?.trim()
  if (!value) {
    throw new Error(
      'VITE_API_BASE_URL is not set. Set it to the backend origin (for example in the hosting ' +
        "provider's build environment variables, or web-dashboard/.env for a local build) and build again.",
    )
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('VITE_API_BASE_URL is not a valid URL. It must be the backend origin, e.g. https://api.example.com')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('VITE_API_BASE_URL must start with https:// (or http:// for a local build).')
  }
  // Cloudflare Pages sets CF_PAGES=1 in its build environment. A loopback
  // address is fine for a build made and previewed on a developer's machine,
  // but can only be a mistake in a build that is about to be published.
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (process.env.CF_PAGES && isLoopback) {
    throw new Error(
      `VITE_API_BASE_URL points at ${url.hostname}, which a deployed dashboard cannot reach. Set it to the public backend origin.`,
    )
  }
}

/**
 * ADR-068: the iPhone/iPad Safari portal is a second page (portal.html) in
 * the same build, served for every /visit/* path. In production that is
 * public/_redirects (Cloudflare Pages); this does the same for the dev and
 * preview servers.
 */
function portalRoutes(): Plugin {
  const rewrite = (url: string | undefined) =>
    url && (url === '/visit' || url.startsWith('/visit/') || url.startsWith('/visit?')) ? '/portal.html' : url
  return {
    name: 'livequeue-portal-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = rewrite(req.url)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = rewrite(req.url)
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build') requireApiBaseUrl(mode)

  return {
    plugins: [react(), tailwindcss(), portalRoutes()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          portal: resolve(import.meta.dirname, 'portal.html'),
        },
      },
    },
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
  }
})
