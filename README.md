# zfbz

哲风壁纸下载工具，基于 Node.js 18+，无需 npm 依赖。

## Web 页面

```bash
npm start
```

打开 <http://127.0.0.1:4173>，先输入 Web 访问密码，再输入壁纸 ID。页面会先回显公开缩略图供确认，点击“开始下载”只下载原图；任务在服务端临时中转，完成后自动保存到浏览器下载目录，并清理服务器临时文件。代理由服务端的 `.env` / `.env.haowallpaper` 统一配置，前端不接收或保存代理地址和凭据。

当前 Resin Relay 配置示例：

```env
RELAY_BASE='https://resin.example.com/代理令牌/Default.zfbz'
RELAY_TRANSFER_MODE=auto
RELAY_TRANSFER_TIMEOUT=60
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

# 原图：自动读取 .env/.env.haowallpaper 中的代理池，不需要登录账号
scripts/run_haowallpaper_daily.sh \
  --id 17603706209226112 \
  --quality original \
  --out downloads/one-wallpaper
```

常用参数：

- `--quality original|preview|thumb`：原图、公开预览或缩略图。
- `--dry-run`：只查询并显示壁纸信息，不下载。
- `--relay-transfer-mode auto|relay|direct`：原图文件传输模式；默认 `auto` 使用 Cloudflare DoH 直连，失败后自动回退 Relay。
- `--relay-transfer-timeout <秒>`：每条原图传输路径的超时，默认 60 秒。
- 原图默认通过代理池完成匿名验证，不需要登录账号或账号凭证；可以使用 `--dm-proxy-api`、`--relay-base` 等匿名出口配置。

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

## 原图完整下载流程

原图模式只使用匿名会话和公开 PoW 验证，不读取或发送账号 Token。每张图的完整链路如下：

对应的流程图：

![原图完整下载流程](docs/assets/haowallpaper-original-download-flow.svg)

流程图源文件：[`docs/haowallpaper-original-download-flow.mmd`](docs/haowallpaper-original-download-flow.mmd)。

```text
流程 1/8 获取出口 IP       IP=x.x.x.x Relay=...
流程 2/8 建立匿名会话       会话=已建立 Relay=...
流程 3/8 获取 challenge     algorithm=...
流程 4/8 开始求解 PoW       maxnumber=...
流程 4/8 PoW 验证通过       number=...
流程 5/8 请求原图签名 URL   wtId=...
流程 5/8 拿到原图签名 URL   host=...
流程 6/8 传输原图文件       host=... via=direct attempt=1/1
流程 6/8 原图文件已接收     bytes=... via=direct
流程 7/8 保存原图文件       original_...jpg ...
流程 8/8 任务完成           bytes=...
```

流程图源文件：[`docs/haowallpaper-original-download-flow.mmd`](docs/haowallpaper-original-download-flow.mmd)。
