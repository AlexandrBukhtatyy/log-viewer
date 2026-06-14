import { readFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string };
const APP_VERSION = pkg.version;
const APP_BUILD_HASH = (() => {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
})();

// Build target: 'pages' (default, GitHub Pages with /log-viewer/ base + landing)
// or 'onprem' (npm-package + Docker, root base, app only).
const isOnprem = process.env.BUILD_TARGET === 'onprem';

// Replace `<!--APP_VERSION-->...<!--/APP_VERSION-->` markers in any HTML
// entry (the landing's footer uses this). The placeholder keeps a valid
// default value between the markers so IDE preview of `index.html` works
// without a build step.
const versionInjector = (): PluginOption => ({
  name: 'log-viewer:inject-version',
  transformIndexHtml(html) {
    return html.replace(
      /<!--APP_VERSION-->[\s\S]*?<!--\/APP_VERSION-->/g,
      APP_VERSION,
    );
  },
});

// On-prem post-build cleanup:
//   - move `dist/app/index.html` → `dist/index.html` so the bundled CLI
//     can serve everything from a single `dist/` root (assets, sw.js,
//     manifest sit there; the app HTML needs to be a sibling).
//   - drop landing-only assets that Vite copies from `public/`.
const onpremPostBuild = (): PluginOption => ({
  name: 'log-viewer:onprem-post-build',
  apply: 'build',
  enforce: 'post',
  closeBundle() {
    if (!isOnprem) return;
    const distRoot = resolve(__dirname, 'dist');
    const appIndex = resolve(distRoot, 'app', 'index.html');
    const rootIndex = resolve(distRoot, 'index.html');
    if (existsSync(appIndex)) {
      renameSync(appIndex, rootIndex);
      rmSync(resolve(distRoot, 'app'), { recursive: true, force: true });
    }
    // Landing-only assets copied from public/ — not used by the app.
    for (const f of ['landing-hero.png']) {
      const p = resolve(distRoot, f);
      if (existsSync(p)) rmSync(p, { force: true });
    }
  },
});

// https://vite.dev/config/
export default defineConfig({
  base: isOnprem ? '/' : '/log-viewer/',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_BUILD_HASH__: JSON.stringify(APP_BUILD_HASH),
  },
  build: {
    rollupOptions: {
      // Two HTML entries on GitHub Pages:
      //   `/`              → marketing landing (no PWA, no workers)
      //   `/app/`          → the actual log viewer (PWA + sqlite-wasm + workers)
      // On-prem ships only the app entry — landing is GH-Pages marketing.
      input: isOnprem
        ? { app: resolve(__dirname, 'app/index.html') }
        : {
            main: resolve(__dirname, 'index.html'),
            app: resolve(__dirname, 'app/index.html'),
          },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    versionInjector(),
    onpremPostBuild(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: {
        enabled: true,
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Log Viewer',
        short_name: 'Logs',
        description: 'PWA для просмотра логов',
        theme_color: '#1f2937',
        background_color: '#ffffff',
        display: 'standalone',
        // PWA install-prompt fires only for URLs inside `scope`. On GH Pages
        // we scope to `/log-viewer/app/` so the install affordance appears
        // only on the demo, not on the landing. On-prem the package is
        // mounted at root, so scope = `/`.
        start_url: isOnprem ? '/' : '/log-viewer/app/',
        scope: isOnprem ? '/' : '/log-viewer/app/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // SPA fallback points at the app entry. On GH Pages the landing
        // is a separate static `index.html` and must NOT be rewritten —
        // hence the deny-list. On-prem there is no landing, so denylist
        // is empty.
        navigateFallback: isOnprem
          ? 'index.html'
          : '/log-viewer/app/index.html',
        navigateFallbackDenylist: isOnprem
          ? []
          : [/^\/log-viewer\/$/, /^\/log-viewer\/index\.html$/],
      },
    }),
  ],
});
