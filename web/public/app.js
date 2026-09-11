const state = {
  mode: 'single',
  wallpaper: null,
  batchIds: [],
  quality: 'original',
  job: null,
  polling: null,
  downloadTriggeredJobId: null,
};

const $ = (selector) => document.querySelector(selector);
const idInput = $('#wallpaper-id');
const lookupForm = $('#lookup-form');
const downloadButton = $('#download-button');
const alertBox = $('#alert');

const icons = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M4 20h16"></path></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 5h12"></path><path d="M6 12h12"></path><path d="M6 19h8"></path></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12"></path><path d="m18 6-12 12"></path></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m4 17 4.6-4.7a1.8 1.8 0 0 1 2.6 0l2 2 1.4-1.4a1.8 1.8 0 0 1 2.6 0L20 14.7"></path></svg>',
  'arrow-up-right': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"></path><path d="M8 7h9v9"></path></svg>',
};

document.querySelectorAll('[data-icon]').forEach((node) => {
  node.innerHTML = icons[node.dataset.icon] || icons.image;
});

function setAlert(message = '') {
  alertBox.textContent = message;
}

function setLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
}

function parseBatchIds(value) {
  return [...new Set(String(value || '').split(/[\s,，、;；]+/).map(item => item.trim()).filter(Boolean))];
}

function updateBatchCount() {
  state.batchIds = parseBatchIds($('#batch-ids').value);
  $('#batch-count').textContent = `${state.batchIds.length} 个 ID`;
  updateDownloadAvailability();
}

function updateDownloadAvailability() {
  downloadButton.disabled = state.mode === 'single' ? !state.wallpaper : state.batchIds.length === 0;
}

