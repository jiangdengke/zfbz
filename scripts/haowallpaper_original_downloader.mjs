#!/usr/bin/env node
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const API = 'https://haowallpaper.com/link';
const REFERER = 'https://haowallpaper.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome Safari/537.36';
const KEY = Buffer.from('68zhehao2O776519', 'utf8');
const IV = Buffer.from('aa176b7519e84710', 'utf8');
const IMAGE_TYPES = new Set([1, 2]);
const VIDEO_TYPES = new Set([3, 5]);
const execFileAsync = promisify(execFile);

function usage() {
  console.log(`
Usage:
  node scripts/haowallpaper_original_downloader.mjs [options]

Options:
  --out <dir>          输出目录，默认 downloads/haowallpaper-original
  --start <n>          起始页，默认 1
  --pages <n>          下载页数，默认 1
  --rows <n>           每页数量，默认 12，建议 9~13
  --wp-type <csv>      类型：1=电脑静图,2=手机静图,3/4=电脑动态,5/6=手机动态；默认 1,2
  --kind <image|video|all>  过滤类型，默认 image
  --quality <original|preview|thumb>
                       original=原图；无 token 时自动完成公开 PoW 验证；preview=公开预览图；thumb=公开缩略图
                       默认 original
  --token <token>      登录 token；可选。没有 token 会走匿名验证流程
  --proxy-pool         使用 jhao104/proxy_pool 默认本地 API：127.0.0.1:5010
  --proxy-api <url>    获取代理 API，例如 http://127.0.0.1:5010/get/?type=https
                       也可用 /pop/?type=https，拿到后从池里弹出
  --delete-proxy-api <url>
                       删除代理 API 前缀，默认从 --proxy-api 推断为 http://host/delete/?proxy=
  --no-delete-proxy    不调用删除代理接口；适合使用公共 demo 池
  --proxy-file <file>  从文件轮换代理；每行一个 http://ip:port / socks5://ip:port / ip:port
  --proxy-range <range>
                       本地端口范围，例如 20001-20069，等价于 http://127.0.0.1:端口
  --zenproxy-api <url> 读取 ZenProxy 本地客户端 bindings，默认示例 http://127.0.0.1:9090
  --zenproxy-secret <s>
                       ZenProxy/sing-box Clash API 的 Bearer secret，可选
  --zenproxy-auto-bind 如果 /bindings 为空，自动 POST /bindings/batch {"all":true}
  --zenproxy-fetch    使用 ZenProxy 云端 /api/fetch 作为代理来源
  --zenproxy-fetch-api <url>
                       默认 https://zenproxy.top/api/fetch
  --zenproxy-key <key> ZenProxy 云端 API key，也可用环境变量 ZENPROXY_API_KEY
  --zenproxy-country <CC>
                       ZenProxy 国家筛选，例如 US/JP/HK，可选
  --proxylite-free    从 proxylite 免费列表抓代理
  --proxylite-pages <n>
                       proxylite 抓取页数，默认 3，每页 60
  --proxylite-url <url>
                       proxylite 列表 URL 模板，可包含 {page} {page_size}
  --free-proxy-sources <csv>
                       多源免费代理：proxylite,proxylistdownload,freeproxylist,sslproxies,socksproxy
  --proxyclean         从 HankNovic/ProxyClean 的 SOCKS5.txt 抓代理
  --proxyclean-url <url>
                       ProxyClean 原始直链；默认抓 SOCKS5.txt
  --bulk-proxy-api <url>
                       从批量代理 API 一次性拉取代理列表，支持 JSON/TXT
  --dm-proxy-api <url> 同 --bulk-proxy-api，适合大漠代理 dmgetip.asp
  --bulk-proxy-scheme <scheme>
                       批量 API 只返回 ip:port 时补的协议，默认 http；可选 http/https/socks5h
  --bulk-proxy-timeout <s>
                       批量 API 拉取超时秒数，默认 60
  --relay-base <url>   URL 转发/relay 代理基础地址，例如 https://resin.xxx/user/pool
  --resin-relay <url>  同 --relay-base；可直接传 .../https/api.ipify.org，会自动截成基础地址
  --proxy-retries <n>  每张图最多换代理次数，默认 12
  --proxy-timeout <s>  代理请求超时秒数，默认 25
  --keep-limited-proxy 遇到“访客今日下载次数上限”时不从 proxy_pool 删除该代理
  --sort <n>           排序，默认 3（推荐）
  --search <text>      搜索词，可选
  --list-retries <n>   壁纸列表接口失败重试次数，默认 5
  --delay <ms>         每个下载请求之间的延迟，默认 800
  --concurrency <n>    并发下载数，默认 1；例如 100
  --daily-limit <n>    本次最多新增下载多少张；达到后保存进度并退出
  --state-file <file>  进度文件；配合 --resume 每天自动接着跑
  --resume             从 --state-file 读取 nextPage 继续
  --dry-run            只解析列表，不下载

拿 token：登录 haowallpaper.com 后，在浏览器控制台执行：
  JSON.parse(decodeURIComponent(document.cookie.match(/(?:^|; )userData=([^;]+)/)?.[1] || '{}')).token

无 token 下载原图：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10

使用 proxy_pool 只代理“验证/拿签名”，图片本体直连下载：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10 --proxy-pool

使用 ZenProxy 本地客户端已绑定端口：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10 --zenproxy-api http://127.0.0.1:9090

使用 ZenProxy 云端 /api/fetch：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10 --zenproxy-fetch --zenproxy-key YOUR_KEY --zenproxy-country US

使用 proxylite 免费代理列表：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10 --proxylite-free --proxylite-pages 5 --proxy-retries 200

使用多源免费代理：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10 --free-proxy-sources all --proxy-retries 500

使用 ProxyClean SOCKS5 代理池：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10 --proxyclean --proxy-retries 500

使用大漠/其他批量代理 API：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10 --dm-proxy-api 'http://api.xxx/list?...' --proxy-retries 1000

使用 URL 转发/relay 代理：
  node scripts/haowallpaper_original_downloader.mjs --quality original --pages 10 --relay-base 'https://resin.xxx/user/pool'
`);
}

