const state = {
  wallpaper: null,
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

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
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
  const labels = { running: '下载中', completed: '已完成', failed: '失败' };
  status.textContent = labels[job.status] || job.status;
  status.className = `status-badge ${job.status === 'running' ? 'is-running' : job.status === 'completed' ? 'is-done' : 'is-error'}`;
  $('#progress-bar').classList.toggle('is-done', job.status === 'completed');
  $('#job-quality').textContent = job.quality.toUpperCase();
  $('#job-copy').textContent = job.status === 'running' ? '代理池正在处理任务' : job.status === 'completed' ? '文件已保存到浏览器下载目录' : (job.error || '下载失败');
  $('#job-log').textContent = (job.logs || []).slice(-32).join('\n');
  $('#result-list').innerHTML = (job.files || []).map(file => {
    const href = `/api/jobs/${encodeURIComponent(job.id)}/download?file=${encodeURIComponent(file.name)}`;
    return `<a class="result-link" href="${href}" download="${escapeHtml(file.name)}"><span>${escapeHtml(file.name)}</span><small>${formatBytes(file.bytes)} · 下载到本地</small></a>`;
  }).join('');
  if (previousStatus === 'running' && job.status === 'completed' && state.downloadTriggeredJobId !== job.id) {
    state.downloadTriggeredJobId = job.id;
    const link = document.createElement('a');
    link.href = `/api/jobs/${encodeURIComponent(job.id)}/download?file=${encodeURIComponent(job.files[0].name)}`;
    link.download = job.files[0].name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
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
    downloadButton.disabled = true;
    $('#preview-title').textContent = '找不到这张壁纸';
    setAlert(error.message);
  } finally {
    if (!state.wallpaper) setLoading(downloadButton, false);
  }
}

async function startDownload() {
  if (!state.wallpaper) return;
  setAlert('');
  setLoading(downloadButton, true);
  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: state.wallpaper.wtId, quality: state.quality }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '无法创建下载任务');
    renderJob({ ...data.job, logs: [], files: [] });
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
        if (data.job.status === 'failed') setAlert(data.job.error || '下载失败');
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

lookupForm.addEventListener('submit', (event) => { event.preventDefault(); lookup(); });
downloadButton.addEventListener('click', startDownload);
$('#reset-button').addEventListener('click', () => {
  clearInterval(state.polling);
  state.wallpaper = null;
  state.job = null;
  state.downloadTriggeredJobId = null;
  idInput.value = '';
  setAlert('');
  downloadButton.disabled = true;
  $('#source-link').hidden = true;
  $('#preview-title').textContent = '等待一张壁纸';
  $('#wallpaper-name').textContent = '尚未选择壁纸';
  $('#wallpaper-labels').innerHTML = '';
  $('#wallpaper-size').textContent = '—';
  $('#wallpaper-file').textContent = '—';
  $('#wallpaper-type').textContent = '—';
  $('#job-panel').hidden = true;
  $('#media-frame').className = 'media-frame is-empty';
  $('#media-frame').innerHTML = '<div class="media-grid"></div><div class="empty-media"><div class="empty-icon">' + icons.image + '</div><strong>预览区域</strong><span>查找壁纸后在这里查看画面</span></div>';
});

function updateClock() {
  $('#clock').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}
updateClock();
setInterval(updateClock, 30000);
