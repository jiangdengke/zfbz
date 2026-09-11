#!/usr/bin/env node

import crypto from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'web', 'public');
const DOWNLOAD_DIR = path.join(ROOT, 'downloads', 'wallpaper-web');
const STAGING_DIR = path.join(ROOT, 'downloads', '.zfbz-staging');

function loadEnvFiles() {
  const values = {};
  for (const filename of ['.env', '.env.haowallpaper']) {
    try {
      const content = readFileSync(path.join(ROOT, filename), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match) continue;
        let value = match[2];
        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1);
        }
        values[match[1]] = value;
      }
    } catch {}
  }
  return values;
}

const runtimeEnv = { ...loadEnvFiles(), ...process.env };
const PORT = Number(runtimeEnv.PORT || 4173);
const ACCESS_PASSWORD = String(runtimeEnv.ZFBZ_ACCESS_PASSWORD || '');
const SESSION_COOKIE = 'zfbz_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_PATH = '/login.html';
const SITE = 'https://haowallpaper.com/';
const API = 'https://haowallpaper.com/link';
const REFERER = 'https://haowallpaper.com/homeView';
const KEY = Buffer.from('68zhehao2O776519', 'utf8');
const IV = Buffer.from('aa176b7519e84710', 'utf8');
const jobs = new Map();
const authSessions = new Map();
const loginFailures = new Map();

if (!ACCESS_PASSWORD) {
  throw new Error('未配置 ZFBZ_ACCESS_PASSWORD，拒绝启动 Web 服务');
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

async function fetchWallpaper(id) {
  let lastMessage = '壁纸不存在或暂时不可用';
  for (const detailType of [1, 2]) {
    const response = await fetch(`${API}/pc/wallpaper/getWallpaperDetails/${detailType}/${encodeURIComponent(id)}`, {
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        referer: detailType === 2 ? `${SITE}mobileViewLook/${id}` : REFERER,
        'user-agent': 'zfbz-wallpaper-ui/1.0',
      },
    });
    const body = await response.text();
    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      lastMessage = '详情接口返回了无效 JSON';
      continue;
    }
    if (envelope.status !== 200 || typeof envelope.data !== 'string') {
      lastMessage = envelope.msg || lastMessage;
      continue;
    }
    let data;
    try {
      data = JSON.parse(decryptValue(envelope.data));
    } catch {
      lastMessage = '壁纸详情解密失败';
      continue;
    }
    const item = data?.esWallpaperDetails;
    if (item?.wtId && item?.fileId) return { item, detailType };
    lastMessage = '壁纸详情格式不完整';
  }
  throw new Error(lastMessage);
}

function isVideo(item) {
  return [3, 4, 5, 6].includes(Number(item.type));
}

function serializeWallpaper(item, detailType = 1) {
  return {
    wtId: String(item.wtId),
    fileId: String(item.fileId),
    type: Number(item.type),
    isVideo: isVideo(item),
    width: Number(item.rw) || 0,
    height: Number(item.rh) || 0,
    fileMb: item.fileMb || '',
    labels: Array.isArray(item.labelList) ? item.labelList.filter(Boolean).slice(0, 8) : [],
    title: item.title || item.name || '',
    previewUrl: `${API}/common/file/previewFileImg/${encodeURIComponent(item.fileId)}`,
    cropUrl: `/api/media/${encodeURIComponent(item.fileId)}`,
    detailUrl: `${SITE}${detailType === 2 ? 'mobileViewLook' : 'homeViewLook'}/${encodeURIComponent(item.wtId)}`,
  };
}

function safeId(value) {
  const id = String(value || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('壁纸 ID 必须是数字');
  return id;
}

function safeFolder(value, id) {
  const raw = String(value || `wallpaper-${id}`).trim();
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(raw)) {
    throw new Error('保存目录只能包含字母、数字、下划线和短横线');
  }
  return raw;
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

function cookieValue(req, name) {
  const cookieHeader = String(req.headers.cookie || '');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function authenticated(req) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return false;
  const expiresAt = authSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    authSessions.delete(token);
    return false;
  }
  return true;
}

function securePasswordEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function clientKey(req) {
  return req.socket.remoteAddress || 'unknown';
}