function parseArgs(argv) {
  const a = {
    out: 'downloads/haowallpaper-original',
    start: 1,
    pages: 1,
    rows: 12,
    wpType: '1,2',
    kind: 'image',
    quality: 'original',
    sort: 3,
    search: '',
    listRetries: Number(process.env.HAOWALLPAPER_LIST_RETRIES || 5),
    delay: 800,
    concurrency: 1,
    dailyLimit: Number(process.env.HAOWALLPAPER_DAILY_LIMIT || 0),
    stateFile: process.env.HAOWALLPAPER_STATE_FILE || '',
    resume: false,
    startSet: false,
    dryRun: false,
    token: process.env.HAOWALLPAPER_TOKEN || '',
    proxyPool: false,
    proxyApi: process.env.PROXY_POOL_API || '',
    deleteProxyApi: process.env.PROXY_POOL_DELETE_API || '',
    noDeleteProxy: false,
    proxyFile: process.env.PROXY_FILE || '',
    proxyRange: process.env.PROXY_RANGE || '',
    zenproxyApi: process.env.ZENPROXY_API || '',
    zenproxySecret: process.env.ZENPROXY_SECRET || '',
    zenproxyAutoBind: false,
    zenproxyFetch: false,
    zenproxyFetchApi: process.env.ZENPROXY_FETCH_API || 'https://zenproxy.top/api/fetch',
    zenproxyKey: process.env.ZENPROXY_API_KEY || '',
    zenproxyCountry: process.env.ZENPROXY_COUNTRY || '',
    proxyApiHeaders: {},
    proxyliteFree: false,
    proxylitePages: Number(process.env.PROXYLITE_PAGES || 3),
    proxyliteUrl: process.env.PROXYLITE_URL || 'https://www.proxylite.com/web_v1/free-proxy/list?page_size={page_size}&page={page}',
    freeProxySources: process.env.FREE_PROXY_SOURCES || '',
    proxyclean: false,
    proxycleanUrl: process.env.PROXYCLEAN_URL || [
      'https://raw.githubusercontent.com/HankNovic/ProxyClean/main/SOCKS5.txt',
      'https://cdn.jsdelivr.net/gh/HankNovic/ProxyClean@main/SOCKS5.txt',
      'https://fastly.jsdelivr.net/gh/HankNovic/ProxyClean@main/SOCKS5.txt',
    ].join(','),
    bulkProxyApi: process.env.BULK_PROXY_API || process.env.DM_PROXY_API || '',
    bulkProxyScheme: process.env.BULK_PROXY_SCHEME || 'http',
    bulkProxyTimeout: Number(process.env.BULK_PROXY_TIMEOUT || 60),
    relayBase: process.env.RELAY_BASE || process.env.RESIN_RELAY_BASE || '',
    proxyList: null,
    proxyListPromise: null,
    proxyCursor: 0,
    deadProxies: new Set(),
    proxyRetries: Number(process.env.PROXY_POOL_RETRIES || 12),
    proxyTimeout: Number(process.env.PROXY_POOL_TIMEOUT || 25),
    deleteLimitedProxy: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--help' || k === '-h') { usage(); process.exit(0); }
    if (k === '--dry-run') { a.dryRun = true; continue; }
    if (k === '--resume') { a.resume = true; continue; }
    if (k === '--proxy-pool') { a.proxyPool = true; continue; }
    if (k === '--keep-limited-proxy') { a.deleteLimitedProxy = false; continue; }
    if (k === '--no-delete-proxy') { a.noDeleteProxy = true; a.deleteProxyApi = ''; continue; }
    if (k === '--zenproxy-auto-bind') { a.zenproxyAutoBind = true; continue; }
    if (k === '--zenproxy-fetch') { a.zenproxyFetch = true; continue; }
    if (k === '--proxylite-free') { a.proxyliteFree = true; continue; }
    if (k === '--proxyclean') { a.proxyclean = true; continue; }
    if (k === '--token') { a.token = v; i++; continue; }
    if (k === '--out') { a.out = v; i++; continue; }
    if (k === '--start') { a.start = Number(v); a.startSet = true; i++; continue; }
    if (k === '--pages') { a.pages = Number(v); i++; continue; }
    if (k === '--rows') { a.rows = Number(v); i++; continue; }
    if (k === '--wp-type') { a.wpType = v; i++; continue; }
    if (k === '--kind') { a.kind = v; i++; continue; }
    if (k === '--quality') { a.quality = v; i++; continue; }
    if (k === '--sort') { a.sort = Number(v); i++; continue; }
    if (k === '--search') { a.search = v; i++; continue; }
    if (k === '--list-retries') { a.listRetries = Number(v); i++; continue; }
    if (k === '--delay') { a.delay = Number(v); i++; continue; }
    if (k === '--concurrency' || k === '-c') { a.concurrency = Number(v); i++; continue; }
    if (k === '--daily-limit' || k === '--max-new') { a.dailyLimit = Number(v); i++; continue; }
    if (k === '--state-file') { a.stateFile = v; i++; continue; }
    if (k === '--proxy-api') { a.proxyApi = v; i++; continue; }
    if (k === '--delete-proxy-api') { a.deleteProxyApi = v; i++; continue; }
    if (k === '--proxy-file') { a.proxyFile = v; i++; continue; }
    if (k === '--proxy-range') { a.proxyRange = v; i++; continue; }
    if (k === '--zenproxy-api') { a.zenproxyApi = v.replace(/\/+$/g, ''); i++; continue; }
    if (k === '--zenproxy-secret') { a.zenproxySecret = v; i++; continue; }
    if (k === '--zenproxy-fetch-api') { a.zenproxyFetchApi = v; i++; continue; }
    if (k === '--zenproxy-key' || k === '--zenproxy-api-key') { a.zenproxyKey = v; i++; continue; }
    if (k === '--zenproxy-country') { a.zenproxyCountry = v; i++; continue; }
    if (k === '--proxylite-pages') { a.proxylitePages = Number(v); i++; continue; }
    if (k === '--proxylite-url') { a.proxyliteUrl = v; i++; continue; }
    if (k === '--free-proxy-sources') { a.freeProxySources = v; i++; continue; }
    if (k === '--proxyclean-url') { a.proxycleanUrl = v; i++; continue; }
    if (k === '--bulk-proxy-api' || k === '--dm-proxy-api') { a.bulkProxyApi = v; i++; continue; }
    if (k === '--bulk-proxy-scheme' || k === '--dm-proxy-scheme') { a.bulkProxyScheme = v; i++; continue; }
    if (k === '--bulk-proxy-timeout' || k === '--dm-proxy-timeout') { a.bulkProxyTimeout = Number(v); i++; continue; }
    if (k === '--relay-base' || k === '--resin-relay') { a.relayBase = v; i++; continue; }
    if (k === '--proxy-retries') { a.proxyRetries = Number(v); i++; continue; }
    if (k === '--proxy-timeout') { a.proxyTimeout = Number(v); i++; continue; }
    throw new Error(`未知参数: ${k}`);
  }
  if (!['image', 'video', 'all'].includes(a.kind)) throw new Error('--kind 必须是 image/video/all');
  if (!['original', 'preview', 'thumb'].includes(a.quality)) throw new Error('--quality 必须是 original/preview/thumb');
  if (a.proxyPool && !a.proxyApi) a.proxyApi = 'http://127.0.0.1:5010/get/?type=https';
  if (a.zenproxyFetch) {
    if (!a.zenproxyKey && !String(a.zenproxyFetchApi).includes('api_key=')) {
      throw new Error('--zenproxy-fetch 需要 --zenproxy-key，或在 --zenproxy-fetch-api 里自己带 api_key=');
    }
    const u = new URL(a.zenproxyFetchApi);
    if (a.zenproxyCountry) u.searchParams.set('country', a.zenproxyCountry);
    a.proxyApi = String(u);
    a.noDeleteProxy = true;
    a.deleteProxyApi = '';
    if (a.zenproxyKey) a.proxyApiHeaders.Authorization = `Bearer ${a.zenproxyKey}`;
  }
  if (!a.zenproxyFetch && a.proxyApi && String(a.proxyApi).includes('zenproxy.top/api/fetch')) {
    a.noDeleteProxy = true;
    a.deleteProxyApi = '';
    if (a.zenproxyKey) a.proxyApiHeaders.Authorization = `Bearer ${a.zenproxyKey}`;
  }
  if (a.proxyApi && !a.deleteProxyApi && !a.noDeleteProxy) a.deleteProxyApi = inferDeleteProxyApi(a.proxyApi);
  if (!Number.isFinite(a.proxyRetries) || a.proxyRetries < 1) a.proxyRetries = 1;
  if (!Number.isFinite(a.proxyTimeout) || a.proxyTimeout < 3) a.proxyTimeout = 25;
  if (!Number.isFinite(a.listRetries) || a.listRetries < 1) a.listRetries = 1;
  if (!Number.isFinite(a.concurrency) || a.concurrency < 1) a.concurrency = 1;
  if (!Number.isFinite(a.dailyLimit) || a.dailyLimit < 0) a.dailyLimit = 0;
  a.concurrency = Math.floor(a.concurrency);
  a.dailyLimit = Math.floor(a.dailyLimit);
  if (a.relayBase) a.relayBase = normalizeRelayBase(a.relayBase);
  return a;
}

class ApiError extends Error {
  constructor(message, { httpStatus, apiStatus, apiMsg, data } = {}) {
    super(message);
    this.httpStatus = httpStatus;
    this.apiStatus = apiStatus;
    this.apiMsg = apiMsg;
    this.data = data;
  }
}

class ProxyError extends Error {
  constructor(message, { proxy, data } = {}) {
    super(message);
    this.proxy = proxy;
    this.data = data;
  }
}

function inferDeleteProxyApi(proxyApi) {
  try {
    const u = new URL(proxyApi);
    return `${u.origin}/delete/?proxy=`;
  } catch {
    return '';
  }
}

