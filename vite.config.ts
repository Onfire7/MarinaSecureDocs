import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Ship React's *development* build (and skip minification) so runtime errors
 * arrive as full sentences with readable component stacks, instead of the
 * "Minified React error #185; visit react.dev/errors/185" codes that a
 * production bundle emits. React picks its build off `process.env.NODE_ENV`,
 * which Vite otherwise hardcodes to "production" for any `vite build`.
 *
 * This is deliberately ON for the beta deployment, which is this project's
 * debugging environment — the tradeoff is a noticeably larger, slower bundle,
 * and every other library that branches on NODE_ENV (Clerk, InstantDB) takes
 * its dev path too. Set REACT_DEV_BUILD=0 to build a real production bundle;
 * flip DEBUG_BUILD's default to false once the check-in error is pinned down.
 */
const DEBUG_BUILD = process.env.REACT_DEV_BUILD !== '0'

if (DEBUG_BUILD) {
  console.warn(
    '\n[vite] DEBUG BUILD: bundling React\'s development build, unminified.\n' +
      '       Bigger and slower on purpose — see vite.config.ts.\n' +
      '       Build with REACT_DEV_BUILD=0 for a production bundle.\n',
  )
}

// https://vite.dev/config/
export default defineConfig({
  define: DEBUG_BUILD
    ? { 'process.env.NODE_ENV': JSON.stringify('development') }
    : {},
  build: DEBUG_BUILD ? { minify: false } : {},
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': autoUpdate swaps the worker on the next
      // launch with nothing on screen to say so, which makes a stale build
      // indistinguishable from a bug — a dropdown that was replaced days ago
      // still looked like a dropdown. The new worker now waits until someone
      // presses Update (see UpdateButton), which is also the only way the
      // app can tell you there's something to press.
      registerType: 'prompt',
      // Registration is UpdateButton's job — the injected script would
      // register a second time and the hook would never see the waiting
      // worker.
      injectRegister: null,
      // App-shell caching. The build has no code-splitting (one JS bundle),
      // so precaching it — which globPatterns below does — already includes
      // the InstantDB and Clerk SDK code itself: the app still boots and
      // renders offline. What must NOT be cached is their *live network
      // traffic* (auth token exchange, Instant's sync/query calls) — those
      // are cross-origin requests to instantdb.com / clerk.com, which this
      // generateSW config never intercepts (no runtimeCaching entries for
      // them), so they always hit the network and fail cleanly offline
      // rather than replaying a stale/signed-out response. InstantDB's own
      // local-first cache (IndexedDB, independent of the service worker)
      // is what actually keeps data usable offline once the shell has
      // loaded. The default navigateFallback (this precached index.html)
      // applies to every navigation, including /checkin/:guidUrl — the
      // NFC/QR deep link is client-routed by React Router once the shell
      // loads, so it must fall back the same as any other route.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // The unminified debug bundle blows past Workbox's 2 MiB default,
        // which would silently drop the app shell from the precache and
        // quietly break offline support — the one thing the PWA is for.
        ...(DEBUG_BUILD ? { maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 } : {}),
      },
      manifest: {
        name: 'MarinaSecure',
        short_name: 'MarinaSecure',
        description: 'Marina security, checklists, and operations.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f3f4f2',
        theme_color: '#2f5d7c',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/maskable-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