function loginRateLimited(req) {
  const key = clientKey(req);
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    loginFailures.delete(key);
    return false;
  }
  return entry.attempts >= 8;
}

function recordLoginFailure(req) {
  const key = clientKey(req);
  const existing = loginFailures.get(key);
  const entry = existing && existing.resetAt > Date.now()
    ? existing
    : { attempts: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  entry.attempts += 1;
  loginFailures.set(key, entry);
}

function authCookie(req, token) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function pruneAuthState() {
  const now = Date.now();
  for (const [token, expiresAt] of authSessions) {
    if (expiresAt <= now) authSessions.delete(token);
  }
  for (const [key, entry] of loginFailures) {
    if (entry.resetAt <= now) loginFailures.delete(key);
  }
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求数据不是有效 JSON');
  }
}

function redactProxyCredentials(line) {
  return String(line)
    .replace(/((?:代理|proxy|使用)=)(?:(?:https?|socks[45a-z]*):\/\/)?[^@\s]+@/gi, '$1***@')
    .replace(/(Relay 使用=https?:\/\/[^/\s]+\/)[^/\s]+/gi, '$1***');
}

function logJob(job, line) {
  job.logs.push(redactProxyCredentials(line).trimEnd());
  if (job.logs.length > 80) job.logs.shift();
}

async function collectFiles(folder) {
  const files = [];
  try {
    for (const name of await fs.readdir(folder)) {
      if (name === 'manifest.json' || name.startsWith('.')) continue;
      const filePath = path.join(folder, name);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      files.push({
        name,
        bytes: stat.size,
        isVideo: /\.(mp4|webm|mov)$/i.test(name),
      });
    }
  } catch {}
  return files;
}

