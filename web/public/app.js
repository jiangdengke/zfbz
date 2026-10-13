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
let renderedLogKey = '';

const icons = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M4 20h16"></path></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 5h12"></path><path d="M6 12h12"></path><path d="M6 19h8"></path></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12"></path><path d="m18 6-12 12"></path></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m4 17 4.6-4.7a1.8 1.8 0 0 1 2.6 0l2 2 1.4-1.4a1.8 1.8 0 0 1 2.6 0L20 14.7"></path></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5.5"></path><path d="M12 16.5h.01"></path></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>',
  'arrow-up-right': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"></path><path d="M8 7h9v9"></path></svg>',
};

document.querySelectorAll('[data-icon]').forEach((node) => {
  node.innerHTML = icons[node.dataset.icon] || icons.image;
});

const JOB_STATUS_LABELS = { running: '下载中', completed: '已完成', partial: '部分完成', failed: '失败' };
const ROW_STATUS_LABELS = { queued: '待下载', invalid: '无法识别', pending: '等待', running: '下载中', done: '已完成', error: '失败', skipped: '未处理' };

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
    : batch ? (ids.length ? `批量下载 ${ids.length} 张` : '批量下载') : '开始下载';
}

function setMode(mode) {
  state.mode = mode;
  const batch = mode === 'batch';
  $('.preview-column').classList.toggle('is-batch', batch);
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
  frame.className = `media-frame is-${kind}`;
  frame.style.removeProperty('--media-url');
  frame.setAttribute('aria-busy', String(kind === 'loading'));
  const visual = kind === 'loading'
    ? '<span class="spinner"></span>'
    : `<span class="frame-icon">${icons[kind === 'error' ? 'alert' : 'image']}</span>`;
  frame.innerHTML = `<div class="media-grid"></div><div class="frame-state">${visual}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`;
}

function showEmptyPreview() {
  setFrameState('empty', '预览区域', '输入壁纸 ID 或粘贴详情页链接后自动显示');
}

function clearWallpaper() {
  state.wallpaper = null;
  $('#preview-title').textContent = '等待一张壁纸';
  $('#preview-title').removeAttribute('title');
  $('#source-link').hidden = true;
  $('#wallpaper-meta').hidden = true;
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
    frame.className = 'media-frame has-media';
    frame.setAttribute('aria-busy', 'false');
    frame.style.setProperty('--media-url', `url("${url}")`);
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
  $('#wallpaper-labels').innerHTML = (wallpaper.labels || []).map(label => `<li>${escapeHtml(label)}</li>`).join('');
  $('#wallpaper-meta').hidden = false;
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

function setPanelHeader({ status, kicker, title, badge, copy, count }) {
  jobPanel.hidden = false;
  jobPanel.dataset.status = status;
  $('#job-kicker').textContent = kicker;
  $('#job-title').textContent = title;
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
    kicker: 'BATCH',
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

function jobRows(job) {
  const ids = job.wallpaperIds?.length ? job.wallpaperIds : [job.wallpaperId].filter(Boolean);
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
      note = current ? '正在通过代理池下载原图' : '';
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
    kicker: batch ? 'BATCH' : 'DOWNLOAD',
    title: batch ? '批量下载' : '下载任务',
    badge: JOB_STATUS_LABELS[job.status] || job.status,
    copy: jobCopy(job, total),
    count: batch ? `${processed}/${total}` : '',
  });
  setProgress(running ? (total === 1 || processed === 0 ? null : Math.round((processed / total) * 100)) : 100);
  renderJobLogs(job.logs || []);
  resultList.innerHTML = jobRows(job).join('');
}

function logLevel(line) {
  if (line.includes('✅') || line.includes('成功')) return 'success';
  if (line.includes('❌') || line.includes('异常')) return 'error';
  if (line.includes('⚠️') || line.includes('🚫') || line.includes('🛑') || line.includes('🔁') || line.includes('⏳')) return 'warning';
  return 'info';
}

function renderJobLogs(logs) {
  const entries = logs.slice(-80);
  const last = entries.at(-1) || '';
  const summary = $('#job-log-summary');
  summary.textContent = last;
  summary.title = last;
  summary.hidden = !last;
  $('#job-log-button').hidden = entries.length === 0;
  const key = `${entries.length}:${last}`;
  if (key === renderedLogKey) return;
  renderedLogKey = key;
  const list = $('#job-log');
  const pinnedToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = entries.map((line) => {
    const level = logLevel(line);
    return `<div class="log-entry is-${level}"><span class="log-level">${level}</span><span class="log-message">${escapeHtml(line)}</span></div>`;
  }).join('');
  if (logDialog.open && pinnedToBottom) list.scrollTop = list.scrollHeight;
}

function dismissJob() {
  state.job = null;
  renderedLogKey = '';
  $('#job-log').innerHTML = '';
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
    renderedLogKey = '';
    state.job = { logs: [], results: [], files: [], ...data.job, mode };
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
      const data = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (state.job?.id !== jobId) return;
      failures = 0;
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
  logDialog.showModal();
  const list = $('#job-log');
  list.scrollTop = list.scrollHeight;
});
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
