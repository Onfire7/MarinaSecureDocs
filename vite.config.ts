import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
