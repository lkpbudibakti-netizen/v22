import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import { resolveBuildIdentity } from './scripts/buildIdentity';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  const identity = resolveBuildIdentity(__dirname);
  return {
    define: {
      __APP_BUILD_SHA__: JSON.stringify(identity.buildSha),
      __APP_BUILD_ID__: JSON.stringify(identity.buildId),
      __APP_BUILD_DIRTY__: JSON.stringify(identity.buildDirty),
    },
    plugins: [
      {
        name: 'runtime-build-identity',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(identity) });
        },
        configureServer(server) {
          server.middlewares.use('/build-info.json', (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(identity));
          });
        },
      } satisfies Plugin,
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icon.svg'],
        workbox: {
          skipWaiting: false,
          clientsClaim: true,
          globIgnores: ['**/build-info.json'],
          navigateFallbackDenylist: [/^\/api\//, /\/build-info\.json$/],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        },
        manifest: {
          id: '/',
          name: 'Administrasi Guru AI',
          short_name: 'AdminGuruAI',
          description: 'Aplikasi penyusun administrasi pembelajaran bertahap untuk guru: Profil, CP, TP, ATP, dan Ekspor Word.',
          theme_color: '#1e3a8a',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icon.svg',
              sizes: '192x192 512x512',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
