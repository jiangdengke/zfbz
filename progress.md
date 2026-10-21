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

## 2026-10-21 - Task: Speed up the web batch download path
### What was done
- Added `--ids` to the downloader so one process handles a whole ID batch and shares the anonymous session, PoW verification and Relay egress across it, with `--concurrency` controlling how many wallpapers are in flight.
- Rewrote the web workbench's batch job to spawn that single process instead of one `run_haowallpaper_daily.sh` child per wallpaper; the server now passes `.env` straight through, dropping the bash wrapper and its python env parse from the hot path.
- Split the ALTCHA brute force into slices that yield to the event loop, so several workers no longer serialize on one blocking SHA-256 loop.
- Labelled every JSON log line with its `wtId` and emitted one `zfbzResult` line per wallpaper, so the workbench groups logs and reports per-ID success/failure in a concurrent batch.
- Added same-route transfer retries for transient 5xx/timeouts and a system-DNS fallback when the DoH resolver fails; the web path now uses a 35s transfer timeout instead of 60s.

### Testing
- `node --check web/server.mjs` / `node --check scripts/haowallpaper_original_downloader.mjs` -> passed locally and on the Oracle host.
- `--ids` argument validation: non-numeric ID and `--id` + `--ids` together both rejected with a clear message.
- Local workbench smoke test (4 IDs, concurrency 4): job completed, per-wallpaper log grouping and `results[]` populated correctly.
- Oracle benchmark, 12 real wallpapers, original quality:
  - old path (one process per wallpaper, 9.44s/张 measured): ~113s
  - `--ids` + `--concurrency 1`: 4 张 20.5s
  - `--ids` + `--concurrency 4`: 4 张 8.8s; 12 张 27.1s (12/12, 1 retry)
  - `--ids` + `--concurrency 6`: 12 张 32.3s (12/12) — no gain over 4, so 4 stays the default.

### Notes
- `scripts/haowallpaper_original_downloader.mjs`: `--ids` batch entry, async PoW, `wtId` log labelling, result events, same-route transfer retry, DoH fallback.
- `web/server.mjs`: single-process batch job, `DOWNLOAD_CONCURRENCY` (`ZFBZ_DOWNLOAD_CONCURRENCY`, default 4), per-ID result aggregation.
- `docs/haowallpaper-crawler.md`: documented `--ids` usage and the fixed-overhead breakdown.
- `docs/haowallpaper_server_deploy.md`: documented the concurrency setting.
- Rollback: `git revert <this commit>` and `sudo systemctl restart zfbz`; the old per-wallpaper loop is the parent commit `a19d05a`.
