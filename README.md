# zfbz

哲风壁纸下载工具，基于 Node.js 18+，无需 npm 依赖。

## Web 页面

```bash
npm start
```

打开 <http://127.0.0.1:4173>，先输入 Web 访问密码，再输入壁纸 ID。页面会先回显公开缩略图供确认，点击“开始下载”只下载原图。代理由服务端的 `.env` / `.env.haowallpaper` 统一配置，前端不接收或保存代理地址和凭据。

当前 Resin Relay 配置示例：

```env
RELAY_BASE='https://resin.example.com/代理令牌/Default.zfbz'
ZFBZ_ACCESS_PASSWORD='请修改此访问密码'
```

## 按 ID 下载单张壁纸

详情页 URL 中的数字就是壁纸 `wtId`，例如 `https://haowallpaper.com/homeViewLook/17603706209226112`：

```bash
# 公开预览文件（图片或动态壁纸预览视频）
node scripts/haowallpaper_original_downloader.mjs \
  --id 17603706209226112 \
  --quality preview \
  --out downloads/one-wallpaper

# 原图：自动读取 .env/.env.haowallpaper 中的代理池，无需登录 token
scripts/run_haowallpaper_daily.sh \
  --id 17603706209226112 \
  --quality original \
  --out downloads/one-wallpaper
```

常用参数：

- `--quality original|preview|thumb`：原图、公开预览或缩略图。
- `--dry-run`：只查询并显示壁纸信息，不下载。
- 原图默认通过代理池完成匿名验证，不需要登录 token；也可以直接给下载器传 `--dm-proxy-api`、`--relay-base` 或 `--token`。

`run_haowallpaper_daily.sh --id ...` 会复用每日任务的代理配置。运行前请在 `.env` 或 `.env.haowallpaper` 中配置以下任意一种代理来源：

- `DM_PROXY_API`：大漠批量代理 API。
- `RELAY_BASE`：自建 URL 转发/Relay 代理。
- `PROXY_POOL_API`：本地代理池接口，例如 `http://127.0.0.1:5010/get/?type=https`。
- `BULK_PROXY_API`：其他一次返回多个代理的 API。

## 批量下载

```bash
node scripts/haowallpaper_original_downloader.mjs --quality preview --pages 1 --rows 12
```

更多代理、断点续跑和定时任务配置见 [`docs/haowallpaper-crawler.md`](docs/haowallpaper-crawler.md)。
