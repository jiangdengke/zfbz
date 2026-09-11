# HaoWallpaper asset crawler

This crawler reads wallpaper metadata from <https://haowallpaper.com/> and can download one of three asset modes:

- `complete`: original/full-size assets from `common/file/getCompleteUrl/{wtId}`. This is the default mode and uses anonymous verification through the configured proxy pool; an account token is optional.
- `preview`: public detail-page preview assets from `common/file/previewFileImg/{fileId}`.
- `crop`: public list cropped thumbnails from `common/file/getCroppingImg/{fileId}`. This is only kept as an explicit fallback and is not the default.

jshook inspection confirmed that clicking the detail-page download button calls `getCompleteUrl/{wtId}`. The downloader completes the site's anonymous verification through the configured proxy pool; it does not bypass login or permission checks.

## Requirements

- Node.js 18 or newer.
- No npm dependencies are required.

## Usage

### Download one wallpaper by ID

壁纸详情页地址中的数字就是 `wtId`，例如 `/homeViewLook/17603706209226112`：

```bash
# 下载原图（自动读取 .env/.env.haowallpaper 中的代理池，无需 token）
scripts/run_haowallpaper_daily.sh \
  --id 17603706209226112 \
  --quality original \
  --out downloads/one-wallpaper

# 不需要登录即可下载公开预览文件
node scripts/haowallpaper_original_downloader.mjs \
  --id 17603706209226112 \
  --quality preview \
  --out downloads/one-wallpaper
```

`--id` 只处理这一张壁纸，文件名会包含壁纸 ID、分辨率和标签；重复执行时如果目标文件已存在会自动跳过。也可以使用 `--quality thumb` 下载公开缩略图，`--dry-run` 只查看壁纸信息不保存文件。

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

- Original/full-size downloads use `common/file/getCompleteUrl/{wtId}` and can use anonymous verification through `DM_PROXY_API` or `RELAY_BASE`; an authenticated token is optional.
- Detail-page previews use `common/file/previewFileImg/{fileId}`. Static previews may still be smaller than original files; dynamic previews may be MP4 preview clips.
- List thumbnails use `common/file/getCroppingImg/{fileId}` and are not used unless `--asset crop` is specified.
- Some endpoints may declare `image/jpeg` while returning WebP bytes after transfer decompression; the script detects the file extension from magic bytes.
- Respect the site's terms and copyright restrictions when using downloaded images.
