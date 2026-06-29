# HaoWallpaper asset crawler

This crawler reads wallpaper metadata from <https://haowallpaper.com/> and can download one of three asset modes:

- `complete`: original/full-size assets from `common/file/getCompleteUrl/{wtId}`. This is the default mode and requires a valid account token.
- `preview`: public detail-page preview assets from `common/file/previewFileImg/{fileId}`.
- `crop`: public list cropped thumbnails from `common/file/getCroppingImg/{fileId}`. This is only kept as an explicit fallback and is not the default.

jshook inspection confirmed that clicking the detail-page download button calls `getCompleteUrl/{wtId}`. Unauthenticated requests return `{"status":305,"msg":"[错误的请求 -> 3004]","type":2,"data":null}` or `401`, so the script does not bypass login or permission checks.

## Requirements

- Node.js 18 or newer.
- No npm dependencies are required.

## Usage

```bash
HAOWALLPAPER_TOKEN=... node scripts/haowallpaper-crawler.mjs --limit 10
```

Useful options:

```bash
node scripts/haowallpaper-crawler.mjs --dry-run --limit 5
node scripts/haowallpaper-crawler.mjs --asset preview --limit 10
node scripts/haowallpaper-crawler.mjs --asset crop --limit 10
node scripts/haowallpaper-crawler.mjs --limit 50 --out downloads/original-wallpapers --delay-ms 1200
node scripts/haowallpaper-crawler.mjs --start-page 2 --limit 20
```

The default output directory is `downloads/haowallpaper`. Each run writes a `manifest.json` with source IDs, labels, dimensions, asset mode, and saved file names.

## Safety limits

- The default limit is 20 images.
- Limits above 200 require `--yes` to avoid accidental bulk crawling.
- The default delay between image downloads is 800 ms.

## Notes

- Original/full-size downloads use `common/file/getCompleteUrl/{wtId}` and require an authenticated token from your own account session.
- Detail-page previews use `common/file/previewFileImg/{fileId}`. Static previews may still be smaller than original files; dynamic previews may be MP4 preview clips.
- List thumbnails use `common/file/getCroppingImg/{fileId}` and are not used unless `--asset crop` is specified.
- Some endpoints may declare `image/jpeg` while returning WebP bytes after transfer decompression; the script detects the file extension from magic bytes.
- Respect the site's terms and copyright restrictions when using downloaded images.
