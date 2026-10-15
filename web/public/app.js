const MAX_BATCH_IDS = 100;
const POLL_INTERVAL_MS = 700;
const MAX_POLL_FAILURES = 5;
const WALLPAPER_INPUT_ERROR = '请输入数字壁纸 ID，或粘贴 haowallpaper.com 的详情页链接。';

const state = {
  mode: 'single',
  wallpaper: null,
  lookupPending: false,
  batch: { ids: [], invalid: [] },
  quality: 'original',
  job: null,
  pollTimer: null,
  downloadTriggeredJobId: null,
  logs: [],
  logSeq: 0,
  logGap: false,
  logFilter: 'all',
  logOpenGroups: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const idInput = $('#wallpaper-id');
const batchInput = $('#batch-ids');
const lookupForm = $('#lookup-form');
const downloadButton = $('#download-button');
const jobPanel = $('#job-panel');
const resultList = $('#result-list');
const logDialog = $('#log-dialog');
let lookupTimer = null;
let lookupRequestId = 0;

const icons = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M4 20h16"></path></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 5h12"></path><path d="M6 12h12"></path><path d="M6 19h8"></path></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12"></path><path d="m18 6-12 12"></path></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m4 17 4.6-4.7a1.8 1.8 0 0 1 2.6 0l2 2 1.4-1.4a1.8 1.8 0 0 1 2.6 0L20 14.7"></path></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5.5"></path><path d="M12 16.5h.01"></path></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>',
  stack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 13 9 5 9-5"></path></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 4v16"></path><path d="M17 4v16"></path><path d="M3 12h18"></path></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"></path></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="6" r="2"></circle><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"></path></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4h8l9 9-8 8z"></path><circle cx="7.5" cy="7.5" r="1.2"></circle></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>',
  'arrow-up-right': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"></path><path d="M8 7h9v9"></path></svg>',
};

document.querySelectorAll('[data-icon]').forEach((node) => {
  node.innerHTML = icons[node.dataset.icon] || icons.image;
});

const JOB_STATUS_LABELS = { running: '下载中', completed: '已完成', partial: '部分完成', failed: '失败' };
const ROW_STATUS_LABELS = { queued: '待下载', invalid: '无法识别', pending: '等待', running: '下载中', done: '已完成', error: '失败', skipped: '未处理' };
// Step titles of the downloader's 8-stage original-image flow (logFlow stages 1-8).
const FLOW_STEPS = ['出口 IP', '匿名会话', 'Challenge', 'PoW 验证', '签名 URL', '传输文件', '保存文件', '完成'];
const LOG_LEVEL_LABELS = { info: '信息', success: '成功', warn: '警告', error: '错误' };
const LOG_KEY_LABELS = { host: '主机', via: '线路', attempt: '尝试', bytes: '大小', wtId: 'ID', algorithm: '算法', maxnumber: '难度', number: '解', signer: '签名', transfer: '传输', type: '类型' };
const LOG_VALUE_LABELS = { via: { direct: '直连', relay: 'Relay' }, transfer: { auto: '自动', direct: '直连', relay: 'Relay' } };
const MAX_CLIENT_LOGS = 2000;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.assign(`/login.html?next=${encodeURIComponent(location.pathname)}`);
    throw new Error('登录已过期，正在跳转到验证页…');
  }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setAlert(message = '') {
  $('#alert-text').textContent = message;
  $('#alert').hidden = !message;
}

