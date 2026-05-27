'use strict';

// ─── State ─────────────────────────────────────────────────────────────────────
let selectedFormat  = 'mp4';
let selectedQuality = 'best';
let selectedAspect  = 'original';
let isProcessing    = false;
let videoDuration   = 0;
let ytPlayer        = null;
let playerReady     = false;
let currentJobId    = null;
let progressSource  = null;
let clips           = [];
let clipCounter     = 0;
let previewClipMode = false;
let previewClipEnd  = null;
let timelineInterval = null;

const ASPECT_HINTS = {
  'original': null,
  '9:16':  'Smart crop to vertical (9:16) — ideal for TikTok, Instagram Reels, and YouTube Shorts.',
  '1:1':   'Cropped to a square (1:1) — best for Instagram feed posts.',
  '4:5':   'Portrait crop (4:5) — Instagram\'s recommended portrait feed ratio.',
  '16:9':  'Standard widescreen (16:9) — YouTube, presentations, most screens.',
};

// ─── DOM refs ───────────────────────────────────────────────────────────────────
const urlInput        = document.getElementById('urlInput');
const pasteBtn        = document.getElementById('pasteBtn');
const previewCard     = document.getElementById('previewCard');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const playerWrap      = document.getElementById('playerWrap');
const videoMeta       = document.getElementById('videoMeta');
const metaThumb       = document.getElementById('metaThumb');
const metaTitle       = document.getElementById('metaTitle');
const metaAuthor      = document.getElementById('metaAuthor');
const metaDuration    = document.getElementById('metaDuration');
const playPauseBtn    = document.getElementById('playPauseBtn');
const playIcon        = document.getElementById('playIcon');
const pauseIcon       = document.getElementById('pauseIcon');
const setInBtn        = document.getElementById('setInBtn');
const setOutBtn       = document.getElementById('setOutBtn');
const previewClipBtn  = document.getElementById('previewClipBtn');
const timelineFilled  = document.getElementById('timelineFilled');
const timelineRange   = document.getElementById('timelineRange');
const timelineThumb   = document.getElementById('timelineThumb');
const timelineBar     = document.getElementById('timelineBar');
const markerIn        = document.getElementById('markerIn');
const markerOut       = document.getElementById('markerOut');
const currentTimeDisplay = document.getElementById('currentTimeDisplay');
const durationDisplay = document.getElementById('durationDisplay');
const startTime       = document.getElementById('startTime');
const endTime         = document.getElementById('endTime');
const rangeIn         = document.getElementById('rangeIn');
const rangeOut        = document.getElementById('rangeOut');
const dualSliderFill  = document.getElementById('dualSliderFill');
const inLabel         = document.getElementById('inLabel');
const outLabel        = document.getElementById('outLabel');
const clipDurationTag = document.getElementById('clipDurationTag');
const addClipBtn      = document.getElementById('addClipBtn');
const clipQueue       = document.getElementById('clipQueue');
const queueEmpty      = document.getElementById('queueEmpty');
const fmtMp4          = document.getElementById('fmtMp4');
const fmtMp3          = document.getElementById('fmtMp3');
const mp4Options      = document.getElementById('mp4Options');
const qualityGroup    = document.getElementById('qualityGroup');
const aspectGroup     = document.getElementById('aspectGroup');
const aspectHint      = document.getElementById('aspectHint');
const aspectHintText  = document.getElementById('aspectHintText');
const extractBtn      = document.getElementById('extractBtn');
const btnText         = document.getElementById('btnText');
const statusPanel     = document.getElementById('statusPanel');
const statusIcon      = document.getElementById('statusIcon');
const statusMessage   = document.getElementById('statusMessage');
const progressWrap    = document.getElementById('progressWrap');
const progressBar     = document.getElementById('progressBar');
const progressLabel   = document.getElementById('progressLabel');
const resultBox       = document.getElementById('resultBox');
const downloadLink    = document.getElementById('downloadLink');
const depStatus       = document.getElementById('depStatus');
const depDot          = depStatus.querySelector('.dep-dot');
const depLabel        = depStatus.querySelector('.dep-label');
const depBanner       = document.getElementById('depBanner');
const depBannerText   = document.getElementById('depBannerText');
const stageFetch      = document.getElementById('stageFetch');
const stageExtract    = document.getElementById('stageExtract');
const stageDone       = document.getElementById('stageDone');
const themeToggle     = document.getElementById('themeToggle');

