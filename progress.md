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
- `scripts/haowallpaper-crawler.mjs`: added the crawler script for encrypted list requests and public preview image downloads.
- `docs/haowallpaper-crawler.md`: documented requirements, usage, safety limits, and endpoint behavior.
- `downloads/haowallpaper-smoke/`: contains two smoke-test preview images and the generated manifest.
- `progress.md`: appended this implementation and verification record.
- Rollback: remove `scripts/haowallpaper-crawler.mjs`, `docs/haowallpaper-crawler.md`, and `downloads/haowallpaper-smoke/`; if this was the only progress entry, remove `progress.md`, otherwise remove this dated section.

## 2026-06-20 - Task: Correct HaoWallpaper crawler asset mode
### What was done
- Used jshook MCP on the wallpaper detail page to confirm the visible download button calls `common/file/getCompleteUrl/{wtId}`.
- Changed the crawler default from thumbnail download to `complete` original/full-size mode, which requires an authenticated account token.
- Kept public `preview` and `crop` modes as explicit options, with `crop` no longer used by default.
- Updated documentation to distinguish original/full-size assets, detail-page previews, and list thumbnails.

### Testing
- `node --check "scripts/haowallpaper-crawler.mjs"` -> passed.
- `node "scripts/haowallpaper-crawler.mjs" --limit 1 --rows 1 --delay-ms 0 --out "downloads/haowallpaper-complete-no-token"` -> failed early as expected because complete/original mode requires `HAOWALLPAPER_TOKEN` or `--token`.
- `node "scripts/haowallpaper-crawler.mjs" --asset preview --limit 2 --rows 2 --delay-ms 0 --out "downloads/haowallpaper-preview-smoke"` -> downloaded two public detail preview MP4 assets and wrote `manifest.json`.

### Notes
- `scripts/haowallpaper-crawler.mjs`: default asset mode is now `complete`; added `--asset`, `--token`, original-download guardrails, and MP4 extension detection.
- `docs/haowallpaper-crawler.md`: updated usage and endpoint notes to reflect original/full-size mode and token requirements.
- `downloads/haowallpaper-preview-smoke/`: contains two preview-mode smoke-test assets and the generated manifest.
- `progress.md`: appended this correction and verification record.
- Rollback: revert `scripts/haowallpaper-crawler.mjs` and `docs/haowallpaper-crawler.md` to the previous preview-only behavior, remove `downloads/haowallpaper-preview-smoke/`, and remove this dated progress section.