function parseWallpaperId(value) {
  const raw = String(value || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (!['haowallpaper.com', 'www.haowallpaper.com'].includes(url.hostname.toLowerCase())) return '';
    const match = url.pathname.match(/^\/(?:homeViewLook|mobileViewLook)\/(\d+)\/?$/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

// Batch entries accept the same ID / detail-link forms as single mode; the
// server rejects the whole batch on any non-numeric ID, so flag them up front.
function parseBatchInput(value) {
  const ids = new Set();
  const invalid = new Set();
  for (const token of String(value || '').split(/[\s,，、;；]+/).filter(Boolean)) {
    const id = parseWallpaperId(token);
    if (id) ids.add(id);
    else invalid.add(token);
  }
  return { ids: [...ids], invalid: [...invalid] };
}

function isJobRunning() {
  return state.job?.status === 'running';
}

function updateDownloadAvailability() {
  const running = isJobRunning();
  const batch = state.mode === 'batch';
  const { ids, invalid } = state.batch;
  const ready = batch
    ? ids.length > 0 && ids.length <= MAX_BATCH_IDS && invalid.length === 0
    : Boolean(state.wallpaper) && !state.lookupPending;
  downloadButton.disabled = running || !ready;
  downloadButton.classList.toggle('is-loading', running);
  $('#download-button-label').textContent = running
    ? '下载中…'
    : batch ? (ids.length ? `批量下载 ${ids.length} 张` : '批量下载') : '下载';
}

function setMode(mode) {
  state.mode = mode;
  const batch = mode === 'batch';
  document.body.classList.toggle('is-batch', batch);
  // Batch jobs take over the stage; single jobs sit under the download button.
  (batch ? $('.stage') : $('#job-slot')).append(jobPanel);
  for (const [selector, selected] of [['#single-mode', !batch], ['#batch-mode', batch]]) {
    $(selector).classList.toggle('is-selected', selected);
    $(selector).setAttribute('aria-pressed', String(selected));
  }
  $('#single-input').hidden = batch;
  $('#batch-input').hidden = !batch;
  const raw = idInput.value.trim();
  setAlert(!batch && raw && !parseWallpaperId(raw) ? WALLPAPER_INPUT_ERROR : '');
  renderPanel();
  updateDownloadAvailability();
}

/* Preview */

function setFrameState(kind, title, text) {
  const frame = $('#media-frame');
  frame.className = `device-screen is-${kind}`;
  frame.setAttribute('aria-busy', String(kind === 'loading'));
  const visual = kind === 'loading'
    ? '<span class="spinner"></span>'
    : `<span class="frame-icon">${icons[kind === 'error' ? 'alert' : 'image']}</span>`;
  frame.innerHTML = `<div class="media-grid"></div><div class="frame-state">${visual}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`;
}

function showEmptyPreview() {
  setFrameState('empty', '预览区域', '输入壁纸 ID 或粘贴详情页链接后自动显示');
}

function setDevice(kind) {
  $('#device').className = `device is-${kind}`;
}

function clearWallpaper() {
  state.wallpaper = null;
  $('#preview-title').textContent = '等待一张壁纸';
  $('#preview-title').removeAttribute('title');
  $('#source-link').hidden = true;
  $('#wallpaper-labels').hidden = true;
  for (const id of ['#wallpaper-size', '#wallpaper-file', '#wallpaper-type']) $(id).textContent = '—';
  document.body.classList.remove('has-backdrop');
  setDevice('laptop');
}

function renderMedia(url, badge) {
  const requestId = lookupRequestId;
  const frame = $('#media-frame');
  setFrameState('loading', '正在加载预览图', '公开缩略图，仅用于确认画面');
  const image = new Image();
  image.alt = '壁纸预览';
  image.decoding = 'async';
  image.addEventListener('load', () => {
    if (requestId !== lookupRequestId) return;
    frame.className = 'device-screen has-media';
    frame.setAttribute('aria-busy', 'false');
    document.body.style.setProperty('--backdrop-url', `url("${url}")`);
    document.body.classList.add('has-backdrop');
    frame.querySelector('.frame-state')?.remove();
    image.classList.add('is-ready');
  });
  image.addEventListener('error', () => {
    if (requestId === lookupRequestId) setFrameState('error', '预览图加载失败', '不影响原图下载，可以直接开始下载');
  });
  image.src = url;
  frame.appendChild(image);
  if (badge) frame.insertAdjacentHTML('beforeend', `<span class="media-badge">${escapeHtml(badge)}</span>`);
}

function renderWallpaper(wallpaper) {
  state.wallpaper = wallpaper;
  state.lookupPending = false;
  const title = wallpaper.title || `壁纸 ${wallpaper.wtId}`;
  $('#preview-title').textContent = title;
  $('#preview-title').title = title;
  $('#wallpaper-size').textContent = wallpaper.width && wallpaper.height ? `${wallpaper.width} × ${wallpaper.height}` : '—';
  $('#wallpaper-file').textContent = wallpaper.fileMb
    ? (/\b(?:KB|MB|GB)$/i.test(String(wallpaper.fileMb).trim()) ? wallpaper.fileMb : `${wallpaper.fileMb} MB`)
    : '—';
  $('#wallpaper-type').textContent = wallpaper.isVideo ? '动态壁纸' : '静态壁纸';
  const labels = wallpaper.labels || [];
  $('#wallpaper-labels').innerHTML = labels.map(label => `<li>${icons.tag}${escapeHtml(label)}</li>`).join('');
  $('#wallpaper-labels').hidden = labels.length === 0;
  setDevice(wallpaper.height > wallpaper.width ? 'phone' : 'laptop');
  const source = $('#source-link');
  source.href = wallpaper.detailUrl;
  source.hidden = false;
  // The detail lookup uses the public crop endpoint only for confirmation.
  renderMedia(wallpaper.cropUrl, wallpaper.isVideo ? '动态壁纸 · 封面预览' : '');
  updateDownloadAvailability();
}

function syncSingleInput({ immediate = false } = {}) {
  clearTimeout(lookupTimer);
  const requestId = ++lookupRequestId;
  if (state.job && !isJobRunning()) dismissJob();
  clearWallpaper();
  const raw = idInput.value.trim();
  const id = parseWallpaperId(raw);
  const invalid = Boolean(raw) && !id;
  state.lookupPending = Boolean(id);
  $('.id-entry').classList.toggle('is-invalid', invalid);
  idInput.setAttribute('aria-invalid', String(invalid));
  setAlert(invalid ? WALLPAPER_INPUT_ERROR : '');
  if (id) {
    $('#preview-title').textContent = `ID ${id}`;
    setFrameState('loading', '正在查找壁纸', '读取公开详情与缩略图');
    $('#lookup-button').classList.add('is-loading');
    lookupTimer = setTimeout(() => lookup(id, requestId), immediate ? 0 : 350);
  } else {
    $('#lookup-button').classList.remove('is-loading');
    showEmptyPreview();
  }
  updateDownloadAvailability();
}

async function lookup(id, requestId) {
  try {
    const data = await api(`/api/wallpaper/${encodeURIComponent(id)}`);
    if (requestId !== lookupRequestId) return;
    renderWallpaper(data.wallpaper);
  } catch (error) {
    if (requestId !== lookupRequestId) return;
    state.lookupPending = false;
    setFrameState('error', '找不到这张壁纸', '请确认 ID 或链接是否正确');
    setAlert(error.message || '壁纸查询失败');
    updateDownloadAvailability();
  } finally {
    if (requestId === lookupRequestId) $('#lookup-button').classList.remove('is-loading');
  }
}

/* Batch queue + job panel */

function updateBatch() {
  state.batch = parseBatchInput(batchInput.value);
  const { ids, invalid } = state.batch;
  const over = ids.length > MAX_BATCH_IDS;
  const count = $('#batch-count');
  count.textContent = invalid.length
    ? `${ids.length} 个 ID · ${invalid.length} 个无法识别`
    : over ? `${ids.length} 个 ID · 超出 ${MAX_BATCH_IDS} 个上限` : `${ids.length} 个 ID`;
  const hasError = invalid.length > 0 || over;
  count.classList.toggle('is-error', hasError);
  batchInput.classList.toggle('is-invalid', hasError);
  batchInput.setAttribute('aria-invalid', String(hasError));
  renderPanel();
  updateDownloadAvailability();
}

// The latest job stays on screen until new input replaces it; only batch mode swaps a
// finished single job for its own queue.
function renderPanel() {
  const job = state.job;
  if (job && !(state.mode === 'batch' && job.mode === 'single' && !isJobRunning())) renderJob(job);
  else if (state.mode === 'batch') renderQueue();
  else jobPanel.hidden = true;
}

function setPanelHeader({ status, title, badge, copy, count }) {
  jobPanel.hidden = false;
  jobPanel.dataset.status = status;
  $('#job-title-text').textContent = title;
  $('#job-status').textContent = badge;
  $('#job-copy').textContent = copy;
  $('#job-count').textContent = count;
}

function setProgress(percent) {
  const track = $('.progress-track');
  const indeterminate = percent === null;
  track.hidden = false;
  track.classList.toggle('is-indeterminate', indeterminate);
  if (indeterminate) track.removeAttribute('aria-valuenow');
  else track.setAttribute('aria-valuenow', String(percent));
  $('#progress-bar').style.width = indeterminate ? '' : `${percent}%`;
}

function resultRow({ marker, id, status, files = [], note = '', jobId }) {
  const links = (files || []).map((file) => {
    const href = `/api/jobs/${encodeURIComponent(jobId)}/download?file=${encodeURIComponent(file.name)}`;
    return `<a class="result-file" href="${href}" download="${escapeHtml(file.name)}" title="再次下载 ${escapeHtml(file.name)}">${icons.download}<span>${escapeHtml(file.name)}</span><small>${formatBytes(file.bytes)}</small></a>`;
  }).join('');
  const detail = links
    ? `<div class="result-files">${links}</div>`
    : note ? `<span class="result-note">${escapeHtml(note)}</span>` : '';
  return `<li class="result-item is-${status}"><span class="result-index">${escapeHtml(marker)}</span><div class="result-main"><span class="result-id">${escapeHtml(id)}</span>${detail}</div><span class="result-state">${ROW_STATUS_LABELS[status]}</span></li>`;
}

function renderQueue() {
  const { ids, invalid } = state.batch;
  const over = ids.length > MAX_BATCH_IDS;
  setPanelHeader({
    status: invalid.length || over ? 'failed' : 'idle',
    title: '批量队列',
    badge: invalid.length || over ? '需要修正' : ids.length ? '待开始' : '空队列',
    copy: invalid.length
      ? `有 ${invalid.length} 个条目无法识别，修正后才能开始`
      : over ? `一次最多 ${MAX_BATCH_IDS} 个，请分批下载` : ids.length ? '核对无误后点击「批量下载」' : '在左侧粘贴壁纸 ID 或详情页链接',
    count: ids.length ? `${ids.length} 个` : '',
  });
  $('.progress-track').hidden = true;
  $('#job-log-summary').hidden = true;
  $('#job-log-button').hidden = true;
  const rows = [
    ...invalid.map(token => resultRow({ marker: '—', id: token, status: 'invalid', note: '不是有效的壁纸 ID 或详情页链接' })),
    ...ids.map((id, index) => resultRow({ marker: String(index + 1).padStart(2, '0'), id, status: 'queued' })),
  ];
  resultList.innerHTML = rows.length ? rows.join('') : '<li class="result-empty">粘贴后在这里核对待下载的壁纸</li>';
}

function jobCopy(job, total) {
  if (job.status === 'running') {
    return total > 1 && job.currentId
      ? `正在处理第 ${Math.min((Number(job.currentIndex) || 0) + 1, total)} 张 · ID ${job.currentId}`
      : '代理池正在处理任务';
  }
  if (job.status === 'completed') return `${job.succeededCount || 1} 张文件已保存到浏览器下载目录`;
  if (job.status === 'partial') return `${job.succeededCount || 0} 张成功，${job.failedCount || 0} 张失败，成功的文件已自动保存`;
  return job.error || '下载失败';
}

function jobIds(job) {
  return job.wallpaperIds?.length ? job.wallpaperIds : [job.wallpaperId].filter(Boolean);
}

function currentStepNote(index) {
  const entry = state.logs.findLast(item => item.item === index && item.stage);
  return entry ? `第 ${entry.stage}/8 步 · ${FLOW_STEPS[entry.stage - 1]}` : '正在通过代理池下载原图';
}

function jobRows(job) {
  const ids = jobIds(job);
  const results = Array.isArray(job.results) ? job.results : [];
  return ids.map((id, index) => {
    const result = results[index];
    let status = 'skipped';
    let note = '任务中断，未处理';
    if (result) {
      status = result.status === 'completed' ? 'done' : 'error';
      note = result.error || '未生成文件';
    } else if (job.status === 'running') {
      const current = index === (Number(job.currentIndex) || 0);
      status = current ? 'running' : 'pending';
      note = current ? currentStepNote(index) : '';
    }
    return resultRow({ marker: String(index + 1).padStart(2, '0'), id, status, note, files: result?.files, jobId: job.id });
  });
}

function renderJob(job) {
  const batch = job.mode === 'batch';
  const total = Math.max(1, Number(job.total) || job.wallpaperIds?.length || 1);
  const processed = Math.min(total, Number(job.processedCount) || 0);
  const running = job.status === 'running';
  setPanelHeader({
    status: job.status,
    title: batch ? '批量下载' : '下载任务',
    badge: JOB_STATUS_LABELS[job.status] || job.status,
    copy: jobCopy(job, total),
    count: batch ? `${processed}/${total}` : '',
  });
  setProgress(running ? (total === 1 || processed === 0 ? null : Math.round((processed / total) * 100)) : 100);
  renderJobLogs(job);
  resultList.innerHTML = jobRows(job).join('');
}

/* Logs */

// Entries arrive incrementally (seq > state.logSeq); a gap means the server's
// bounded buffer already dropped older lines before this page saw them.
function mergeLogs(job) {
  const incoming = (job.logs || []).filter(entry => entry && entry.seq > state.logSeq);
  if (incoming.length && incoming[0].seq > state.logSeq + 1) state.logGap = true;
  state.logs.push(...incoming);
  if (state.logs.length > MAX_CLIENT_LOGS) {
    state.logs.splice(0, state.logs.length - MAX_CLIENT_LOGS);
    state.logGap = true;
  }
  state.logSeq = Math.max(state.logSeq, Number(job.logSeq) || 0, incoming.at(-1)?.seq || 0);
}

function resetLogs() {
  state.logs = [];
  state.logSeq = 0;
  state.logGap = false;
  state.logOpenGroups.clear();
  $('#job-log').innerHTML = '';
}

function isIssue(entry) {
  return entry.level === 'warn' || entry.level === 'error';
}

function formatClock(time) {
  return new Date(time).toLocaleTimeString('zh-CN', { hour12: false });
}

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function logValue(key, value) {
  return key === 'bytes' && /^\d+$/.test(value) ? formatBytes(Number(value)) : LOG_VALUE_LABELS[key]?.[value] ?? value;
}

function logChip(key, value, extra = '') {
  const shown = logValue(key, value);
  return `<span class="kv${extra}"><span class="kv-k">${escapeHtml(LOG_KEY_LABELS[key] || key)}</span><span class="kv-v">${escapeHtml(shown)}</span></span>`;
}

// Turns `key=value` tokens into labelled chips; `原因=` always runs to the end of the line.
function formatLogMessage(message) {
  let text = String(message);
  let reason = '';
  const reasonAt = text.search(/(?:^|\s)原因=/);
  if (reasonAt >= 0) {
    reason = text.slice(reasonAt).replace(/^\s*原因=/, '');
    text = text.slice(0, reasonAt);
  }
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/(^|\s)([^\s=]{1,24})=(\S*)/g)) {
    const start = match.index + match[1].length;
    parts.push(escapeHtml(text.slice(last, start)), logChip(match[2], match[3]));
    last = match.index + match[0].length;
  }
  parts.push(escapeHtml(text.slice(last)));
  if (reason) parts.push(' ', logChip('原因', reason, ' is-reason'));
  return parts.join('');
}

function logSummaryText(entry) {
  const step = entry.stage ? `${entry.stage}/8 ` : '';
  const message = String(entry.msg || '').replace(/(^|\s)([^\s=]{1,24})=(\S*)/g, (match, space, key, value) => `${space}${LOG_KEY_LABELS[key] || key} ${logValue(key, value)}`);
  return `${step}${[entry.title, message].filter(Boolean).join(' · ')}`;
}

function itemOutcome(job, index) {
  const result = job.results?.[index];
  if (result) return result.status === 'completed' ? 'done' : 'error';
  if (job.status === 'running') return index === (Number(job.currentIndex) || 0) ? 'running' : 'pending';
  return job.status === 'failed' ? 'error' : 'pending';
}

function logGroups(job) {
  const ids = jobIds(job);
  const groups = new Map();
  for (const entry of state.logs) {
    const index = Number.isInteger(entry.item) ? entry.item : 0;
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(entry);
  }
  return [...groups].sort((a, b) => a[0] - b[0]).map(([index, entries]) => ({ index, id: ids[index] || '', entries, outcome: itemOutcome(job, index) }));
}

function renderFlowSteps(entries, outcome) {
  const staged = entries.filter(entry => entry.stage);
  if (!staged.length) return '';
  const seen = new Set(staged.map(entry => entry.stage));
  const last = staged.at(-1).stage;
  const steps = FLOW_STEPS.map((label, offset) => {
    const step = offset + 1;
    let status = 'pending';
    if (outcome === 'done' && seen.has(step)) status = 'done';
    else if (outcome === 'error' && step === last) status = 'failed';
    else if (outcome === 'running' && step === last) status = 'active';
    else if (seen.has(step) && step < last) status = 'done';
    const mark = status === 'done' ? icons.check : status === 'failed' ? icons.close : step;
    return `<li class="flow-step is-${status}"><span class="flow-dot">${mark}</span><span class="flow-label">${label}</span></li>`;
  });
  return `<ol class="flow-steps" aria-label="原图下载流程">${steps.join('')}</ol>`;
}

function renderLogRow(entry) {
  const mark = entry.stage ? `<span class="log-step">${entry.stage}/8</span>` : '<span class="log-dot"></span>';
  const title = entry.title ? `<span class="log-title">${escapeHtml(entry.title)}</span>` : '';
  const message = entry.msg ? `<span class="log-msg">${formatLogMessage(entry.msg)}</span>` : '';
  return `<li class="log-row is-${entry.level}"><time class="log-time">${formatClock(entry.t)}</time><span class="log-mark" title="${LOG_LEVEL_LABELS[entry.level] || ''}">${mark}</span><div class="log-text">${title}${message}</div></li>`;
}

const GROUP_LABELS = { done: '已完成', error: '失败', running: '进行中', pending: '等待' };

function renderLogGroup({ index, id, entries, outcome }, { onlyIssues, batch }) {
  const rows = onlyIssues ? entries.filter(isIssue) : entries;
  if (onlyIssues && !rows.length) return '';
  const open = state.logOpenGroups.get(index) ?? (!batch || onlyIssues || outcome === 'running' || outcome === 'error');
  const elapsed = entries.length > 1 ? `<span class="log-group-time">${formatElapsed(entries.at(-1).t - entries[0].t)}</span>` : '';
  return `<details class="log-group is-${outcome}" data-index="${index}"${open ? ' open' : ''}>
    <summary class="log-group-head">
      <span class="log-group-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="log-group-id">${escapeHtml(id || '任务')}</span>
      <span class="log-group-state">${GROUP_LABELS[outcome]}</span>${elapsed}
      <span class="log-group-chevron">${icons.chevron}</span>
    </summary>
    ${renderFlowSteps(entries, outcome)}
    <ol class="log-lines">${rows.map(renderLogRow).join('')}</ol>
  </details>`;
}

function renderLogDialog(job) {
  const list = $('#job-log');
  const pinnedToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const scrollTop = list.scrollTop;
  const groups = logGroups(job);
  const batch = jobIds(job).length > 1;
  const onlyIssues = state.logFilter === 'issues';
  $('#log-issue-count').textContent = String(state.logs.filter(isIssue).length);
  $('#log-stats').textContent = batch ? `${state.logs.length} 条 · ${groups.length} 张壁纸` : `${state.logs.length} 条`;
  const body = groups.map(group => renderLogGroup(group, { onlyIssues, batch })).join('');
  const empty = onlyIssues ? '没有警告或错误' : '等待下载器返回日志';
  list.innerHTML = (state.logGap ? '<p class="log-note">更早的日志已省略</p>' : '') + (body || `<p class="log-note">${empty}</p>`);
  list.scrollTop = pinnedToBottom ? list.scrollHeight : scrollTop;
}

function renderJobLogs(job) {
  const last = state.logs.at(-1);
  const summary = $('#job-log-summary');
  summary.textContent = last ? logSummaryText(last) : '';
  summary.title = summary.textContent;
  summary.hidden = !last;
  $('#job-log-button').hidden = state.logs.length === 0;
  if (logDialog.open) renderLogDialog(job);
}

function logPlainText(job) {
  const ids = jobIds(job);
  const lines = [];
  let group = null;
  for (const entry of state.logs) {
    if (entry.item !== group) {
      group = entry.item;
      lines.push(`# ${String(group + 1).padStart(2, '0')} ID ${ids[group] || ''}`.trimEnd());
    }
    const step = entry.stage ? `[${entry.stage}/8] ` : '';
    lines.push(`${formatClock(entry.t)} ${LOG_LEVEL_LABELS[entry.level] || entry.level} ${step}${[entry.title, entry.msg].filter(Boolean).join(' ')}`);
  }
  return lines.join('\n');
}

async function copyLogs() {
  if (!state.job) return;
  const text = logPlainText(state.job);
  const label = $('#copy-log-label');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    logDialog.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  label.textContent = '已复制';
  setTimeout(() => { label.textContent = '复制'; }, 1500);
}

function setLogFilter(filter) {
  state.logFilter = filter;
  document.querySelectorAll('.log-filter-tab').forEach((tab) => {
    const selected = tab.dataset.filter === filter;
    tab.classList.toggle('is-selected', selected);
    tab.setAttribute('aria-pressed', String(selected));
  });
  if (state.job) renderLogDialog(state.job);
}

function dismissJob() {
  state.job = null;
  resetLogs();
  if (logDialog.open) logDialog.close();
  renderPanel();
}

/* Download */

function saveJobFiles(job) {
  if (state.downloadTriggeredJobId === job.id) return;
  state.downloadTriggeredJobId = job.id;
  (job.files || []).forEach((file, index) => {
    setTimeout(() => {
      const link = document.createElement('a');
      link.href = `/api/jobs/${encodeURIComponent(job.id)}/download?file=${encodeURIComponent(file.name)}`;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, index * 250);
  });
}

async function startDownload() {
  if (downloadButton.disabled) return;
  const mode = state.mode;
  const ids = mode === 'batch' ? state.batch.ids : [state.wallpaper.wtId];
  setAlert('');
  downloadButton.disabled = true;
  try {
    const data = await api('/api/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, quality: state.quality }),
    });
    resetLogs();
    mergeLogs(data.job);
    state.job = { results: [], files: [], ...data.job, mode };
    renderPanel();
    pollJob(data.job.id);
  } catch (error) {
    setAlert(error.message || '无法创建下载任务');
  } finally {
    updateDownloadAvailability();
  }
}

function pollJob(jobId) {
  clearTimeout(state.pollTimer);
  let failures = 0;
  const tick = async () => {
    try {
      const data = await api(`/api/jobs/${encodeURIComponent(jobId)}?logsAfter=${state.logSeq}`);
      if (state.job?.id !== jobId) return;
      failures = 0;
      mergeLogs(data.job);
      const previousStatus = state.job.status;
      state.job = { ...data.job, mode: state.job.mode };
      if (previousStatus === 'running' && state.job.status !== 'running') saveJobFiles(state.job);
      if (state.job.status === 'running') state.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    } catch (error) {
      if (state.job?.id !== jobId) return;
      // Ride out brief network blips; a 404 means the server no longer knows the job.
      if (error.status !== 404 && ++failures < MAX_POLL_FAILURES) {
        state.pollTimer = setTimeout(tick, POLL_INTERVAL_MS * 2);
        return;
      }
      state.job = { ...state.job, status: 'failed', error: `无法获取任务状态：${error.message}` };
    }
    renderPanel();
    updateDownloadAvailability();
  };
  state.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
}

/* Events */

idInput.addEventListener('input', () => syncSingleInput());
lookupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.mode === 'batch') return startDownload();
  if (!idInput.value.trim()) return idInput.focus();
  syncSingleInput({ immediate: true });
});
batchInput.addEventListener('input', () => {
  if (state.job?.mode === 'batch' && !isJobRunning()) dismissJob();
  updateBatch();
});
downloadButton.addEventListener('click', startDownload);
$('#single-mode').addEventListener('click', () => setMode('single'));
$('#batch-mode').addEventListener('click', () => setMode('batch'));
$('#job-log-button').addEventListener('click', () => {
  if (!state.job) return;
  logDialog.showModal();
  renderLogDialog(state.job);
  const list = $('#job-log');
  list.scrollTop = list.scrollHeight;
});
// Remember groups the user opened or closed so live re-renders keep them that way.
$('#job-log').addEventListener('click', (event) => {
  const summary = event.target.closest('summary');
  if (!summary) return;
  const group = summary.parentElement;
  state.logOpenGroups.set(Number(group.dataset.index), !group.open);
});
document.querySelectorAll('.log-filter-tab').forEach(tab => tab.addEventListener('click', () => setLogFilter(tab.dataset.filter)));
$('#copy-log-button').addEventListener('click', copyLogs);
$('#close-log-button').addEventListener('click', () => logDialog.close());
logDialog.addEventListener('click', (event) => {
  if (event.target === logDialog) logDialog.close();
});
// Clearing never abandons a running job: its files still need to be saved when it finishes.
$('#reset-button').addEventListener('click', () => {
  idInput.value = '';
  batchInput.value = '';
  if (!isJobRunning()) dismissJob();
  syncSingleInput();
  updateBatch();
  setMode('single');
  idInput.focus();
});

function updateClock() {
  $('#clock').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

showEmptyPreview();
updateBatch();
updateClock();
setInterval(updateClock, 30000);
if (matchMedia('(pointer: fine)').matches) idInput.focus();