// ─── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkDeps();
  setupTimestampMask(startTime);
  setupTimestampMask(endTime);
  setupRangeSliders();
  applyTheme(localStorage.getItem('cf-theme') || 'dark');
});

// ─── Theme toggle ───────────────────────────────────────────────────────────────
themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('cf-theme', next);
});

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
}

// ─── Dep check ──────────────────────────────────────────────────────────────────
async function checkDeps() {
  try {
    const res = await fetch('/api/deps');
    const deps = await res.json();
    const ok = deps.ytdlp.ok && deps.ffmpeg.ok;
    depDot.className = 'dep-dot ' + (ok ? 'ok' : 'error');
    depLabel.textContent = ok ? 'Ready' : 'Missing deps';
    if (!ok) {
      const missing = [];
      if (!deps.ytdlp.ok) missing.push('yt-dlp');
      if (!deps.ffmpeg.ok) missing.push('FFmpeg');
      depBannerText.textContent = `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not installed. Please install before extracting.`;
      depBanner.classList.remove('hidden');
    }
  } catch (e) {
    depDot.className = 'dep-dot error';
    depLabel.textContent = 'Server offline';
  }
}

// ─── YouTube IFrame API ──────────────────────────────────────────────────────────
window.onYouTubeIframeAPIReady = () => {
  // Ready — player created on demand
};

function createPlayer(videoId) {
  playerReady = false;
  if (ytPlayer) {
    try { ytPlayer.destroy(); } catch(e) {}
    ytPlayer = null;
  }

  ytPlayer = new YT.Player('ytPlayer', {
    videoId,
    playerVars: {
      controls: 0,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      disablekb: 1,
      enablejsapi: 1,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
    }
  });
}

function onPlayerReady(event) {
  playerReady = true;
  videoDuration = ytPlayer.getDuration();
  if (videoDuration > 0) {
    setupSlidersForDuration(videoDuration);
    durationDisplay.textContent = formatTime(videoDuration);
    metaDuration.textContent = formatTime(videoDuration);
    // Default: out = end of video or 30s
    const defaultOut = Math.min(30, videoDuration);
    setOutValue(defaultOut);
  }
  startTimelineUpdater();
}

function onPlayerStateChange(event) {
  const playing = event.data === YT.PlayerState.PLAYING;
  playIcon.classList.toggle('hidden', playing);
  pauseIcon.classList.toggle('hidden', !playing);

  if (event.data === YT.PlayerState.ENDED) {
    previewClipMode = false;
  }
}

function startTimelineUpdater() {
  if (timelineInterval) clearInterval(timelineInterval);
  timelineInterval = setInterval(() => {
    if (!playerReady || !ytPlayer) return;
    const t = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 1;
    const pct = (t / dur) * 100;
    timelineFilled.style.width = pct + '%';
    timelineThumb.style.left = pct + '%';
    currentTimeDisplay.textContent = formatTime(t);

    // Preview clip mode — stop at out point
    if (previewClipMode && previewClipEnd !== null && t >= previewClipEnd) {
      ytPlayer.pauseVideo();
      previewClipMode = false;
    }
  }, 200);
}

// Click on timeline to seek
timelineBar.addEventListener('click', (e) => {
  if (!playerReady) return;
  const rect = timelineBar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  ytPlayer.seekTo(pct * videoDuration, true);
});

// ─── URL input → auto-load ───────────────────────────────────────────────────────
let urlDebounce = null;

urlInput.addEventListener('input', () => {
  clearTimeout(urlDebounce);
  urlInput.classList.remove('error-state');
  urlDebounce = setTimeout(() => {
    const url = urlInput.value.trim();
    if (isValidYouTubeUrl(url)) {
      loadVideo(url);
    }
  }, 600);
});