function setMode(mode) {
  state.mode = mode;
  const batch = mode === 'batch';
  $('#single-mode').classList.toggle('is-selected', !batch);
  $('#batch-mode').classList.toggle('is-selected', batch);
  $('#single-mode').setAttribute('aria-selected', String(!batch));
  $('#batch-mode').setAttribute('aria-selected', String(batch));
  $('#single-input').hidden = batch;
  $('#batch-input').hidden = !batch;
  $('.icon-button').hidden = batch;
  $('#download-button-label').textContent = batch ? '批量下载' : '开始下载';
  if (batch) {
    $('#preview-title').textContent = '等待批量任务';
    $('#source-link').hidden = true;
    setAlert('');
  } else if (!state.wallpaper) {
    $('#preview-title').textContent = '等待一张壁纸';
  }
  updateDownloadAvailability();
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function logLevel(line) {
  if (line.includes('✅') || line.includes('成功')) return 'success';
  if (line.includes('❌') || line.includes('异常')) return 'error';
  if (line.includes('⚠️') || line.includes('🚫') || line.includes('🛑') || line.includes('🔁') || line.includes('⏳')) return 'warning';
  return 'info';
}

function renderJobLogs(logs) {
  const entries = (logs || []).slice(-80);
  const summary = $('#job-log-summary');
  const button = $('#job-log-button');
  summary.textContent = entries.at(-1) || '等待下载器返回状态';
  button.hidden = entries.length === 0;
  $('#job-log').innerHTML = entries.map((line) => {
    const level = logLevel(line);
    return `<div class="log-entry is-${level}"><span class="log-level">${level}</span><span class="log-message">${escapeHtml(line)}</span></div>`;
  }).join('');
  const dialog = $('#log-dialog');
  if (dialog.open) {
    const list = $('#job-log');
    list.scrollTop = list.scrollHeight;
  }
}

function renderMedia(url, video, local = false) {
  const frame = $('#media-frame');
  frame.classList.remove('is-empty');
  frame.querySelector('.empty-media')?.remove();
  frame.querySelector('img, video')?.remove();
  const media = document.createElement(video ? 'video' : 'img');
  media.src = url;
  media.controls = video;
  media.autoplay = video;
  media.loop = video;
  media.muted = video;
  media.playsInline = video;
  media.alt = local ? '已下载壁纸预览' : '壁纸预览';
  frame.appendChild(media);
}

function renderWallpaper(wallpaper) {
  state.wallpaper = wallpaper;
  $('#preview-title').textContent = wallpaper.title || `壁纸 ${wallpaper.wtId}`;
  $('#wallpaper-name').textContent = wallpaper.title || `壁纸 ${wallpaper.wtId}`;
  $('#wallpaper-size').textContent = wallpaper.width && wallpaper.height ? `${wallpaper.width} × ${wallpaper.height}` : '—';
  $('#wallpaper-file').textContent = wallpaper.fileMb
    ? (/\b(?:KB|MB|GB)$/i.test(String(wallpaper.fileMb).trim()) ? wallpaper.fileMb : `${wallpaper.fileMb} MB`)
    : '—';
  $('#wallpaper-type').textContent = wallpaper.isVideo ? '动态壁纸' : '静态壁纸';
  $('#wallpaper-labels').innerHTML = wallpaper.labels.map(label => `<span>${escapeHtml(label)}</span>`).join('');
  const source = $('#source-link');
  source.href = wallpaper.detailUrl;
  source.hidden = false;
  // The detail lookup uses the public crop endpoint only for confirmation.
  renderMedia(wallpaper.cropUrl, false);
  downloadButton.disabled = false;
}

function renderJob(job) {
  const previousStatus = state.job?.status;
  state.job = job;
  const panel = $('#job-panel');
  panel.hidden = false;
  const status = $('#job-status');
  const labels = { running: '下载中', completed: '已完成', partial: '部分完成', failed: '失败' };
  status.textContent = labels[job.status] || job.status;
  status.className = `status-badge ${job.status === 'running' ? 'is-running' : job.status === 'completed' ? 'is-done' : job.status === 'partial' ? 'is-warning' : 'is-error'}`;
  const total = Math.max(1, Number(job.total || 1));
  const processed = Math.min(total, Number(job.processedCount || 0));
  const progress = job.status === 'completed' ? 100 : Math.round((processed / total) * 100);
  $('#progress-bar').style.width = `${Math.max(8, progress)}%`;
  $('#progress-bar').classList.toggle('is-done', job.status === 'completed');
  $('#job-quality').textContent = job.quality.toUpperCase();
  const runningCopy = total > 1 && job.currentId
    ? `正在处理第 ${Math.min(Number(job.currentIndex || 0) + 1, total)}/${total} 张 · ID ${job.currentId}`
    : '代理池正在处理任务';
  $('#job-copy').textContent = job.status === 'running'
    ? runningCopy
    : job.status === 'completed'
      ? `${job.succeededCount || 1} 张文件已保存到浏览器下载目录`
      : job.status === 'partial'
        ? `${job.succeededCount || 0} 张成功，${job.failedCount || 0} 张失败`
        : (job.error || '下载失败');
  renderJobLogs(job.logs);
  renderJobResults(job);
  if (previousStatus === 'running' && job.status !== 'running' && state.downloadTriggeredJobId !== job.id) {
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
}

function renderJobResults(job) {
  const results = Array.isArray(job.results) && job.results.length
    ? job.results
    : (job.files || []).length
      ? [{ id: job.wallpaperId, status: 'completed', files: job.files }]
      : [];
  $('#result-list').innerHTML = results.map(result => {
    const status = result.status === 'completed' ? '已完成' : '失败';
    const fileLinks = (result.files || []).map(file => {
      const href = `/api/jobs/${encodeURIComponent(job.id)}/download?file=${encodeURIComponent(file.name)}`;
      return `<a class="result-link" href="${href}" download="${escapeHtml(file.name)}"><span>${escapeHtml(file.name)}</span><small>${formatBytes(file.bytes)} · 下载到本地</small></a>`;
    }).join('');
    return `<div class="result-item is-${result.status === 'completed' ? 'done' : 'error'}"><div class="result-item-head"><strong>ID ${escapeHtml(result.id)}</strong><span>${status}</span></div>${fileLinks || `<p>${escapeHtml(result.error || '未生成文件')}</p>`}</div>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function lookup() {
  const id = idInput.value.trim();
  if (!/^\d+$/.test(id)) return setAlert('请输入数字壁纸 ID。');
  clearInterval(state.polling);
  state.job = null;
  $('#job-panel').hidden = true;
  setAlert('');
  setLoading(downloadButton, true);
  $('#preview-title').textContent = '正在查找…';
  try {
    const response = await fetch(`/api/wallpaper/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '壁纸查询失败');
    renderWallpaper(data.wallpaper);
  } catch (error) {
    state.wallpaper = null;
    updateDownloadAvailability();
    $('#preview-title').textContent = '找不到这张壁纸';
    setAlert(error.message);
  } finally {
    if (!state.wallpaper) setLoading(downloadButton, false);
  }
}

async function startDownload() {
  const ids = state.mode === 'batch' ? state.batchIds : state.wallpaper ? [state.wallpaper.wtId] : [];
  if (!ids.length) return;
  if (ids.length > 100) return setAlert('一次最多下载 100 张壁纸。');
  setAlert('');
  setLoading(downloadButton, true);
  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, quality: state.quality }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '无法创建下载任务');
    renderJob({ ...data.job, logs: [], results: [], files: [] });
    pollJob(data.job.id);
  } catch (error) {
    setAlert(error.message);
    setLoading(downloadButton, false);
  }
}

