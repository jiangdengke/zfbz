## 2026-06-20 - Task: Crawl HaoWallpaper public previews
### What was done
- Used jshook MCP to inspect HaoWallpaper runtime requests and confirm the public list endpoint, AES request format, and preview image endpoint.
- Added a dependency-free Node.js crawler that downloads publicly accessible cropped/preview wallpaper images with explicit limits and delays.
- Added usage documentation and produced a two-image smoke-test download with a manifest.

### Testing
- `node --check "scripts/haowallpaper-crawler.mjs"` -> passed.
- `node "scripts/haowallpaper-crawler.mjs" --dry-run --limit 2 --rows 2 --delay-ms 0` -> fetched and decoded two list items without downloading.
- `node "scripts/haowallpaper-crawler.mjs" --limit 2 --rows 2 --delay-ms 0 --out "downloads/haowallpaper-smoke"` -> downloaded two public preview images and wrote `manifest.json`.

### Notes
- This historical crawler was later superseded by `scripts/haowallpaper_original_downloader.mjs`.
- Rollback: remove the historical crawler artifacts if they are still present in a branch that predates the unified downloader.

## 2026-06-20 - Task: Remove account-token mode
### What was done
- Removed account-token configuration and the `--token` CLI branch from `scripts/haowallpaper_original_downloader.mjs`.
- Original downloads now always use the anonymous session plus public PoW verification path; temporary `askId`/`ack` session values remain because they are part of the site's anonymous protocol.
- Removed the obsolete token-only `scripts/haowallpaper-crawler.mjs` entry point so the repository has one canonical downloader path.
- Updated `README.md` and `docs/haowallpaper-crawler.md` to document anonymous-only operation.

### Testing
- `node --check scripts/haowallpaper_original_downloader.mjs` -> passed.
- `node --check web/server.mjs` -> passed.
- `bash -n scripts/run_haowallpaper_daily.sh` -> passed.
- `node scripts/haowallpaper_original_downloader.mjs --help` -> no `--token` or `HAOWALLPAPER_TOKEN` option remains.
- Passing `--token` now exits with `未知参数: --token`.
- Anonymous original dry run for `17603706209226112` fetched and decrypted wallpaper metadata successfully.