urlInput.addEventListener('paste', (e) => {
  clearTimeout(urlDebounce);
  // Read from clipboard event or wait for input
  urlDebounce = setTimeout(() => {
    const url = urlInput.value.trim();
    if (isValidYouTubeUrl(url)) loadVideo(url);
  }, 100);
});

pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text.trim();
    urlInput.classList.remove('error-state');
    if (isValidYouTubeUrl(urlInput.value)) loadVideo(urlInput.value);
  } catch (e) {}
});

async function loadVideo(url) {
  const videoId = extractVideoId(url);
  if (!videoId) return;

  // Show player, hide placeholder
  previewPlaceholder.classList.add('hidden');
  playerWrap.classList.remove('hidden');

  // Load metadata via oEmbed
  try {
    const oembedUrl = `https://www.youtube-nocookie.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(`/api/oembed?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      metaTitle.textContent = data.title || '';
      metaAuthor.textContent = data.author_name || '';
      if (data.thumbnail_url) metaThumb.src = data.thumbnail_url;
      videoMeta.classList.remove('hidden');
    }
  } catch (e) {}

  // Create/reload player
  if (typeof YT !== 'undefined' && YT.Player) {
    createPlayer(videoId);
  } else {
    // YT API not ready yet, wait
    const wait = setInterval(() => {
      if (typeof YT !== 'undefined' && YT.Player) {
        clearInterval(wait);
        createPlayer(videoId);
      }
    }, 200);
  }
}

// ─── Player controls ─────────────────────────────────────────────────────────────
playPauseBtn.addEventListener('click', () => {
  if (!playerReady) return;
  const state = ytPlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
  else ytPlayer.playVideo();
});

setInBtn.addEventListener('click', () => {
  if (!playerReady) return;
  const t = ytPlayer.getCurrentTime();
  setInValue(t);
});

setOutBtn.addEventListener('click', () => {
  if (!playerReady) return;
  const t = ytPlayer.getCurrentTime();
  setOutValue(t);
});

previewClipBtn.addEventListener('click', () => {
  if (!playerReady) return;
  const inSec = parseTimestamp(startTime.value) || 0;
  const outSec = parseTimestamp(endTime.value) || videoDuration;
  previewClipMode = true;
  previewClipEnd = outSec;
  ytPlayer.seekTo(inSec, true);
  ytPlayer.playVideo();
});

// ─── Range sliders ────────────────────────────────────────────────────────────────
function setupRangeSliders() {
  rangeIn.addEventListener('input', () => {
    const inVal = parseInt(rangeIn.value);
    const outVal = parseInt(rangeOut.value);
    if (inVal >= outVal) { rangeIn.value = outVal - 1; return; }
    updateFromSliders();
  });

  rangeOut.addEventListener('input', () => {
    const inVal = parseInt(rangeIn.value);
    const outVal = parseInt(rangeOut.value);
    if (outVal <= inVal) { rangeOut.value = inVal + 1; return; }
    updateFromSliders();
  });
}

function setupSlidersForDuration(dur) {
  videoDuration = dur;
  rangeIn.max = 1000;
  rangeOut.max = 1000;
  rangeIn.value = 0;
  rangeOut.value = Math.round((Math.min(30, dur) / dur) * 1000);
  updateFromSliders();
}

function updateFromSliders() {
  if (videoDuration <= 0) return;
  const inFrac  = parseInt(rangeIn.value)  / 1000;
  const outFrac = parseInt(rangeOut.value) / 1000;
  const inSec   = inFrac  * videoDuration;
  const outSec  = outFrac * videoDuration;

  startTime.value = secondsToTimestamp(inSec);
  endTime.value   = secondsToTimestamp(outSec);
  updateRangeUI(inFrac, outFrac, inSec, outSec);
}

function setInValue(sec) {
  if (videoDuration <= 0) return;
  const frac = sec / videoDuration;
  rangeIn.value = Math.round(frac * 1000);
  startTime.value = secondsToTimestamp(sec);
  const outFrac = parseInt(rangeOut.value) / 1000;
  updateRangeUI(frac, outFrac, sec, outFrac * videoDuration);
}