function normalizeRelayBase(relayBase) {
  let base = String(relayBase || '').trim();
  // 容错：如果 .env 里漏了结尾引号，可能把后面的注释/配置吞进来；这里只取第一条非注释内容。
  if (base.includes('\n') || base.includes('\r')) {
    const first = base
      .split(/\r?\n/)
      .map(s => s.trim())
      .find(s => s && !s.startsWith('#')) || '';
    base = first;
  }
  // URL 里不应该出现未编码空白；出现时通常也是配置后面混入了注释。
  base = base.split(/\s+/)[0].replace(/^['"]|['"]$/g, '').replace(/\/+$/g, '');
  // 允许直接粘贴测试 URL：.../https/api.ipify.org
  base = base.replace(/\/https\/api\.ipify\.org$/i, '');
  base = base.replace(/\/http\/api\.ipify\.org$/i, '');
  if (base && !/^https?:\/\//i.test(base)) {
    throw new ProxyError(`RELAY_BASE 格式错误，应以 http:// 或 https:// 开头，当前=${base}`);
  }
  return base;
}

function relayTargetUrl(args, targetUrl) {
  if (!args.relayBase) throw new ProxyError('未配置 --relay-base');
  const u = new URL(targetUrl);
  return `${normalizeRelayBase(args.relayBase)}/${u.protocol.replace(':', '')}/${u.host}${u.pathname}${u.search}`;
}

function hasProxySource(args) {
  return Boolean(args.proxyApi || args.proxyFile || args.proxyRange || args.zenproxyApi || args.proxyliteFree || args.freeProxySources || args.proxyclean || args.bulkProxyApi || args.relayBase);
}

function encryptText(text) {
  const cipher = createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

function decryptText(b64) {
  const decipher = createDecipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString('utf8').replace(/\0.*$/g, '');
}

async function sleep(ms) { if (ms > 0) await new Promise(r => setTimeout(r, ms)); }

function clock() {
  return new Date().toTimeString().slice(0, 8);
}

function oneLine(s, max = 220) {
  const v = String(s || '').replace(/\s+/g, ' ').trim();
  return v.length > max ? v.slice(0, max - 1) + '…' : v;
}

function fmtBytes(n) {
  n = Number(n || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

function logPretty(icon, title, message = '', { error = false } = {}) {
  const line = `[${clock()}] ${icon} ${title}${message ? ` ${message}` : ''}`;
  (error ? console.error : console.log)(line);
}

function parseApiEnvelope(text, label, httpStatus = 200) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new ApiError(`${label} 返回非 JSON: HTTP ${httpStatus} ${String(text).slice(0, 200)}`, { httpStatus, data: text }); }
  if (httpStatus < 200 || httpStatus >= 300 || (obj.status && Number(obj.status) !== 200)) {
    throw new ApiError(`${label} 失败: HTTP ${httpStatus}, status=${obj.status}, msg=${obj.msg || ''}`, {
      httpStatus,
      apiStatus: obj.status,
      apiMsg: obj.msg,
      data: obj.data,
    });
  }
  return obj.data;
}

function parseSetCookieLine(line) {
  const first = String(line || '').split(';', 1)[0];
  const idx = first.indexOf('=');
  if (idx <= 0) return null;
  return [first.slice(0, idx).trim(), first.slice(idx + 1).trim()];
}

function splitCombinedSetCookie(header) {
  if (!header) return [];
  // Node/fetch 有时会把多个 Set-Cookie 合并成一个字符串。
  return String(header).split(/,(?=\s*[^;,=\s]+=[^;,]*;)/g).map(s => s.trim()).filter(Boolean);
}

function absorbSetCookies(session, headers) {
  if (!session) return;
  const lines = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : splitCombinedSetCookie(headers.get('set-cookie'));
  for (const line of lines) {
    const kv = parseSetCookieLine(line);
    if (kv) session.cookies.set(kv[0], kv[1]);
  }
}

function cookieHeader(session) {
  if (!session?.cookies?.size) return '';
  return [...session.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function readJsonResponse(res, label) {
  const text = await res.text();
  return parseApiEnvelope(text, label, res.status);
}

async function apiGet(pathname, { query, token, session, method = 'GET', body, headers: extraHeaders } = {}) {
  const url = new URL(API + pathname);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const headers = { 'User-Agent': UA, Accept: 'application/json', Referer: REFERER, 'Cache-Control': 'no-cache' };
  if (token) headers.token = token;
  const cookies = cookieHeader(session);
  if (cookies) headers.Cookie = cookies;
  Object.assign(headers, extraHeaders || {});
  const res = await fetch(url, { method, headers, body });
  absorbSetCookies(session, res.headers);
  return readJsonResponse(res, pathname);
}

function splitCurlBodyAndStatus(stdout, label) {
  const marker = '\n__HTTP_STATUS__:';
  const idx = String(stdout).lastIndexOf(marker);
  if (idx < 0) throw new ProxyError(`${label} curl 输出缺少 HTTP 状态标记`);
  const text = stdout.slice(0, idx);
  const httpStatus = Number(stdout.slice(idx + marker.length).trim());
  if (!Number.isFinite(httpStatus)) throw new ProxyError(`${label} curl HTTP 状态解析失败`);
  return { text, httpStatus };
}

async function curlRequest(url, {
  label = url,
  proxy,
  cookieFile,
  token,
  method = 'GET',
  body,
  headers: extraHeaders,
  timeoutSec = 25,
  maxBuffer = 2 * 1024 * 1024,
} = {}) {
  const args = [
    '-sS',
    '-L',
    '--compressed',
    '--max-time', String(timeoutSec),
    '-A', UA,
    '-H', 'Accept: application/json',
    '-H', `Referer: ${REFERER}`,
    '-w', '\n__HTTP_STATUS__:%{http_code}',
    '-o', '-',
  ];
  if (proxy?.curl) args.push('--proxy', proxy.curl);
  if (cookieFile) args.push('-c', cookieFile, '-b', cookieFile);
  if (token) args.push('-H', `token: ${token}`);
  for (const [k, v] of Object.entries(extraHeaders || {})) args.push('-H', `${k}: ${v}`);
  if (method && method !== 'GET') args.push('-X', method);
  if (body !== undefined) args.push('--data-raw', String(body));
  args.push(url);

  try {
    const { stdout } = await execFileAsync('curl', args, {
      encoding: 'utf8',
      maxBuffer,
      timeout: (Number(timeoutSec) + 5) * 1000,
    });
    return splitCurlBodyAndStatus(stdout, label);
  } catch (e) {
    const msg = [
      `${label} curl 请求失败`,
      proxy?.deleteKey ? `proxy=${proxy.deleteKey}` : '',
      e.stderr ? String(e.stderr).trim().slice(0, 300) : e.message,
    ].filter(Boolean).join(': ');
    throw new ProxyError(msg, { proxy, data: e });
  }
}

async function curlApiGet(pathname, {
  query,
  token,
  proxySession,
  method = 'GET',
  body,
  headers: extraHeaders,
  timeoutSec,
} = {}) {
  const url = new URL(API + pathname);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const { text, httpStatus } = await curlRequest(String(url), {
    label: pathname,
    proxy: proxySession?.proxy,
    cookieFile: proxySession?.cookieFile,
    token,
    method,
    body,
    headers: extraHeaders,
    timeoutSec,
  });
  return parseApiEnvelope(text, pathname, httpStatus);
}

async function relayApiGet(pathname, args, {
  query,
  token,
  relaySession,
  method = 'GET',
  body,
  headers: extraHeaders,
  timeoutSec,
} = {}) {
  const url = new URL(API + pathname);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const { text, httpStatus } = await curlRequest(relayTargetUrl(args, String(url)), {
    label: pathname,
    cookieFile: relaySession?.cookieFile,
    token,
    method,
    body,
    headers: extraHeaders,
    timeoutSec,
  });
  return parseApiEnvelope(text, pathname, httpStatus);
}

function extractProxyFromPoolPayload(payload) {
  if (typeof payload === 'string') return payload.trim();
  if (Array.isArray(payload)) {
    const picked = payload.find(Boolean);
    return extractProxyFromPoolPayload(picked);
  }
  if (payload && typeof payload === 'object') {
    if (payload.proxy || payload.http || payload.https || payload.url) {
      return payload.proxy || payload.http || payload.https || payload.url;
    }
    const host = payload.server || payload.host || payload.hostname || payload.ip || payload.address;
    const port = payload.port || payload.server_port || payload.serverPort;
    if (host && port) {
      const type = String(payload.type || payload.protocol || payload.scheme || '').toLowerCase();
      if (type.includes('socks')) return `socks5h://${host}:${port}`;
      if (!type || type === 'http' || type === 'https') return `http://${host}:${port}`;
      throw new ProxyError(`ZenProxy /api/fetch 返回的是 ${type} 节点，curl 不能直接当代理用；请用 ZenProxy 本地绑定端口或 /api/relay`);
    }
    if (payload.data) return extractProxyFromPoolPayload(payload.data);
    if (payload.result) return extractProxyFromPoolPayload(payload.result);
    if (payload.node) return extractProxyFromPoolPayload(payload.node);
  }
  return '';
}

function normalizeProxy(raw) {
  let value = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!value) throw new ProxyError('没有返回可用代理');
  // ZenProxy UI 里可能显示 socks 类型；curl 更稳的写法是 socks5h://
  value = value.replace(/^socks:\/\//i, 'socks5h://');
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (scheme && !['http', 'https', 'socks4', 'socks4a', 'socks5', 'socks5h'].includes(scheme)) {
    throw new ProxyError(`代理协议 ${scheme} 不能被 curl 直接使用；请先用 ZenProxy 本地客户端绑定成 http://127.0.0.1:端口`);
  }
  const curl = scheme ? value : `http://${value}`;
  let deleteKey = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  deleteKey = deleteKey.replace(/\/.*$/g, '');
  return { raw: value, curl, deleteKey };
}

function parseProxyRange(range) {
  const m = String(range || '').trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) throw new ProxyError(`--proxy-range 格式错误，应为 20001-20069，当前: ${range}`);
  let start = Number(m[1]), end = Number(m[2]);
  if (start > end) [start, end] = [end, start];
  if (start < 1 || end > 65535) throw new ProxyError(`--proxy-range 端口超出范围: ${range}`);
  const out = [];
  for (let port = start; port <= end; port++) out.push(`http://127.0.0.1:${port}`);
  return out;
}

function extractZenProxyBindings(payload) {
  const candidates = [];
  const visit = (x) => {
    if (!x) return;
    if (Array.isArray(x)) { for (const it of x) visit(it); return; }
    if (typeof x !== 'object') return;

    const port = x.local_port ?? x.localPort ?? x.listen_port ?? x.listenPort ?? x.port;
    const enabled = x.enabled ?? x.active ?? x.status ?? x.valid ?? true;
    if (port && enabled !== false && enabled !== 'disabled' && enabled !== 'invalid') {
      const host = x.local_host || x.localHost || x.listen_host || x.listenHost || x.host || '127.0.0.1';
      candidates.push(`http://${host}:${port}`);
    }
    for (const key of ['data', 'bindings', 'items', 'list', 'proxies']) visit(x[key]);
  };
  visit(payload);
  return [...new Set(candidates)];
}

function isValidPublicIp(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

function proxyliteProtocolToProxy(item) {
  const ip = item?.ip;
  const port = Number(item?.port);
  if (!isValidPublicIp(ip) || !Number.isInteger(port) || port < 1 || port > 65535) return '';
  // Proxylite 的 protocol 是数字枚举，公开列表里 2/4/8 较常见。
  // curl 这里优先按 HTTP 代理尝试，因为 HTTPS 站点需要的是 HTTP CONNECT 隧道。
  return `http://${ip}:${port}`;
}

function extractIpPorts(text) {
  const out = [];
  const re = /\b((?:\d{1,3}\.){3}\d{1,3})\s*:\s*(\d{1,5})\b/g;
  for (const m of text.matchAll(re)) {
    const ip = m[1];
    const port = Number(m[2]);
    if (isValidPublicIp(ip) && Number.isInteger(port) && port > 0 && port <= 65535) out.push(`${ip}:${port}`);
  }
  return [...new Set(out)];
}

function normalizeBulkScheme(s) {
  const v = String(s || 'http').trim().toLowerCase();
  if (v === 'socks5') return 'socks5h';
  if (['http', 'https', 'socks4', 'socks4a', 'socks5h'].includes(v)) return v;
  if (v === 'auto') return 'http';
  throw new ProxyError(`--bulk-proxy-scheme 不支持: ${s}`);
}

function applyBulkProxyScheme(value, defaultScheme = 'http') {
  let v = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (!v) return '';
  v = v.replace(/^socks:\/\//i, 'socks5h://');
  v = v.replace(/^socks5:\/\//i, 'socks5h://');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  return `${normalizeBulkScheme(defaultScheme)}://${v}`;
}

function collectBulkProxyCandidates(x, out = []) {
  if (!x) return out;

  if (typeof x === 'string') {
    const text = x;
    const re = /\b(?:(https?|socks5h?|socks4a?):\/\/)?((?:\d{1,3}\.){3}\d{1,3})\s*:\s*(\d{1,5})\b/gi;
    for (const m of text.matchAll(re)) {
      const scheme = m[1] ? m[1].toLowerCase().replace(/^socks5$/, 'socks5h') : '';
      const ip = m[2];
      const port = Number(m[3]);
      if (isValidPublicIp(ip) && Number.isInteger(port) && port > 0 && port <= 65535) {
        out.push(scheme ? `${scheme}://${ip}:${port}` : `${ip}:${port}`);
      }
    }
    return out;
  }

  if (Array.isArray(x)) {
    for (const it of x) collectBulkProxyCandidates(it, out);
    return out;
  }

  if (typeof x === 'object') {
    const host = x.ip || x.host || x.hostname || x.server || x.address;
    const port = x.port || x.proxy_port || x.proxyPort || x.server_port || x.serverPort;
    if (host && port) {
      const p = Number(port);
      if (isValidPublicIp(host) && Number.isInteger(p) && p > 0 && p <= 65535) {
        const proto = String(x.protocol || x.type || x.scheme || '').toLowerCase();
        if (proto.includes('socks')) out.push(`socks5h://${host}:${p}`);
        else out.push(`${host}:${p}`);
      }
    }
    for (const v of Object.values(x)) {
      if (v && (typeof v === 'object' || typeof v === 'string')) collectBulkProxyCandidates(v, out);
    }
  }
  return out;
}

async function fetchTextMaybe(url, label, { method = 'GET', body, headers = {}, timeoutSec = 20 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/json,text/plain,*/*',
        ...headers,
      },
    });
    const text = await res.text();
    if (!res.ok) throw new ProxyError(`${label} 失败: HTTP ${res.status} ${text.slice(0, 160)}`);
    return text;
  } catch (e) {
    // Node fetch 访问 GitHub raw 等地址偶尔会 Abort；GET 请求用 curl 再兜底一次。
    if (method === 'GET') {
      try {
        const curlArgs = [
          '-L',
          '-sS',
          '--max-time', String(timeoutSec),
          '-A', UA,
          '-H', 'Accept: text/html,application/json,text/plain,*/*',
        ];
        for (const [k, v] of Object.entries(headers || {})) curlArgs.push('-H', `${k}: ${v}`);
        curlArgs.push(url);
        const { stdout } = await execFileAsync('curl', curlArgs, {
          encoding: 'utf8',
          maxBuffer: 20 * 1024 * 1024,
          timeout: (Number(timeoutSec) + 5) * 1000,
        });
        return stdout;
      } catch (ce) {
        throw new ProxyError(`${label} 拉取失败: ${e.message}; curl fallback: ${ce.stderr ? String(ce.stderr).trim() : ce.message}`);
      }
    }
    throw new ProxyError(`${label} 拉取失败: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProxyliteFreeProxies(args) {
  const pageSize = 60;
  const pages = Math.max(1, Math.min(50, Number(args.proxylitePages || 3)));
  const out = [];

  for (let page = 1; page <= pages; page++) {
    const url = String(args.proxyliteUrl)
      .replace(/\{page_size\}/g, String(pageSize))
      .replace(/\{page\}/g, String(page));
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/plain,*/*',
        Referer: 'https://www.proxylite.com/',
      },
    });
    const text = await res.text();
    if (!res.ok) throw new ProxyError(`proxylite 免费代理列表失败: HTTP ${res.status} ${text.slice(0, 200)}`);
    let payload;
    try { payload = JSON.parse(text); } catch { throw new ProxyError(`proxylite 返回非 JSON: ${text.slice(0, 200)}`); }

    const list = payload?.data?.list || payload?.list || [];
    for (const item of list) {
      const proxy = proxyliteProtocolToProxy(item);
      if (proxy) out.push(proxy);
    }
  }

  const unique = [...new Set(out)];
  if (!unique.length) throw new ProxyError('proxylite 免费列表没有解析到可用代理');
  logPretty('🌐', '代理', `proxylite 候选=${unique.length} 页数=${pages}`);
  return unique;
}

async function fetchProxyListDownload() {
  const types = ['https', 'http', 'socks5', 'socks4'];
  const out = [];
  for (const type of types) {
    try {
      const text = await fetchTextMaybe(`https://www.proxy-list.download/api/v1/get?type=${type}`, `proxy-list.download ${type}`, { timeoutSec: 15 });
      const scheme = type.startsWith('socks') ? `${type}h` : 'http';
      out.push(...extractIpPorts(text).map(p => `${scheme}://${p}`));
      logPretty('🌐', '代理', `proxy-list.download ${type} 候选=${extractIpPorts(text).length}`);
    } catch (e) {
      logPretty('⚠️', '代理源跳过', `proxy-list.download ${type} 原因=${oneLine(e.message)}`, { error: true });
    }
  }
  return [...new Set(out)];
}

async function fetchFreeProxyTable(url, label, scheme = 'http') {
  try {
    const text = await fetchTextMaybe(url, label, { timeoutSec: 25 });
    const items = extractIpPorts(text).map(p => `${scheme}://${p}`);
    logPretty('🌐', '代理', `${label} 候选=${items.length}`);
    return items;
  } catch (e) {
    logPretty('⚠️', '代理源跳过', `${label} 原因=${oneLine(e.message)}`, { error: true });
    return [];
  }
}

async function fetchFreeProxySources(args) {
  const wantedRaw = String(args.freeProxySources || '').trim().toLowerCase();
  if (!wantedRaw) return [];
  const wanted = wantedRaw === 'all'
    ? new Set(['proxylite', 'proxylistdownload', 'freeproxylist', 'sslproxies', 'socksproxy'])
    : new Set(wantedRaw.split(',').map(s => s.trim()).filter(Boolean));

  const out = [];
  if (wanted.has('proxylite')) out.push(...await fetchProxyliteFreeProxies(args).catch(e => {
    logPretty('⚠️', '代理源跳过', `proxylite 原因=${oneLine(e.message)}`, { error: true });
    return [];
  }));
  if (wanted.has('proxylistdownload') || wanted.has('proxy-list-download')) out.push(...await fetchProxyListDownload());
  if (wanted.has('freeproxylist') || wanted.has('free-proxy-list')) out.push(...await fetchFreeProxyTable('https://free-proxy-list.net/', 'free-proxy-list.net', 'http'));
  if (wanted.has('sslproxies') || wanted.has('ssl')) out.push(...await fetchFreeProxyTable('https://www.sslproxies.org/', 'sslproxies.org', 'http'));
  if (wanted.has('socksproxy') || wanted.has('socks-proxy')) out.push(...await fetchFreeProxyTable('https://www.socks-proxy.net/', 'socks-proxy.net', 'socks5h'));

  const unique = [...new Set(out)];
  if (!unique.length) throw new ProxyError(`多源免费代理没有抓到候选代理: ${args.freeProxySources}`);
  logPretty('🌐', '代理', `免费源总候选=${unique.length}`);
  return unique;
}

async function fetchProxyCleanProxies(args) {
  const urls = String(args.proxycleanUrl || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const items = [];
  for (const url of urls) {
    try {
      const text = await fetchTextMaybe(url, `ProxyClean SOCKS5.txt ${url}`, { timeoutSec: 25 });
      const parsed = extractIpPorts(text).map(p => `socks5h://${p}`);
      logPretty('🌐', '代理', `ProxyClean 候选=${parsed.length} 来源=${url}`);
      items.push(...parsed);
    } catch (e) {
      logPretty('⚠️', '代理源跳过', `ProxyClean 原因=${oneLine(e.message)}`, { error: true });
    }
  }
  const unique = [...new Set(items)];
  if (!unique.length) throw new ProxyError('ProxyClean 没有解析到 SOCKS5 代理');
  logPretty('🌐', '代理', `ProxyClean SOCKS5 候选=${unique.length}`);
  return unique;
}

async function fetchBulkProxyApiProxies(args) {
  const url = String(args.bulkProxyApi || '').trim();
  if (!url) return [];
  const text = await fetchTextMaybe(url, 'bulk proxy api', {
    timeoutSec: Math.max(10, Number(args.bulkProxyTimeout || 60)),
    headers: { Accept: 'application/json,text/plain,*/*' },
  });

  let payload = text;
  try { payload = JSON.parse(text); } catch {}

  const raw = collectBulkProxyCandidates(payload);
  const scheme = normalizeBulkScheme(args.bulkProxyScheme || 'http');
  const unique = [...new Set(raw.map(x => applyBulkProxyScheme(x, scheme)).filter(Boolean))];
  if (!unique.length) throw new ProxyError('bulk proxy api 没有解析到代理；请确认返回里有 ip:port 或 ip/port 字段');
  logPretty('🌐', '代理', `批量 API 候选=${unique.length}`);
  return unique;
}

async function fetchZenProxyBindings(args) {
  const api = args.zenproxyApi.replace(/\/+$/g, '');
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  if (args.zenproxySecret) headers.Authorization = `Bearer ${args.zenproxySecret}`;

  const load = async () => {
    const res = await fetch(`${api}/bindings`, { headers });
    const text = await res.text();
    if (!res.ok) throw new ProxyError(`ZenProxy /bindings 失败: HTTP ${res.status} ${text.slice(0, 200)}`);
    let payload;
    try { payload = JSON.parse(text); } catch { throw new ProxyError(`ZenProxy /bindings 返回非 JSON: ${text.slice(0, 200)}`); }
    return extractZenProxyBindings(payload);
  };

  let list = await load();
  if (!list.length && args.zenproxyAutoBind) {
    await fetch(`${api}/bindings/batch`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    await sleep(1000);
    list = await load();
  }
  if (!list.length) throw new ProxyError('ZenProxy 没有读取到本地绑定端口；请先在 ZenProxy 里启用/bind 代理，或加 --zenproxy-auto-bind');
  return list;
}

async function loadStaticProxyList(args) {
  if (args.proxyList) return args.proxyList;
  if (args.proxyListPromise) return args.proxyListPromise;

  args.proxyListPromise = (async () => {
  let list = [];

  if (args.proxyFile) {
    const txt = await readFile(args.proxyFile, 'utf8');
    list.push(...txt.split(/\r?\n/)
      .map(s => s.replace(/#.*$/g, '').trim())
      .filter(Boolean));
  }

  if (args.proxyRange) {
    list.push(...parseProxyRange(args.proxyRange));
  }

  if (args.zenproxyApi) {
    list.push(...await fetchZenProxyBindings(args));
  }

  if (args.proxyliteFree) {
    list.push(...await fetchProxyliteFreeProxies(args));
  }

  if (args.freeProxySources) {
    list.push(...await fetchFreeProxySources(args));
  }

  if (args.proxyclean) {
    list.push(...await fetchProxyCleanProxies(args));
  }

  if (args.bulkProxyApi) {
    list.push(...await fetchBulkProxyApiProxies(args));
  }

  list = [...new Set(list)];
  args.proxyList = list.map(normalizeProxy).map(p => ({ ...p, static: true }));
  if (args.proxyList.length) {
    logPretty('🌐', '代理', `已加载=${args.proxyList.length} 静态池`);
  }
  return args.proxyList;
  })();

  return args.proxyListPromise;
}

async function getProxyFromStaticList(args) {
  const list = await loadStaticProxyList(args);
  if (!list.length) throw new ProxyError('静态代理列表为空');
  const dead = args.deadProxies || new Set();
  for (let i = 0; i < list.length; i++) {
    const proxy = list[args.proxyCursor % list.length];
    args.proxyCursor++;
    if (!dead.has(proxy.deleteKey)) return proxy;
  }
  throw new ProxyError(`静态代理已全部失败或达到今日额度: ${dead.size}/${list.length}`);
}

function markStaticProxyDead(args, proxy, reason = '') {
  if (!proxy?.static) return;
  if (!args.deadProxies) args.deadProxies = new Set();
  args.deadProxies.add(proxy.deleteKey);
  logPretty('☠️', '拉黑', `代理=${proxy.deleteKey}${reason ? ` 原因=${reason}` : ''} 已拉黑=${args.deadProxies.size}/${args.proxyList?.length || '?'}`, { error: true });
}

async function getProxyFromApi(args) {
  const res = await fetch(args.proxyApi, { headers: { Accept: 'application/json,text/plain,*/*', 'User-Agent': UA, ...(args.proxyApiHeaders || {}) } });
  const text = (await res.text()).trim();
  if (!res.ok) throw new ProxyError(`代理 API 获取代理失败: HTTP ${res.status} ${text.slice(0, 200)}`);
  let payload = text;
  try { payload = JSON.parse(text); } catch {}
  const proxy = normalizeProxy(extractProxyFromPoolPayload(payload));
  return proxy;
}

async function getProxyFromPool(args) {
  if (args.proxyFile || args.proxyRange || args.zenproxyApi || args.proxyliteFree || args.freeProxySources || args.proxyclean || args.bulkProxyApi) return getProxyFromStaticList(args);
  return getProxyFromApi(args);
}

async function deleteProxyFromPool(args, proxy, reason = '') {
  if (!args.deleteProxyApi || !proxy?.deleteKey || proxy.static) return;
  const url = args.deleteProxyApi.includes('{proxy}')
    ? args.deleteProxyApi.replace('{proxy}', encodeURIComponent(proxy.deleteKey))
    : args.deleteProxyApi + encodeURIComponent(proxy.deleteKey);
  try {
    await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' } });
    if (reason) logPretty('🗑️', '删除代理', `代理=${proxy.deleteKey} 原因=${oneLine(reason)}`);
  } catch (e) {
    logPretty('⚠️', '删除失败', `代理=${proxy.deleteKey} 原因=${oneLine(e.message)}`, { error: true });
  }
}

async function readNetscapeCookie(cookieFile, name) {
  let txt;
  try { txt = await readFile(cookieFile, 'utf8'); } catch { return ''; }
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith('# Netscape') || line.startsWith('# This file')) continue;
    const normalized = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line;
    const parts = normalized.split('\t');
    if (parts.length >= 7 && parts[5] === name) return parts.slice(6).join('\t');
  }
  return '';
}

async function cleanupProxySession(session) {
  if (session?.cookieDir) await rm(session.cookieDir, { recursive: true, force: true }).catch(() => {});
}

async function cleanupRelaySession(session) {
  if (session?.cookieDir) await rm(session.cookieDir, { recursive: true, force: true }).catch(() => {});
}

async function dropRelaySession(args, reason = '') {
  const session = args.relaySession;
  args.relaySession = null;
  if (!session) return;
  await cleanupRelaySession(session);
  if (reason) logPretty('🔌', 'Relay', `关闭会话 ${reason}`);
}

async function dropProxySession(args, reason = '', { del = true } = {}) {
  const session = args.proxySession;
  args.proxySession = null;
  if (!session) return;
  if (del) await deleteProxyFromPool(args, session.proxy, reason);
  await cleanupProxySession(session);
}

async function createProxyAnonymousSession(args) {
  const proxy = await getProxyFromPool(args);
  const cookieDir = await mkdtemp(path.join(os.tmpdir(), 'haowallpaper-proxy-'));
  const cookieFile = path.join(cookieDir, 'cookies.txt');
  const session = { proxy, cookieDir, cookieFile, token: '', verified: false };
  try {
    logPretty('🌐', '代理', `使用=${proxy.deleteKey}`);
    const { text, httpStatus } = await curlRequest(REFERER, {
      label: 'init anonymous session',
      proxy,
      cookieFile,
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      timeoutSec: args.proxyTimeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (httpStatus < 200 || httpStatus >= 400) {
      throw new ProxyError(`代理访问首页失败: HTTP ${httpStatus} ${text.slice(0, 200)}`, { proxy });
    }
    const askId = await readNetscapeCookie(cookieFile, 'askId');
    if (!askId) throw new ProxyError('匿名代理会话初始化失败：没有拿到 askId cookie', { proxy });
    session.token = decodeURIComponent(askId);
    return session;
  } catch (e) {
    await cleanupProxySession(session);
    if (!proxy.static) await deleteProxyFromPool(args, proxy, e.message);
    throw e;
  }
}

async function ensureProxySession(args, force = false) {
  if (args.proxySession && !force) return args.proxySession;
  if (args.proxySession) await dropProxySession(args, 'rotate proxy', { del: false });
  args.proxySession = await createProxyAnonymousSession(args);
  return args.proxySession;
}

async function createRelayAnonymousSession(args) {
  const cookieDir = await mkdtemp(path.join(os.tmpdir(), 'haowallpaper-relay-'));
  const cookieFile = path.join(cookieDir, 'cookies.txt');
  const session = { cookieDir, cookieFile, token: '', verified: false };
  try {
    logPretty('🌉', 'Relay', `使用=${normalizeRelayBase(args.relayBase)}`);
    const { text, httpStatus } = await curlRequest(relayTargetUrl(args, REFERER), {
      label: 'relay init anonymous session',
      cookieFile,
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      timeoutSec: args.proxyTimeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (httpStatus < 200 || httpStatus >= 400) {
      throw new ProxyError(`Relay 访问首页失败: HTTP ${httpStatus} ${text.slice(0, 200)}`);
    }
    const askId = await readNetscapeCookie(cookieFile, 'askId');
    if (!askId) throw new ProxyError('Relay 匿名会话初始化失败：没有拿到 askId cookie');
    session.token = decodeURIComponent(askId);
    return session;
  } catch (e) {
    await cleanupRelaySession(session);
    throw e;
  }
}

async function ensureRelaySession(args, force = false) {
  if (args.relaySession && !force) return args.relaySession;
  if (args.relaySession) await dropRelaySession(args, 'rotate relay');
  args.relaySession = await createRelayAnonymousSession(args);
  return args.relaySession;
}

async function getWallpaperList({ page, rows, sort, wpType, search }) {
  const form = { page, rows, sortType: sort, isFavorites: false, wpType, lbId: '' };
  if (search) form.search = search;
  const data = encryptText(JSON.stringify(form));
  const encrypted = await apiGet('/pc/wallpaper/wallpaperList', { query: { data } });
  const plain = decryptText(encrypted);
  return JSON.parse(plain);
}

async function getWallpaperListWithRetry(params, args) {
  let lastError;
  const retries = Math.max(1, Number(args.listRetries || 1));
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await getWallpaperList(params);
    } catch (e) {
      lastError = e;
      const msg = String(e.message || e).replace(/\s+/g, ' ').slice(0, 180);
      if (attempt < retries) {
        logPretty('🔁', '列表重试', `第${params.page}页 ${attempt}/${retries} 原因=${msg}`, { error: true });
        await sleep(Math.min(1000 * attempt, 5000));
      }
    }
  }
  throw lastError;
}

function keepItem(item, kind) {
  if (kind === 'all') return true;
  if (kind === 'image') return IMAGE_TYPES.has(Number(item.type));
  if (kind === 'video') return VIDEO_TYPES.has(Number(item.type));
  return true;
}

function safeName(s, max = 90) {
  return String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'wallpaper';
}

function extFromContentType(ct, fallback) {
  ct = (ct || '').toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('mp4')) return '.mp4';
  return fallback || '.bin';
}

function extFromBuffer(buf, fallback) {
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))) return '.gif';
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return '.mp4';
  return fallback || '.bin';
}

async function existsNonEmpty(file) {
  try { return (await stat(file)).size > 0; } catch { return false; }
}

async function findExistingByBase(dir, base, kind) {
  const exts = kind === 'video'
    ? ['.mp4', '.mov', '.webm', '.bin']
    : ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bin'];
  for (const ext of exts) {
    const file = path.join(dir, base + ext);
    if (await existsNonEmpty(file)) return file;
  }
  return null;
}

async function findExistingByWtId(dir, quality, wtId, kind) {
  const exts = kind === 'video'
    ? ['.mp4', '.mov', '.webm', '.bin']
    : ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bin'];
  const prefix = `${quality}_${wtId}_`;
  try {
    const { readdir } = await import('node:fs/promises');
    const names = await readdir(dir);
    for (const name of names) {
      if (!name.startsWith(prefix)) continue;
      if (!exts.some(ext => name.toLowerCase().endsWith(ext))) continue;
      const file = path.join(dir, name);
      if (await existsNonEmpty(file)) return file;
    }
  } catch {}
  return null;
}

async function getCompleteUrl(wtId, token) {
  const data = await apiGet(`/common/file/getCompleteUrl/${encodeURIComponent(wtId)}`, { token });
  if (typeof data === 'string') return data;
  if (data?.url) return data.url;
  if (data?.completeUrl) return data.completeUrl;
  throw new Error(`getCompleteUrl 返回未知结构: ${JSON.stringify(data).slice(0, 200)}`);
}

async function getCompleteUrlWithSession(wtId, args) {
  if (args.token) return getCompleteUrl(wtId, args.token);
  if (args.relayBase) return getCompleteUrlAnonymousViaRelayWithRetry(wtId, args);
  if (hasProxySource(args)) return getCompleteUrlAnonymousViaProxyPool(wtId, args);
  await ensureAnonymousVerified(args);
  try {
    return await getCompleteUrlAnonymous(wtId, args);
  } catch (e) {
    // 3004 通常表示本匿名会话还未通过下载验证，重新验证一次再试。
    if (e instanceof ApiError && String(e.apiMsg || '').includes('3004')) {
      await ensureAnonymousVerified(args, true);
      return await getCompleteUrlAnonymous(wtId, args);
    }
    throw e;
  }
}

function unpackCompleteUrlData(data) {
  if (typeof data === 'string') return data;
  if (data?.url) return data.url;
  if (data?.completeUrl) return data.completeUrl;
  throw new Error(`getCompleteUrl 返回未知结构: ${JSON.stringify(data).slice(0, 200)}`);
}

async function getCompleteUrlAnonymous(wtId, args) {
  const data = await apiGet(`/common/file/getCompleteUrl/${encodeURIComponent(wtId)}`, {
    token: args.session.token,
    session: args.session,
  });
  return unpackCompleteUrlData(data);
}

async function getCompleteUrlAnonymousViaProxy(wtId, args) {
  const session = await ensureProxySession(args);
  const data = await curlApiGet(`/common/file/getCompleteUrl/${encodeURIComponent(wtId)}`, {
    token: session.token,
    proxySession: session,
    timeoutSec: args.proxyTimeout,
  });
  return unpackCompleteUrlData(data);
}

async function getRelayChallenge(args) {
  const session = await ensureRelaySession(args);
  const { text, httpStatus } = await curlRequest(relayTargetUrl(args, `${API}/pc/certify/challenge`), {
    label: 'relay anonymous challenge',
    cookieFile: session.cookieFile,
    timeoutSec: args.proxyTimeout,
  });
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new ProxyError(`获取 Relay 匿名下载验证 challenge 失败: HTTP ${httpStatus} ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProxyError(`Relay challenge 返回非 JSON: ${text.slice(0, 200)}`);
  }
}

async function ensureRelayAnonymousVerified(args, force = false) {
  const session = await ensureRelaySession(args);
  if (session.verified && !force) return;

  const challenge = await getRelayChallenge(args);
  const solved = solveAltchaChallenge(challenge);
  const payload = Buffer.from(JSON.stringify(solved.payloadObject)).toString('base64');

  await relayApiGet('/pc/certify/verify', args, {
    method: 'POST',
    token: session.token,
    relaySession: session,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
    timeoutSec: args.proxyTimeout,
  });
  session.verified = true;
  logPretty('🧩', '验证', `Relay PoW 通过 number=${solved.number}`);
}

async function getCompleteUrlAnonymousViaRelay(wtId, args) {
  const session = await ensureRelaySession(args);
  const data = await relayApiGet(`/common/file/getCompleteUrl/${encodeURIComponent(wtId)}`, args, {
    token: session.token,
    relaySession: session,
    timeoutSec: args.proxyTimeout,
  });
  return unpackCompleteUrlData(data);
}

async function getCompleteUrlAnonymousViaRelayWithRetry(wtId, args) {
  let lastError;
  const max = Math.max(1, Number(args.proxyRetries || 1));
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      await ensureRelayAnonymousVerified(args);
      return await getCompleteUrlAnonymousViaRelay(wtId, args);
    } catch (e) {
      if (isNeedVerifyError(e) && args.relaySession) {
        try {
          args.relaySession.verified = false;
          await ensureRelayAnonymousVerified(args, true);
          return await getCompleteUrlAnonymousViaRelay(wtId, args);
        } catch (e2) {
          e = e2;
        }
      }
      lastError = e;
      const limited = isVisitorLimitError(e);
      const msg = String(e.apiMsg || e.message || e).replace(/\s+/g, ' ').slice(0, 220);
      if (limited) logPretty('🚫', '限额', `Relay 今日额度用完 尝试=${attempt}/${max}`, { error: true });
      else logPretty('🔁', '重试', `Relay 尝试=${attempt}/${max} 原因=${msg}`, { error: true });

      await dropRelaySession(args, limited ? 'visitor limit' : msg);
      if (limited) throw e;
      await sleep(200);
    }
  }
  throw new Error(`Relay 尝试 ${max} 次后仍未拿到原图签名: ${lastError?.message || lastError}`);
}

function isVisitorLimitError(e) {
  const msg = String(e?.apiMsg || e?.message || '');
  return msg.includes('访客今日下载次数上限') || msg.includes('今日下载次数上限') || Number(e?.apiStatus) === 305;
}

function isNeedVerifyError(e) {
  const msg = String(e?.apiMsg || e?.message || '');
  return msg.includes('3004') || msg.includes('未通过') || msg.includes('验证');
}

async function getCompleteUrlAnonymousViaProxyPool(wtId, args) {
  let lastError;
  const max = Math.max(1, Number(args.proxyRetries || 1));
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      await ensureProxyAnonymousVerified(args);
      return await getCompleteUrlAnonymousViaProxy(wtId, args);
    } catch (e) {
      // 3004 通常是当前匿名会话验证状态失效；优先保留同一个代理重新验证一次。
      if (isNeedVerifyError(e) && args.proxySession) {
        try {
          args.proxySession.verified = false;
          await ensureProxyAnonymousVerified(args, true);
          return await getCompleteUrlAnonymousViaProxy(wtId, args);
        } catch (e2) {
          e = e2;
        }
      }
      lastError = e;

      if (isNeedVerifyError(e) && args.proxySession) {
        args.proxySession.verified = false;
      }

      const limited = isVisitorLimitError(e);
      const proxyName = args.proxySession?.proxy?.deleteKey || e.proxy?.deleteKey || 'unknown';
      const currentProxy = args.proxySession?.proxy || e.proxy;
      const msg = String(e.apiMsg || e.message || e).replace(/\s+/g, ' ').slice(0, 220);
      if (limited) logPretty('🚫', '限额', `代理=${proxyName} 今日额度用完 尝试=${attempt}/${max}`, { error: true });
      else logPretty('🔁', '重试', `代理=${proxyName} 尝试=${attempt}/${max} 原因=${msg}`, { error: true });

      if (limited) {
        markStaticProxyDead(args, currentProxy, 'visitor limit');
      } else if (currentProxy?.static && /timed out|Couldn't connect|CONNECT tunnel failed|Failed to connect/i.test(msg)) {
        markStaticProxyDead(args, currentProxy, 'connection failed');
      }

      await dropProxySession(args, limited ? 'visitor limit' : msg, {
        del: limited ? args.deleteLimitedProxy : true,
      });
      await sleep(200);
    }
  }
  throw new Error(`代理池尝试 ${max} 次后仍未拿到原图签名: ${lastError?.message || lastError}`);
}

async function initAnonymousSession(args) {
  if (args.session) return args.session;
  const session = { cookies: new Map(), token: '', verified: false };
  args.session = session;
  const res = await fetch(REFERER, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } });
  absorbSetCookies(session, res.headers);
  await res.arrayBuffer(); // 消费响应，保持 fetch 行为完整
  const askId = session.cookies.get('askId');
  if (!askId) throw new Error('匿名会话初始化失败：没有拿到 askId cookie');
  session.token = decodeURIComponent(askId);
  return session;
}

function solveAltchaChallenge(challenge) {
  const max = Number(challenge.maxnumber || 160000);
  const salt = Buffer.from(challenge.salt, 'utf8');
  const started = Date.now();
  for (let n = 0; n <= max; n++) {
    const digest = createHash('sha256').update(salt).update(String(n)).digest('hex');
    if (digest === challenge.challenge) {
      return {
        payloadObject: {
          algorithm: challenge.algorithm,
          challenge: challenge.challenge,
          number: n,
          salt: challenge.salt,
          signature: challenge.signature,
          took: Date.now() - started,
        },
        number: n,
      };
    }
  }
  throw new Error(`ALTCHA PoW 求解失败：0..${max} 未命中`);
}

async function ensureAnonymousVerified(args, force = false) {
  const session = await initAnonymousSession(args);
  if (session.verified && !force) return;

  const challengeUrl = `${API}/pc/certify/challenge`;
  const chRes = await fetch(challengeUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: REFERER,
      Cookie: cookieHeader(session),
    },
  });
  absorbSetCookies(session, chRes.headers);
  if (!chRes.ok) {
    const txt = await chRes.text();
    throw new Error(`获取匿名下载验证 challenge 失败: HTTP ${chRes.status} ${txt.slice(0, 200)}`);
  }
  const challenge = await chRes.json();
  const solved = solveAltchaChallenge(challenge);
  const payload = Buffer.from(JSON.stringify(solved.payloadObject)).toString('base64');

  await apiGet('/pc/certify/verify', {
    method: 'POST',
    token: session.token,
    session,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  session.verified = true;
  logPretty('🧩', '验证', `匿名 PoW 通过 number=${solved.number}`);
}

async function getProxyChallenge(args) {
  const session = await ensureProxySession(args);
  const { text, httpStatus } = await curlRequest(`${API}/pc/certify/challenge`, {
    label: 'proxy anonymous challenge',
    proxy: session.proxy,
    cookieFile: session.cookieFile,
    timeoutSec: args.proxyTimeout,
  });
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new ProxyError(`获取代理匿名下载验证 challenge 失败: HTTP ${httpStatus} ${text.slice(0, 200)}`, { proxy: session.proxy });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProxyError(`代理 challenge 返回非 JSON: ${text.slice(0, 200)}`, { proxy: session.proxy, data: text });
  }
}

async function ensureProxyAnonymousVerified(args, force = false) {
  const session = await ensureProxySession(args);
  if (session.verified && !force) return;

  const challenge = await getProxyChallenge(args);
  const solved = solveAltchaChallenge(challenge);
  const payload = Buffer.from(JSON.stringify(solved.payloadObject)).toString('base64');

  await curlApiGet('/pc/certify/verify', {
    method: 'POST',
    token: session.token,
    proxySession: session,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
    timeoutSec: args.proxyTimeout,
  });
  session.verified = true;
  logPretty('🧩', '验证', `代理=${session.proxy.deleteKey} PoW 通过 number=${solved.number}`);
}

async function downloadOne(item, args) {
  const label = safeName((item.labelList || []).filter(Boolean).slice(0, 5).join('_'));
  const base = safeName(`${args.quality}_${item.wtId}_${item.rw}x${item.rh}_${label}`);
  const fallbackExt = IMAGE_TYPES.has(Number(item.type)) ? '.png' : '.mp4';
  const existingKind = VIDEO_TYPES.has(Number(item.type)) ? 'video' : 'image';
  const maybeExisting = await findExistingByBase(args.out, base, existingKind)
    || await findExistingByWtId(args.out, args.quality, item.wtId, existingKind);
  if (maybeExisting) return { skipped: true, file: maybeExisting };

  let downloadUrl;
  if (args.quality === 'original') {
    downloadUrl = await getCompleteUrlWithSession(item.wtId, args);
  } else {
    const endpoint = args.quality === 'thumb'
      ? (VIDEO_TYPES.has(Number(item.type)) ? 'getVideoReduce' : 'getCroppingImg')
      : 'previewFileImg';
    downloadUrl = `${API}/common/file/${endpoint}/${encodeURIComponent(item.fileId)}`;
  }

  const res = await fetch(downloadUrl, { headers: { 'User-Agent': UA, Referer: REFERER } });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${downloadUrl}`);

  let urlExt = '';
  try { urlExt = path.extname(new URL(downloadUrl).pathname).split('?')[0]; } catch {}
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFromBuffer(buf, extFromContentType(res.headers.get('content-type'), urlExt || fallbackExt));
  const file = path.join(args.out, base + ext);
  await writeFile(file, buf);
  return { skipped: false, file, bytes: buf.length };
}

function makeWorkerArgs(root) {
  const worker = { ...root, session: null, proxySession: null, relaySession: null };
  for (const key of ['proxyList', 'proxyListPromise', 'proxyCursor', 'deadProxies']) {
    Object.defineProperty(worker, key, {
      get() { return root[key]; },
      set(v) { root[key] = v; },
      configurable: true,
    });
  }
  return worker;
}

function itemInfo(item) {
  return `${item.wtId} type=${item.type} ${item.rw}x${item.rh} ${item.fileMb} ${(item.labelList || []).slice(0, 4).join('/')}`;
}

async function loadRunState(args) {
  if (!args.resume || !args.stateFile) return null;
  try {
    const state = JSON.parse(await readFile(args.stateFile, 'utf8'));
    if (!args.startSet && Number(state.nextPage) > 0) {
      args.start = Number(state.nextPage);
      logPretty('🔁', '续跑', `从进度文件恢复：第${args.start}页`);
    }
    return state;
  } catch {
    logPretty('🆕', '续跑', `未找到进度文件，将从第${args.start}页开始`);
    return null;
  }
}

async function saveRunState(args, counters, extra = {}) {
  if (!args.stateFile || args.dryRun) return;
  const state = {
    updatedAt: new Date().toISOString(),
    nextPage: extra.nextPage || args.start,
    knownPages: extra.knownPages || null,
    quality: args.quality,
    wpType: args.wpType,
    kind: args.kind,
    rows: args.rows,
    lastRun: {
      processed: counters.total,
      ok: counters.ok,
      skipped: counters.skipped,
      failed: counters.failed,
      bytes: counters.bytes,
      stopReason: counters.stopReason || '',
    },
  };
  await mkdir(path.dirname(args.stateFile), { recursive: true });
  await writeFile(args.stateFile, JSON.stringify(state, null, 2));
}

async function processOneItem(item, args, counters) {
  if (counters.stop) return;
  counters.total++;
  const started = Date.now();
  const seq = String(counters.total).padStart(6, '0');
  const seqText = `#${seq}${counters.expectedTotal ? `/${counters.expectedTotal}` : ''}`;
  const workerText = args.workerIndex !== undefined ? ` W${String(args.workerIndex).padStart(3, '0')}` : '';
  const pageText = item.__page ? ` 第${item.__page}页` : '';
  const info = itemInfo(item);
  try {
    const r = await downloadOne(item, args);
    const proxyText = args.proxySession?.proxy?.deleteKey
      ? ` 代理=${args.proxySession.proxy.deleteKey}`
      : (args.relayBase ? ` Relay=${new URL(args.relayBase).host}` : '');
    const name = path.basename(r.file || '');
    if (r.skipped) {
      counters.skipped++;
      logPretty('⏭️', '跳过', `${seqText}${pageText}${workerText} 文件已存在 -> ${name}`);
    } else {
      counters.ok++;
      counters.bytes = (counters.bytes || 0) + Number(r.bytes || 0);
      const proxyKey = args.proxySession?.proxy?.deleteKey || (args.relayBase ? `relay:${new URL(args.relayBase).host}` : (hasProxySource(args) ? 'unknown' : 'local'));
      if (!counters.proxyStats) counters.proxyStats = new Map();
      const st = counters.proxyStats.get(proxyKey) || { ok: 0, bytes: 0 };
      st.ok++;
      st.bytes += Number(r.bytes || 0);
      counters.proxyStats.set(proxyKey, st);
      logPretty('✅', '成功', `${seqText}${pageText}${workerText} ${item.rw}x${item.rh} ${fmtBytes(r.bytes)} ${Date.now() - started}ms${proxyText} -> ${name}`);
      if (args.dailyLimit && counters.ok >= args.dailyLimit) {
        counters.stop = true;
        counters.stopReason = 'daily_limit';
        counters.stopPage = item.__page || counters.stopPage;
        logPretty('🛑', '今日额度', `新增下载已达到 ${counters.ok}/${args.dailyLimit} 张，准备保存进度退出`);
      }
    }
  } catch (e) {
    counters.failed++;
    logPretty('❌', '失败', `${seqText}${pageText}${workerText} ${info} 原因=${oneLine(e.message)}`, { error: true });
    if (String(e.message || '').includes('静态代理已全部失败或达到今日额度')) {
      counters.stop = true;
      counters.stopReason = 'proxy_exhausted';
      counters.stopPage = item.__page || counters.stopPage;
      logPretty('🛑', '代理耗尽', `保存进度后退出：${oneLine(e.message)}`, { error: true });
    }
    if (args.relayBase && String(e.message || '').includes('访客今日下载次数上限')) {
      counters.stop = true;
      counters.stopReason = 'relay_limit';
      counters.stopPage = item.__page || counters.stopPage;
      logPretty('🛑', 'Relay限额', 'Relay 出口今日额度已用完，保存进度后退出', { error: true });
    }
    if (!hasProxySource(args) && String(e.message || '').includes('访客今日下载次数上限')) {
      logPretty('🚫', '限额', '匿名原图额度已用完；同一出口今天不能继续拿原图签名。', { error: true });
      counters.stop = true;
      counters.exitCode = 2;
    }
  }
}

async function runDownloadQueue(tasks, args, counters) {
  const concurrency = Math.min(Math.max(1, args.concurrency), Math.max(1, tasks.length));
  if (concurrency > 1) logPretty('🚀', '并发', `并发=${concurrency} 队列=${tasks.length}`);

  let next = 0;
  const workers = Array.from({ length: concurrency }, async (_, workerIndex) => {
    const wargs = concurrency > 1 ? makeWorkerArgs(args) : args;
    wargs.workerIndex = workerIndex;
    try {
      while (!counters.stop) {
        const index = next++;
        if (index >= tasks.length) break;
        await processOneItem(tasks[index], wargs, counters);
        await sleep(args.delay);
      }
    } finally {
      if (wargs !== args) await dropProxySession(wargs, `worker-${workerIndex} done`, { del: false });
      if (wargs !== args) await dropRelaySession(wargs, `worker-${workerIndex} done`);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv);
  await loadRunState(args);
  await mkdir(args.out, { recursive: true });

  const tasks = [];
  const counters = { total: 0, ok: 0, skipped: 0, failed: 0, bytes: 0, proxyStats: new Map(), stop: false, exitCode: 0 };
  const flushLimit = Math.max(args.concurrency * 3, args.rows, 1);
  let knownPages = null;
  let lastSavedNextPage = args.start;
  for (let p = args.start; p < args.start + args.pages; p++) {
    if (knownPages && p > knownPages) break;
    const data = await getWallpaperListWithRetry({ page: p, rows: args.rows, sort: args.sort, wpType: args.wpType, search: args.search }, args);
    if (!knownPages && Number(data.pages)) {
      knownPages = Number(data.pages);
      const endPage = Math.min(args.start + args.pages - 1, knownPages);
      const plannedPages = Math.max(0, endPage - args.start + 1);
      counters.expectedTotal = plannedPages * args.rows;
      logPretty('🎯', '本次计划', `页数=${plannedPages} 每页=${args.rows} 预计最多=${counters.expectedTotal}张 起止=${args.start}-${endPage}`);
      if (args.start + args.pages - 1 > knownPages) {
        logPretty('📌', '页数', `请求=${args.pages} 实际=${knownPages} 将停在第${knownPages}页`);
      }
    }
    const items = (data.list || []).filter(x => keepItem(x, args.kind));
    logPretty('📄', '列表', `第${p}/${data.pages}页 列表=${data.list?.length || 0} 选中=${items.length} 队列=${tasks.length + items.length}`);
    for (const item of items) {
      if (args.dryRun) logPretty('👀', '预览', itemInfo(item));
      else tasks.push({ ...item, __page: p });
    }
    if (!args.dryRun && tasks.length >= flushLimit) {
      const batch = tasks.splice(0, tasks.length);
      const batchStartPage = batch[0]?.__page || p;
      await runDownloadQueue(batch, args, counters);
      lastSavedNextPage = counters.stop
        ? (counters.stopPage || batchStartPage)
        : p + 1;
      await saveRunState(args, counters, { nextPage: lastSavedNextPage, knownPages });
      if (counters.stop) break;
    }
  }

  if (!args.dryRun && tasks.length && !counters.stop) {
    const batchStartPage = tasks[0]?.__page || lastSavedNextPage;
    await runDownloadQueue(tasks, args, counters);
    lastSavedNextPage = counters.stop
      ? (counters.stopPage || batchStartPage)
      : ((tasks.at(-1)?.__page || lastSavedNextPage) + 1);
    await saveRunState(args, counters, { nextPage: lastSavedNextPage, knownPages });
  }
  await dropProxySession(args, 'done', { del: false });
  await dropRelaySession(args, 'done');
  if (counters.proxyStats?.size) {
    const top = [...counters.proxyStats.entries()]
      .sort((a, b) => b[1].ok - a[1].ok)
      .slice(0, 10)
      .map(([proxy, st]) => `${proxy}:${st.ok}张/${fmtBytes(st.bytes)}`)
      .join('  ');
    logPretty('📊', '代理贡献', top);
  }
  logPretty('🏁', '完成', `本次处理=${counters.total}${counters.expectedTotal ? `/${counters.expectedTotal}` : ''} 新增下载=${counters.ok} 本地已有=${counters.skipped} 失败=${counters.failed} 下载量=${fmtBytes(counters.bytes)}`);
  if (args.stateFile) logPretty('💾', '进度', `下次从第${lastSavedNextPage}页继续 -> ${args.stateFile}`);
  if (counters.exitCode) process.exitCode = counters.exitCode;
}

main().catch(e => { logPretty('💥', '异常', oneLine(e.message), { error: true }); process.exit(1); });
