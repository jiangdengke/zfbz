#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://haowallpaper.com/link/';
const SITE_URL = 'https://haowallpaper.com/';
const REFERER = 'https://haowallpaper.com/homeView';
const KEY = Buffer.from('68zhehao2O776519', 'utf8');
const IV = Buffer.from('aa176b7519e84710', 'utf8');

const DEFAULTS = {
  limit: 20,
  out: 'downloads/haowallpaper',
  asset: 'complete',
  startPage: 1,
  rows: 12,
  sortType: 3,
  wpType: '1,3',
  delayMs: 800,
  dryRun: false,
  overwrite: false,
  token: process.env.HAOWALLPAPER_TOKEN || '',
  yes: false,
};

function printHelp() {
  console.log(`Usage: node scripts/haowallpaper-crawler.mjs [options]

Options:
  --limit <n>       Number of assets to download. Default: ${DEFAULTS.limit}
  --out <dir>       Output directory. Default: ${DEFAULTS.out}
  --asset <mode>    Asset mode: complete, preview, or crop. Default: ${DEFAULTS.asset}
  --token <value>   Account token for complete/original downloads. Prefer HAOWALLPAPER_TOKEN.
  --start-page <n>  First list page to fetch. Default: ${DEFAULTS.startPage}
  --rows <n>        Items requested per list page. Default: ${DEFAULTS.rows}
  --sort-type <n>   Site sort type. Default: ${DEFAULTS.sortType}
  --wp-type <value> Wallpaper type filter. Default: ${DEFAULTS.wpType}
  --delay-ms <n>    Delay between downloads. Default: ${DEFAULTS.delayMs}
  --dry-run         Fetch list data without downloading assets.
  --overwrite       Replace existing files.
  --yes             Allow limits above 200.
  --help            Show this help message.

Examples:
  HAOWALLPAPER_TOKEN=... node scripts/haowallpaper-crawler.mjs --limit 10
  node scripts/haowallpaper-crawler.mjs --asset preview --limit 10
  node scripts/haowallpaper-crawler.mjs --dry-run --limit 5
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    switch (arg) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      case '--limit':
        options.limit = Number.parseInt(next(), 10);
        break;
      case '--out':
        options.out = next();
        break;
      case '--asset':
        options.asset = next();
        break;
      case '--token':
        options.token = next();
        break;
      case '--start-page':
        options.startPage = Number.parseInt(next(), 10);
        break;
      case '--rows':
        options.rows = Number.parseInt(next(), 10);
        break;
      case '--sort-type':
        options.sortType = Number.parseInt(next(), 10);
        break;
      case '--wp-type':
        options.wpType = next();
        break;
      case '--delay-ms':
        options.delayMs = Number.parseInt(next(), 10);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--overwrite':
        options.overwrite = true;
        break;
      case '--yes':
        options.yes = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  validateOptions(options);
  return options;
}

function validateOptions(options) {
  const positiveIntegerFields = ['limit', 'startPage', 'rows'];
  for (const field of positiveIntegerFields) {
    if (!Number.isInteger(options[field]) || options[field] < 1) {
      throw new Error(`${field} must be a positive integer`);
    }
  }

  if (!Number.isInteger(options.sortType) || options.sortType < 1) {
    throw new Error('sortType must be a positive integer');
  }

  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error('delayMs must be a non-negative integer');
  }

  if (options.limit > 200 && !options.yes) {
    throw new Error('limit above 200 requires --yes to avoid accidental bulk crawling');
  }

  if (!['complete', 'preview', 'crop'].includes(options.asset)) {
    throw new Error('asset must be one of: complete, preview, crop');
  }

  if (options.asset === 'complete' && !options.token && !options.dryRun) {
    throw new Error('complete/original downloads require HAOWALLPAPER_TOKEN or --token; unauthenticated getCompleteUrl requests return 3004/401');
  }
}

function encryptValue(text) {
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

function decryptValue(text) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([
    decipher.update(Buffer.from(text, 'base64')),
    decipher.final(),
  ]).toString('utf8').replace(/\0.*$/g, '');
}

async function requestJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache',
      referer: REFERER,
      'user-agent': userAgent(),
      ...headers,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 200)}`);
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Invalid JSON response from ${url}: ${body.slice(0, 200)}`);
  }
}

async function fetchWallpaperPage(options, page, rows) {
  const form = {
    page,
    rows,
    sortType: options.sortType,
    isFavorites: false,
    wpType: options.wpType,
    lbId: '',
  };
  const query = new URLSearchParams({ data: encryptValue(JSON.stringify(form)) });
  const payload = await requestJson(`${API_BASE}pc/wallpaper/wallpaperList?${query}`);

  if (payload.status !== 200 || typeof payload.data !== 'string') {
    throw new Error(`Unexpected API response: ${JSON.stringify(payload).slice(0, 300)}`);
  }

  return JSON.parse(decryptValue(payload.data));
}

async function downloadAsset(item, outputDirectory, index, options) {
  if (options.asset === 'complete') {
    return downloadComplete(item, outputDirectory, index, options);
  }

  const endpoint = options.asset === 'preview' ? 'previewFileImg' : 'getCroppingImg';
  const label = options.asset === 'preview' ? 'preview' : 'crop';
  return downloadPublicFile(item, outputDirectory, index, options.overwrite, endpoint, label);
}

async function downloadComplete(item, outputDirectory, index, options) {
  if (!item.wtId) throw new Error(`Missing wtId for fileId=${item.fileId || 'unknown'}`);
  if (!options.token) {
    throw new Error('complete/original downloads require HAOWALLPAPER_TOKEN or --token; unauthenticated getCompleteUrl requests return 3004/401');
  }

  const payload = await requestJson(`${API_BASE}common/file/getCompleteUrl/${item.wtId}`, {
    token: options.token,
  });

  if (payload.status !== 200 || typeof payload.data !== 'string' || !payload.data) {
    throw new Error(`complete URL unavailable for wtId=${item.wtId}: ${JSON.stringify(payload).slice(0, 200)}`);
  }

  const url = new URL(payload.data, SITE_URL).href;
  return downloadFromUrl(url, outputDirectory, index, item, options.overwrite, 'complete');
}

async function downloadPublicFile(item, outputDirectory, index, overwrite, endpoint, label) {
  if (!item.fileId) throw new Error(`Missing fileId for wtId=${item.wtId || 'unknown'}`);

  const url = `${API_BASE}common/file/${endpoint}/${item.fileId}`;
  return downloadFromUrl(url, outputDirectory, index, item, overwrite, label);
}

async function downloadFromUrl(url, outputDirectory, index, item, overwrite, label) {
  const response = await fetch(url, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8',
      referer: REFERER,
      'user-agent': userAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${label} ${item.wtId || item.fileId}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = detectExtension(buffer, response.headers.get('content-type'));
  const filename = `${String(index).padStart(4, '0')}_${label}_${item.wtId}_${item.fileId}.${extension}`;
  const filePath = path.join(outputDirectory, filename);

  if (!overwrite && await exists(filePath)) {
    return { url, filePath, filename, skipped: true, bytes: buffer.length };
  }

  await fs.writeFile(filePath, buffer);
  return { url, filePath, filename, skipped: false, bytes: buffer.length };
}

function detectExtension(buffer, contentType) {
  if (buffer.length >= 12 && buffer.subarray(4, 12).toString('ascii') === 'ftypisom') {
    return 'mp4';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
    return 'gif';
  }
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (contentType?.includes('mp4')) return 'mp4';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg';
  return 'bin';
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function userAgent() {
  return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/149 Safari/537.36';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function summarizeItem(item) {
  return {
    wtId: item.wtId,
    fileId: item.fileId,
    type: item.type,
    width: item.rw,
    height: item.rh,
    fileMb: item.fileMb,
    labels: item.labelList || [],
    downCount: item.downCount,
    favorCount: item.favorCount,
    createTime: item.createTime,
    sourceUrl: `${SITE_URL}homeView`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDirectory = path.resolve(process.cwd(), options.out);
  const entries = [];

  if (!options.dryRun) {
    await fs.mkdir(outputDirectory, { recursive: true });
  }

  console.log(`Start crawling HaoWallpaper assets: asset=${options.asset}, limit=${options.limit}, startPage=${options.startPage}, rows=${options.rows}`);
  if (options.asset === 'complete' && !options.token && !options.dryRun) {
    console.log('Complete/original mode requires HAOWALLPAPER_TOKEN or --token. Use --asset preview for public detail previews.');
  }
  if (options.dryRun) console.log('Dry run enabled: assets will not be downloaded.');

  let page = options.startPage;
  while (entries.length < options.limit) {
    const rows = Math.min(options.rows, options.limit - entries.length);
    const pageData = await fetchWallpaperPage(options, page, rows);
    const list = Array.isArray(pageData.list) ? pageData.list : [];

    if (list.length === 0) {
      console.log(`No items returned at page ${page}; stopping.`);
      break;
    }

    console.log(`Page ${page}: ${list.length} item(s), total=${pageData.total ?? 'unknown'}, pages=${pageData.pages ?? 'unknown'}`);

    for (const item of list) {
      if (entries.length >= options.limit) break;

      const index = entries.length + 1;
      const summary = summarizeItem(item);
      let download = null;
      let error = null;

      if (!options.dryRun) {
        try {
          download = await downloadAsset(item, outputDirectory, index, options);
          console.log(`${download.skipped ? 'Skip' : 'Save'} ${download.filename} (${download.bytes} bytes)`);
        } catch (downloadError) {
          error = downloadError.message;
          console.error(`Failed wtId=${item.wtId}: ${error}`);
        }
        if (options.delayMs > 0) await sleep(options.delayMs);
      } else {
        console.log(`Would download ${options.asset} wtId=${item.wtId}, fileId=${item.fileId}, ${item.rw}x${item.rh}`);
      }

      entries.push({ ...summary, assetMode: options.asset, asset: download, error });
    }

    if (pageData.pages && page >= pageData.pages) break;
    page += 1;
  }

  const manifest = {
    crawledAt: new Date().toISOString(),
    site: SITE_URL,
    apiBase: API_BASE,
    options,
    count: entries.length,
    entries,
  };

  if (!options.dryRun) {
    const manifestPath = path.join(outputDirectory, 'manifest.json');
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Manifest written: ${manifestPath}`);
  }

  console.log(`Done. Processed ${entries.length} item(s).`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