function setOutValue(sec) {
  if (videoDuration <= 0) return;
  const frac = sec / videoDuration;
  rangeOut.value = Math.round(frac * 1000);
  endTime.value = secondsToTimestamp(sec);
  const inFrac = parseInt(rangeIn.value) / 1000;
  updateRangeUI(inFrac, frac, inFrac * videoDuration, sec);
}

function updateRangeUI(inFrac, outFrac, inSec, outSec) {
  const leftPct  = (inFrac  * 100).toFixed(2) + '%';
  const rightPct = (outFrac * 100).toFixed(2) + '%';
  dualSliderFill.style.left  = leftPct;
  dualSliderFill.style.width = ((outFrac - inFrac) * 100).toFixed(2) + '%';

  // Timeline range overlay
  markerIn.style.left   = leftPct;
  markerOut.style.left  = rightPct;
  timelineRange.style.left  = leftPct;
  timelineRange.style.width = ((outFrac - inFrac) * 100).toFixed(2) + '%';

  inLabel.textContent  = secondsToTimestamp(inSec);
  outLabel.textContent = secondsToTimestamp(outSec);

  const dur = outSec - inSec;
  clipDurationTag.textContent = dur >= 60
    ? `${Math.floor(dur/60)}m ${Math.round(dur%60)}s`
    : `${Math.round(dur)}s`;
}

// Manual time field edits sync to sliders
startTime.addEventListener('change', () => {
  const sec = parseTimestamp(startTime.value);
  if (sec !== null && videoDuration > 0) setInValue(Math.min(sec, videoDuration));
});

endTime.addEventListener('change', () => {
  const sec = parseTimestamp(endTime.value);
  if (sec !== null && videoDuration > 0) setOutValue(Math.min(sec, videoDuration));
});

// ─── Clip queue ────────────────────────────────────────────────────────────────────
addClipBtn.addEventListener('click', () => {
  const inTime  = startTime.value.trim() || '00:00:00';
  const outTime = endTime.value.trim()   || '00:00:30';
  if (!inTime || !outTime) return;

  clipCounter++;
  clips.push({ id: clipCounter, inTime, outTime });
  renderQueue();
});

