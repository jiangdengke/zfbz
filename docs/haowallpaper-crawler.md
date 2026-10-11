# HaoWallpaper 无账号下载器

项目统一使用 `scripts/haowallpaper_original_downloader.mjs`，不再支持账号凭证分支。原图下载会创建匿名会话，完成公开 PoW 验证，再调用 `common/file/getCompleteUrl/{wtId}` 获取一次性原图链接。

## 要求

- Node.js 18 或更高版本。
- 不需要 npm 依赖。
- 原图模式需要至少配置一种匿名出口：`RELAY_BASE`、`DM_PROXY_API`、`PROXY_POOL_API` 或其他代理来源。

## 按壁纸 ID 下载

壁纸详情页 URL 中的数字就是 `wtId`，例如 `/homeViewLook/17603706209226112`：

```bash
# 原图：读取 .env/.env.haowallpaper 中的匿名代理配置
scripts/run_haowallpaper_daily.sh \
  --id 17603706209226112 \
  --quality original \
  --out downloads/one-wallpaper

# 公开预览文件
node scripts/haowallpaper_original_downloader.mjs \
  --id 17603706209226112 \
  --quality preview \
  --out downloads/one-wallpaper

# 公开缩略图
node scripts/haowallpaper_original_downloader.mjs \
  --id 17603706209226112 \
  --quality thumb \
  --out downloads/one-wallpaper
```

`--id` 只处理一张壁纸。重复执行时，如果目标文件已经存在会自动跳过；`--dry-run` 只查询并显示壁纸信息，不保存文件。

## 批量下载

```bash
# 原图：匿名 PoW 验证
node scripts/haowallpaper_original_downloader.mjs \
  --quality original \
  --pages 1 \
  --rows 12 \
  --relay-base "$RELAY_BASE"

# 预览图，不需要原图签名验证
node scripts/haowallpaper_original_downloader.mjs \
  --quality preview \
  --pages 1 \
  --rows 12
```

常用参数：

- `--quality original|preview|thumb`：原图、公开预览或缩略图。
- `--relay-base <url>`：通过 Relay 完成匿名会话、PoW 验证和原图传输。
- `--dm-proxy-api <url>`：从代理 API 获取匿名出口。
- `--proxy-api <url>`：使用本地代理池。
- `--start <n>`、`--pages <n>`、`--rows <n>`：控制列表页范围。
- `--daily-limit <n>`、`--state-file <file>`、`--resume`：限制新增数量并支持断点续跑。
- `--dry-run`：只解析列表，不下载文件。

`run_haowallpaper_daily.sh --id ...` 会加载 `.env` 与 `.env.haowallpaper`，并把配置的匿名出口传给统一下载器。Web 服务也复用同一条匿名原图链路。

## 下载链路

```text
壁纸 wtId
  ↓
匿名会话（askId / server_session_*）
  ↓
公开 challenge → 本地 PoW 求解 → verify
  ↓
common/file/getCompleteUrl/{wtId}
  ↓
一次性签名原图 URL
  ↓
通过同一匿名出口下载原图
```

匿名会话内部的 `askId`、`ack` 和 `server_session_*` 是站点公开验证协议的临时会话值，不是账号凭据，也不是可配置的账号密钥。

## 说明

- `fileId` 用于公开预览和缩略图；原图签名接口使用 `wtId`。
- 原图下载不读取、不接受、不发送账号凭据。
- 动态壁纸可能返回 MP4；下载器会根据文件头和响应类型确定扩展名。
- `scripts/run_haowallpaper_daily.sh` 负责加载代理配置、重试、断点续跑和定时任务参数。