function pollJob(jobId) {
  clearInterval(state.polling);
  state.polling = setInterval(async () => {
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '任务状态不可用');
      renderJob(data.job);
      if (data.job.status !== 'running') {
        clearInterval(state.polling);
        setLoading(downloadButton, false);
        if (data.job.status === 'failed' || data.job.status === 'partial') setAlert(data.job.error || '部分下载失败');
      }
    } catch (error) {
      clearInterval(state.polling);
      setLoading(downloadButton, false);
      setAlert(error.message);
    }
  }, 700);
}

document.querySelectorAll('.quality-option').forEach((button) => {
  button.addEventListener('click', () => {
    state.quality = button.dataset.quality;
    document.querySelectorAll('.quality-option').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-checked', String(selected));
    });
  });
});

lookupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.mode === 'batch') startDownload();
  else lookup();
});
downloadButton.addEventListener('click', startDownload);
$('#single-mode').addEventListener('click', () => setMode('single'));
$('#batch-mode').addEventListener('click', () => setMode('batch'));
$('#batch-ids').addEventListener('input', updateBatchCount);
$('#job-log-button').addEventListener('click', () => $('#log-dialog').showModal());
$('#close-log-button').addEventListener('click', () => $('#log-dialog').close());
$('#log-dialog').addEventListener('click', (event) => {
  if (event.target === $('#log-dialog')) $('#log-dialog').close();
});
$('#reset-button').addEventListener('click', () => {
  clearInterval(state.polling);
  state.wallpaper = null;
  state.batchIds = [];
  state.job = null;
  state.downloadTriggeredJobId = null;
  idInput.value = '';
  $('#batch-ids').value = '';
  setAlert('');
  setMode('single');
  updateBatchCount();
  updateDownloadAvailability();
  $('#source-link').hidden = true;
  $('#preview-title').textContent = '等待一张壁纸';
  $('#wallpaper-name').textContent = '尚未选择壁纸';
  $('#wallpaper-labels').innerHTML = '';
  $('#wallpaper-size').textContent = '—';
  $('#wallpaper-file').textContent = '—';
  $('#wallpaper-type').textContent = '—';
  $('#job-panel').hidden = true;
  if ($('#log-dialog').open) $('#log-dialog').close();
  $('#media-frame').className = 'media-frame is-empty';
  $('#media-frame').innerHTML = '<div class="media-grid"></div><div class="empty-media"><div class="empty-icon">' + icons.image + '</div><strong>预览区域</strong><span>查找壁纸后在这里查看画面</span></div>';
});

function updateClock() {
  $('#clock').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}
updateClock();
setInterval(updateClock, 30000);