function renderQueue() {
  if (clips.length === 0) {
    queueEmpty.style.display = '';
    clipQueue.querySelectorAll('.queue-item').forEach(el => el.remove());
    return;
  }
  queueEmpty.style.display = 'none';

  // Re-render all
  clipQueue.querySelectorAll('.queue-item').forEach(el => el.remove());
  clips.forEach((clip, i) => {
    const inSec  = parseTimestamp(clip.inTime)  || 0;
    const outSec = parseTimestamp(clip.outTime) || 0;
    const durSec = outSec - inSec;
    const durLabel = durSec >= 60
      ? `${Math.floor(durSec/60)}m ${Math.round(durSec%60)}s`
      : `${Math.round(durSec)}s`;

    const item = document.createElement('div');
    item.className = 'queue-item';
    item.dataset.id = clip.id;
    item.innerHTML = `
      <div class="queue-item-num">${i+1}</div>
      <div class="queue-item-times">${clip.inTime} → ${clip.outTime}</div>
      <div class="queue-item-dur">${durLabel}</div>
      <div class="queue-item-btns">
        <button class="queue-action-btn load-btn" title="Load this clip">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polygon points="2,1 10,6 2,11" fill="currentColor"/></svg>
        </button>
        <button class="queue-action-btn danger del-btn" title="Remove">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;

    item.querySelector('.load-btn').addEventListener('click', () => {
      startTime.value = clip.inTime;
      endTime.value   = clip.outTime;
      if (videoDuration > 0) {
        setInValue(parseTimestamp(clip.inTime) || 0);
        setOutValue(parseTimestamp(clip.outTime) || 0);
      }
      if (playerReady) ytPlayer.seekTo(parseTimestamp(clip.inTime) || 0, true);
    });

    item.querySelector('.del-btn').addEventListener('click', () => {
      clips = clips.filter(c => c.id !== clip.id);
      renderQueue();
    });

    clipQueue.appendChild(item);
  });
}

// ─── Format / Quality / Aspect ────────────────────────────────────────────────────
fmtMp4.addEventListener('click', () => setFormat('mp4'));
fmtMp3.addEventListener('click', () => setFormat('mp3'));

function setFormat(fmt) {
  selectedFormat = fmt;
  fmtMp4.classList.toggle('active', fmt === 'mp4');
  fmtMp3.classList.toggle('active', fmt === 'mp3');
  mp4Options.classList.toggle('hidden', fmt !== 'mp4');
}

qualityGroup.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  qualityGroup.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  selectedQuality = pill.dataset.quality;
});

aspectGroup.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  aspectGroup.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  selectedAspect = pill.dataset.aspect;

  const hint = ASPECT_HINTS[selectedAspect];
  if (hint) {
    aspectHintText.textContent = hint;
    aspectHint.classList.remove('hidden');
  } else {
    aspectHint.classList.add('hidden');
  }
});

// ─── Timestamp mask ────────────────────────────────────────────────────────────────
function setupTimestampMask(input) {
  input.addEventListener('input', () => {
    let val = input.value.replace(/[^0-9]/g, '');
    if (val.length > 6) val = val.slice(0, 6);
    let formatted = '';
    if (val.length <= 2) formatted = val;
    else if (val.length <= 4) formatted = val.slice(0,2) + ':' + val.slice(2);
    else formatted = val.slice(0,2) + ':' + val.slice(2,4) + ':' + val.slice(4);
    input.value = formatted;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && input.value.endsWith(':')) {
      e.preventDefault();
      input.value = input.value.slice(0, -1);
    }
  });
}

// ─── Extract ────────────────────────────────────────────────────────────────────────
extractBtn.addEventListener('click', async () => {
  if (isProcessing) return;

  clearErrors();
  hideResult();

  const url   = urlInput.value.trim();
  const start = startTime.value.trim();
  const end   = endTime.value.trim();

  if (!url)                     return showFieldError(urlInput, 'Please enter a YouTube URL.');
  if (!isValidYouTubeUrl(url))  return showFieldError(urlInput, 'Please enter a valid YouTube URL.');
  if (!start)                   return showFieldError(startTime, 'Please enter a start time.');
  if (!end)                     return showFieldError(endTime, 'Please enter an end time.');
  if (!isValidTimestamp(start)) return showFieldError(startTime, 'Invalid start time. Use HH:MM:SS format.');
  if (!isValidTimestamp(end))   return showFieldError(endTime, 'Invalid end time. Use HH:MM:SS format.');

  const startSec = parseTimestamp(start);
  const endSec   = parseTimestamp(end);
  if (endSec <= startSec) return showFieldError(endTime, 'End time must be after start time.');

  isProcessing = true;
  setButtonLoading(true);
  showStatusPanel('processing', 'Starting extraction…', 0);
  resetStages();

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        startTime: normalizeTimestamp(start),
        endTime:   normalizeTimestamp(end),
        format:    selectedFormat,
        quality:   selectedQuality,
        aspect:    selectedAspect,
      }),
    });

    const { jobId, error } = await res.json();
    if (!res.ok || !jobId) {
      throw new Error(error || 'Failed to start extraction.');
    }

    currentJobId = jobId;
    listenToProgress(jobId);

  } catch (err) {
    isProcessing = false;
    setButtonLoading(false);
    showStatusPanel('error', err.message, null);
  }
});

function listenToProgress(jobId) {
  if (progressSource) progressSource.close();
  progressSource = new EventSource(`/api/jobs/${jobId}/progress`);

  progressSource.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.stage) {
      if (data.stage === 'fetch')   setStage('fetch');
      if (data.stage === 'extract') setStage('extract');
      if (data.stage === 'done')    setStage('done');
    }

    if (data.progress !== undefined) setProgress(data.progress);
    if (data.message) statusMessage.textContent = data.message;

    if (data.status === 'done') {
      progressSource.close();
      progressSource = null;
      isProcessing = false;
      setButtonLoading(false);
      showStatusPanel('success', 'Clip ready to download!', 100);
      showResult(jobId);
    } else if (data.status === 'error') {
      progressSource.close();
      progressSource = null;
      isProcessing = false;
      setButtonLoading(false);
      showStatusPanel('error', data.error || 'An unknown error occurred.', null);
    }
  };

  progressSource.onerror = () => {
    if (!isProcessing) return;
    progressSource.close();
    progressSource = null;
    isProcessing = false;
    setButtonLoading(false);
    showStatusPanel('error', 'Connection to server lost.', null);
  };
}

// ─── Validation helpers ────────────────────────────────────────────────────────────
function isValidYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/)/.test(url);
}

function isValidTimestamp(ts) {
  return /^\d{1,2}(:\d{2}){0,2}$/.test(ts);
}

function normalizeTimestamp(ts) {
  const parts = ts.split(':').map(s => s.padStart(2, '0'));
  while (parts.length < 3) parts.unshift('00');
  return parts.join(':');
}

function parseTimestamp(ts) {
  if (!ts) return null;
  const parts = ts.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function extractVideoId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function secondsToTimestamp(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [h, m, ss].map(v => String(v).padStart(2, '0')).join(':');
}

function formatTime(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${m}:${String(ss).padStart(2,'0')}`;
}

// ─── UI helpers ────────────────────────────────────────────────────────────────────
function showFieldError(input, msg) {
  input.classList.add('error-state');
  showStatusPanel('error', msg, null);
  input.focus();
}

function clearErrors() {
  [urlInput, startTime, endTime].forEach(el => el.classList.remove('error-state'));
}

function setButtonLoading(loading) {
  extractBtn.disabled = loading;
  if (loading) {
    btnText.textContent = 'Processing…';
    extractBtn.querySelector('svg').outerHTML;
    extractBtn.innerHTML = `<div class="spinner"></div><span id="btnText">Processing…</span>`;
  } else {
    extractBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><polygon points="5,2 15,9 5,16" fill="currentColor"/><line x1="1" y1="2" x2="1" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span id="btnText">Extract Clip</span>`;
  }
}

function showStatusPanel(type, message, percent) {
  statusPanel.classList.remove('hidden', 'is-error');
  resultBox.classList.add('hidden');
  statusMessage.textContent = message;

  if (type === 'processing') {
    statusIcon.innerHTML = `<div class="spinner"></div>`;
    if (percent !== null) setProgress(percent);
    progressWrap.classList.remove('hidden');
  } else if (type === 'success') {
    statusIcon.innerHTML = `<span class="check-icon"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9" stroke-width="1.5"/><path d="M7 11l3 3 5-5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    setProgress(100);
    progressWrap.classList.remove('hidden');
  } else if (type === 'error') {
    statusPanel.classList.add('is-error');
    statusIcon.innerHTML = `<span class="error-icon"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9" stroke-width="1.5"/><path d="M8 8l6 6M14 8l-6 6" stroke-width="2" stroke-linecap="round"/></svg></span>`;
    progressWrap.classList.add('hidden');
  }
}

function setProgress(percent) {
  progressBar.style.width = `${percent}%`;
  progressLabel.textContent = `${percent}%`;
}

function resetStages() {
  [stageFetch, stageExtract, stageDone].forEach(s => s.classList.remove('active', 'done'));
  document.querySelectorAll('.stage-line').forEach(l => l.classList.remove('done'));
}

function setStage(stage) {
  const lines = document.querySelectorAll('.stage-line');
  if (stage === 'fetch') {
    stageFetch.classList.add('active');
  } else if (stage === 'extract') {
    stageFetch.classList.remove('active');
    stageFetch.classList.add('done');
    stageExtract.classList.add('active');
    if (lines[0]) lines[0].classList.add('done');
  } else if (stage === 'done') {
    stageFetch.classList.add('done');
    stageExtract.classList.remove('active');
    stageExtract.classList.add('done');
    stageDone.classList.add('done');
    lines.forEach(l => l.classList.add('done'));
  }
}

function showResult(jobId) {
  downloadLink.href = `/api/jobs/${jobId}/download`;
  downloadLink.setAttribute('download', '');
  resultBox.classList.remove('hidden');
}

function hideResult() {
  resultBox.classList.add('hidden');
}
