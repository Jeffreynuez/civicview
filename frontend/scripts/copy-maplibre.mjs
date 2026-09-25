// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Copies MapLibre's three module files into public/maplibre/<version>/
// so the site serves them from its own origin. Runs on npm install
// (postinstall), before every build (prebuild) and before next dev.
//
// Why: maplibre-gl 6 ships as ES modules only, split into the main file
// (maplibre-gl.mjs), a tile worker (maplibre-gl-worker.mjs), and code both
// of them import by relative path (maplibre-gl-shared.mjs, about 147 kB
// gzipped). MapView loads the main file from this folder with a native
// import() instead of bundling it, so the page and the worker import the
// same shared file and the browser downloads it once. Bundled through
// webpack, the page carried its own copy and the worker fetched a second
// one, about 435 kB gzipped for the map instead of about 300 kB.
// The version in the path keeps all three files in step across deploys
// and lets next.config.js cache them as immutable. public/maplibre/ is
// generated, not committed (.gitignore).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'maplibre-gl');
const outRoot = join(root, 'public', 'maplibre');
const FILES = ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

if (!existsSync(join(pkgDir, 'package.json'))) {
  // Nothing to copy yet (for example a partial install). A build without
  // the package still fails, on the stylesheet import in app/layout.js.
  console.warn('copy-maplibre: maplibre-gl is not installed; skipped');
  process.exit(0);
}

const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const outDir = join(outRoot, version);
mkdirSync(outDir, { recursive: true });
for (const name of FILES) {
  const src = join(pkgDir, 'dist', name);
  if (!existsSync(src)) {
    console.error(`copy-maplibre: ${src} is missing; the map would not load`);
    process.exit(1);
  }
  copyFileSync(src, join(outDir, name));
}
// Drop folders left by earlier versions.
for (const entry of readdirSync(outRoot)) {
  if (entry !== version) rmSync(join(outRoot, entry), { recursive: true, force: true });
}
console.log(`copy-maplibre: maplibre-gl ${version} module files in public/maplibre/${version}/`);
