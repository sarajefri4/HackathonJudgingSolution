#!/usr/bin/env node
/**
 * Download Google Fonts for offline use.
 * Run: npm run setup:fonts
 *
 * Downloads DM Sans + DM Serif Display into public/fonts/
 * so the app works fully offline on a local network.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts');

// Specific font files we need (Google Fonts Static API)
const FONT_FILES = [
  {
    url: 'https://fonts.gstatic.com/s/dmsans/v15/rP2tp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2',
    dest: 'DMSans-Regular.woff2',
  },
  {
    url: 'https://fonts.gstatic.com/s/dmsans/v15/rP2tp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2',
    dest: 'DMSans-Regular.woff2',
  },
  {
    url: 'https://fonts.gstatic.com/s/dmsans/v15/rP2rp2ywxg089UriCZaIGDWCBl0O8Q.woff2',
    dest: 'DMSans-Medium.woff2',
  },
  {
    url: 'https://fonts.gstatic.com/s/dmsans/v15/rP2rp2ywxg089UriCZaIGDWCBl0O8Q.woff2',
    dest: 'DMSans-SemiBold.woff2',
  },
  {
    url: 'https://fonts.gstatic.com/s/dmsans/v15/rP2rp2ywxg089UriCZaIGDWCBl0O8Q.woff2',
    dest: 'DMSans-Bold.woff2',
  },
  {
    url: 'https://fonts.gstatic.com/s/dmsans/v15/rP2tp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2',
    dest: 'DMSans-Italic.woff2',
  },
  {
    url: 'https://fonts.gstatic.com/s/dmserifidisplay/v15/u-470qukhQkCoFK6OE6pEqRFmhz7CggA.woff2',
    dest: 'DMSerifDisplay-Regular.woff2',
  },
  {
    url: 'https://fonts.gstatic.com/s/dmserifidisplay/v15/u-4m0qukhQkCoFK6OE6pEqRFmhz7CggAqF8.woff2',
    dest: 'DMSerifDisplay-Italic.woff2',
  },
];

/**
 * Fetch font CSS from Google Fonts API to extract actual woff2 URLs,
 * then download each font file.
 */

const GFONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Serif+Display:ital@0;1&display=swap';

function fetchBuffer(reqUrl) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(reqUrl);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const options = {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };

    protocol.get(reqUrl, options, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
  }

  console.log('📡  Fetching Google Fonts CSS…');
  let cssText;
  try {
    cssText = (await fetchBuffer(GFONTS_CSS_URL)).toString('utf8');
  } catch (err) {
    console.error('❌  Failed to fetch font CSS:', err.message);
    console.error('   Make sure you have internet access when running this command.');
    process.exit(1);
  }

  // Extract all woff2 URLs from the CSS
  const urlRegex  = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g;
  const fontUrlMap = new Map(); // filename → url
  let match;
  while ((match = urlRegex.exec(cssText)) !== null) {
    const fontUrl  = match[1];
    const filename = path.basename(new URL(fontUrl).pathname);
    fontUrlMap.set(filename, fontUrl);
  }

  console.log(`   Found ${fontUrlMap.size} font variant(s) in CSS.`);

  // Build a name mapping based on CSS context (font-family + weight + style)
  // We parse each @font-face block
  const faceRegex =
    /@font-face\s*\{([^}]+)\}/g;
  const downloads = [];

  while ((match = faceRegex.exec(cssText)) !== null) {
    const block   = match[1];
    const familyM = block.match(/font-family:\s*['"]?([^;'"]+)['"]?/);
    const weightM = block.match(/font-weight:\s*([^;]+)/);
    const styleM  = block.match(/font-style:\s*([^;]+)/);
    const srcM    = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);

    if (!familyM || !srcM) continue;

    const family = familyM[1].trim().replace(/\s+/g, '');
    const weight = (weightM?.[1] || '400').trim();
    const style  = (styleM?.[1] || 'normal').trim();
    const fontUrl = srcM[1];

    let weightName = 'Regular';
    const wNum = parseInt(weight, 10);
    if (!isNaN(wNum)) {
      if (wNum <= 400)      weightName = style === 'italic' ? 'Italic' : 'Regular';
      else if (wNum <= 500) weightName = 'Medium';
      else if (wNum <= 600) weightName = 'SemiBold';
      else                  weightName = 'Bold';
    }

    const suffix   = style === 'italic' ? '-Italic' : '';
    const basename = `${family}-${weightName}${suffix === '-Italic' && weightName === 'Italic' ? '' : suffix}.woff2`;
    const dest     = path.join(FONTS_DIR, basename);

    if (!downloads.find(d => d.dest === dest)) {
      downloads.push({ url: fontUrl, dest, label: basename });
    }
  }

  if (downloads.length === 0) {
    console.warn('⚠️   Could not parse font faces from CSS. Falling back to known URLs.');
    // Fallback: download hardcoded list
    for (const { url: fontUrl, dest: filename } of FONT_FILES) {
      const dest = path.join(FONTS_DIR, filename);
      if (!downloads.find(d => d.dest === dest)) {
        downloads.push({ url: fontUrl, dest, label: filename });
      }
    }
  }

  let ok = 0;
  let skipped = 0;
  for (const { url: fontUrl, dest, label } of downloads) {
    if (fs.existsSync(dest)) {
      console.log(`   ✓ Already exists: ${label}`);
      skipped++;
      continue;
    }
    process.stdout.write(`   ↓ Downloading ${label}…`);
    try {
      const data = await fetchBuffer(fontUrl);
      fs.writeFileSync(dest, data);
      process.stdout.write(' done\n');
      ok++;
    } catch (err) {
      process.stdout.write(` FAILED (${err.message})\n`);
    }
  }

  console.log(`\n✅  Fonts ready: ${ok} downloaded, ${skipped} already present.`);
  console.log(`   Location: ${FONTS_DIR}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
