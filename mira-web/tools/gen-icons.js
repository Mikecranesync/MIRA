'use strict';

/**
 * gen-icons.js — generate PWA PNG icons from favicon.svg using sharp
 *
 * Outputs:
 *   public/icons/mira-192.png      192×192  standard
 *   public/icons/mira-512.png      512×512  standard
 *   public/icons/mira-maskable.png 512×512  maskable (amber bg, glyph in 80% safe zone)
 *
 * Run: node tools/gen-icons.js  (from mira-web/ root)
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
const SVG_PATH = path.join(ICONS_DIR, 'favicon.svg');

async function main() {
  if (!fs.existsSync(SVG_PATH)) {
    console.error('ERROR: favicon.svg not found at', SVG_PATH);
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(SVG_PATH);

  // --- mira-192.png ---
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(ICONS_DIR, 'mira-192.png'));
  console.log('  wrote mira-192.png');

  // --- mira-512.png ---
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(ICONS_DIR, 'mira-512.png'));
  console.log('  wrote mira-512.png');

  // --- mira-maskable.png ---
  // Maskable: glyph occupies the inner 80% safe zone (410px), centered on 512px dark bg.
  // Background #0d0e11 fills the full square so the icon looks correct when cropped to circle.
  const CANVAS = 512;
  const GLYPH = Math.round(CANVAS * 0.80); // 410
  const OFFSET = Math.round((CANVAS - GLYPH) / 2); // 51

  const glyphPng = await sharp(svgBuffer)
    .resize(GLYPH, GLYPH)
    .png()
    .toBuffer();

  // Create dark background
  const bg = {
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 13, g: 14, b: 17, alpha: 1 }, // #0d0e11
    },
  };

  await sharp(bg)
    .composite([{ input: glyphPng, top: OFFSET, left: OFFSET }])
    .png()
    .toFile(path.join(ICONS_DIR, 'mira-maskable.png'));
  console.log('  wrote mira-maskable.png');

  console.log('\nDone. Icons written to', ICONS_DIR);
}

main().catch(err => {
  console.error('gen-icons failed:', err.message);
  process.exit(1);
});