function contentTypeForFile(name) {
  return {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  }[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function streamJobFile(req, res, job, fileName) {
  const file = job.files.find(item => item.name === fileName) || job.files[0];
  if (!file) return notFound(res);
  const filePath = path.join(job.output, file.name);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return notFound(res);
    const cleanup = () => fs.rm(job.output, { recursive: true, force: true }).catch(() => {});
    res.writeHead(200, {
      'content-type': contentTypeForFile(file.name),
      'content-length': stat.size,
      'content-disposition': contentDisposition(file.name),
      'cache-control': 'no-store',
    });
    res.once('finish', cleanup);
    res.once('close', cleanup);
    createReadStream(filePath).on('error', cleanup).pipe(res);
  } catch {
    return notFound(res);
  }
}

async function startDownload({ id, quality, folder }) {
  const jobId = crypto.randomUUID();
  const output = path.join(STAGING_DIR, jobId);
  const job = {
    id: jobId,
    wallpaperId: id,
    quality,
    folder,
    output,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logs: [],
    files: [],
    error: null,
  };
  jobs.set(jobId, job);

  const downloader = path.join(ROOT, 'scripts', 'run_haowallpaper_daily.sh');
  const args = ['--id', id, '--quality', quality, '--out', path.relative(ROOT, output)];
  const child = spawn(downloader, args, {
    cwd: ROOT,
    // The Web UI should return a visible quota error instead of holding a
    // browser request open for the daily crawler's long retry window.
    env: { ...runtimeEnv, RELAY_LIMIT_WAIT: '0', RELAY_LIMIT_MAX_WAIT_ROUNDS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => chunk.toString().split(/\r?\n/).filter(Boolean).forEach(line => logJob(job, line)));
  child.stderr.on('data', chunk => chunk.toString().split(/\r?\n/).filter(Boolean).forEach(line => logJob(job, line)));
  child.on('error', error => {
    job.status = 'failed';
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
  });
  child.on('close', async code => {
    job.files = await collectFiles(output);
    job.finishedAt = new Date().toISOString();
    if (code === 0 && job.files.length > 0) job.status = 'completed';
    else {
      job.status = 'failed';
      if (job.logs.some(line => line.includes('Relay限额') || line.includes('访客今日下载次数上限'))) {
        job.error = 'Resin 今日原图额度已用完，请稍后重试或更换 Relay。';
      } else {
        job.error = job.logs.find(line => line.includes('❌')) || job.logs.at(-1) || `下载进程退出码 ${code}`;
      }
    }
  });
  return job;
}

async function serveStatic(req, res, pathname) {
  let filePath;
  let contentType = 'text/html; charset=utf-8';
  if (pathname.startsWith('/downloads/')) {
    const relative = pathname.slice('/downloads/'.length).split('/').map(decodeURIComponent);
    if (relative.length !== 2 || relative.some(part => part === '..' || part.includes('\\'))) return notFound(res);
    filePath = path.join(DOWNLOAD_DIR, ...relative);
    const ext = path.extname(filePath).toLowerCase();
    contentType = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
      '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    }[ext] || 'application/octet-stream';
  } else {
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (relative.includes('..') || relative.includes('\\')) return notFound(res);
    filePath = path.join(PUBLIC_DIR, relative);
    contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    }[path.extname(filePath).toLowerCase()] || contentType;
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return notFound(res);
    res.writeHead(200, { 'content-type': contentType, 'content-length': stat.size, 'cache-control': pathname.startsWith('/downloads/') ? 'no-store' : 'no-cache' });
    createReadStream(filePath).pipe(res);
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    pruneAuthState();
    if (req.method === 'GET' && url.pathname === '/auth/session') {
      return json(res, 200, { authenticated: authenticated(req) });
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'public, max-age=86400' });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      if (loginRateLimited(req)) return json(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
      const body = await readBody(req);
      if (!securePasswordEqual(body.password || '', ACCESS_PASSWORD)) {
        recordLoginFailure(req);
        return json(res, 401, { error: '密码错误' });
      }
      loginFailures.delete(clientKey(req));
      const token = crypto.randomBytes(32).toString('hex');
      authSessions.set(token, Date.now() + SESSION_TTL_MS);
      return json(res, 200, { ok: true }, { 'set-cookie': authCookie(req, token) });
    }
    if (req.method === 'GET' && url.pathname === LOGIN_PATH) {
      if (authenticated(req)) return redirect(res, '/');
      return serveStatic(req, res, url.pathname);
    }
    if (!authenticated(req)) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const next = `${url.pathname}${url.search}`;
        return redirect(res, `${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
      }
      return json(res, 401, { error: '需要登录后访问' });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/media/')) {
      const fileId = url.pathname.split('/').pop();
      if (!/^\d+$/.test(fileId)) return notFound(res);
      const response = await fetch(`${API}/common/file/getCroppingImg/${fileId}`, {
        headers: { accept: 'image/avif,image/webp,image/apng,image/jpeg,image/*,*/*;q=0.8', referer: REFERER, 'user-agent': 'zfbz-wallpaper-ui/1.0' },
      });
      if (!response.ok) return json(res, response.status, { error: `缩略图 HTTP ${response.status}` });
      const buffer = Buffer.from(await response.arrayBuffer());
      res.writeHead(200, { 'content-type': response.headers.get('content-type') || 'image/jpeg', 'content-length': buffer.length, 'cache-control': 'public, max-age=300' });
      return res.end(buffer);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/wallpaper/')) {
      const { item, detailType } = await fetchWallpaper(safeId(decodeURIComponent(url.pathname.split('/').pop())));
      return json(res, 200, { wallpaper: serializeWallpaper(item, detailType) });
    }
    if (req.method === 'POST' && url.pathname === '/api/download') {
      const body = await readBody(req);
      const id = safeId(body.id);
      const quality = 'original';
      const folder = safeFolder(body.folder || 'browser-download', id);
      const job = await startDownload({ id, quality, folder });
      return json(res, 202, { job: { id: job.id, status: job.status, wallpaperId: id, quality, folder } });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/download')) {
      const jobId = url.pathname.split('/')[3];
      const job = jobs.get(jobId);
      if (!job || job.status !== 'completed') return notFound(res);
      return streamJobFile(req, res, job, url.searchParams.get('file') || '');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
      const job = jobs.get(url.pathname.split('/').pop());
      if (!job) return notFound(res);
      return json(res, 200, {
        job: {
          id: job.id, wallpaperId: job.wallpaperId, quality: job.quality, folder: job.folder,
          status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt,
          logs: job.logs, files: job.files, error: job.error,
        },
      });
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    return json(res, 400, { error: error.message || '请求失败' });
  }
});

await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
await fs.rm(STAGING_DIR, { recursive: true, force: true });
await fs.mkdir(STAGING_DIR, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`zfbz web UI: http://127.0.0.1:${PORT}`);
});
