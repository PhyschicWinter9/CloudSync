'use strict';

/**
 * Bakes the app's icon assets as plain PNGs, with no image-library
 * dependency. Run with `node scripts/generate-icons.js`.
 */

const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png');

const BRAND = [217, 119, 87]; // #D97757 - warm terracotta

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Antialiased rounded-rect coverage in [0,1].
function roundedRectCoverage(x, y, w, h, r) {
  const dx = Math.max(Math.max(-x, x - (w - 1)), 0);
  const dy = Math.max(Math.max(-y, y - (h - 1)), 0);
  if (x >= r && x <= w - 1 - r) return dy <= 0 ? 1 : 0;
  if (y >= r && y <= h - 1 - r) return dx <= 0 ? 1 : 0;
  const cx = x < r ? r : w - 1 - r;
  const cy = y < r ? r : h - 1 - r;
  const dist = Math.hypot(x - cx, y - cy);
  return clamp01(r + 0.5 - dist);
}

// Antialiased "is this point inside the upward-arrow glyph" coverage in [0,1].
// `aa` is the antialiasing transition width in the same normalized [0,1]
// units as nx/ny (about one pixel).
function arrowCoverage(nx, ny, aa) {
  // nx, ny in [0, 1] icon space. Arrow points up: a triangular head over a
  // rectangular shaft, both centered horizontally.
  const cx = 0.5;
  const shaftHalfWidth = 0.09;
  const shaftTop = 0.34;
  const shaftBottom = 0.72;
  const headTopY = 0.16;
  const headBottomY = 0.42;
  const headHalfWidth = 0.24;

  const edge = (signedDist) => clamp01(signedDist / aa + 0.5);

  let inside = 0;

  if (ny >= shaftTop - aa && ny <= shaftBottom + aa) {
    const half = shaftHalfWidth;
    const horiz = edge(half - Math.abs(nx - cx));
    const vert = Math.min(edge(ny - shaftTop), edge(shaftBottom - ny));
    inside = Math.max(inside, Math.min(horiz, vert));
  }

  if (ny >= headTopY - aa && ny <= headBottomY + aa) {
    const t = clamp01((ny - headTopY) / (headBottomY - headTopY));
    const half = headHalfWidth * t;
    const horiz = edge(half - Math.abs(nx - cx));
    const vert = Math.min(edge(ny - headTopY), edge(headBottomY - ny));
    inside = Math.max(inside, Math.min(horiz, vert));
  }

  return inside;
}

function writeIcon(filePath, size, { withBackground }) {
  const aa = 1.2 / size;
  const png = encodePNG(size, size, (x, y) => {
    const nx = x / (size - 1);
    const ny = y / (size - 1);
    const glyph = arrowCoverage(nx, ny, aa);

    if (withBackground) {
      const bgCoverage = roundedRectCoverage(x, y, size, size, size * 0.22);
      const [br, bg, bb] = BRAND;
      const r = Math.round(br + (255 - br) * glyph);
      const g = Math.round(bg + (255 - bg) * glyph);
      const b = Math.round(bb + (255 - bb) * glyph);
      return [r, g, b, Math.round(255 * bgCoverage)];
    }

    // Template glyph: solid black shape, transparent elsewhere. macOS
    // recolors this automatically for light/dark menu bars because the
    // filename ends in "Template".
    return [0, 0, 0, Math.round(255 * glyph)];
  });

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
  console.log(`wrote ${filePath} (${size}x${size})`);
}

const buildDir = path.join(__dirname, '..', 'build');
const rendererAssetsDir = path.join(__dirname, '..', 'src', 'renderer', 'assets');

writeIcon(path.join(buildDir, 'icon.png'), 512, { withBackground: true });
writeIcon(path.join(rendererAssetsDir, 'icon.png'), 128, { withBackground: true });
writeIcon(path.join(buildDir, 'trayTemplate.png'), 22, { withBackground: false });
writeIcon(path.join(buildDir, 'trayTemplate@2x.png'), 44, { withBackground: false });
