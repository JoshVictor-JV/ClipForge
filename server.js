const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Job store ────────────────────────────────────────────────────────────────
const jobs = new Map(); // jobId -> { status, progress, filePath, error, clients }

// ─── Resolve binary paths ─────────────────────────────────────────────────────
function resolveBin(name) {
  const candidates = process.platform === 'win32'
    ? [name, name + '.exe', name + '.cmd']
    : [name];

  const extraPaths = process.platform === 'win32'
    ? [
        'C:\\ffmpeg\\bin',
        'C:\\Program Files\\ffmpeg\\bin',
        path.join(os.homedir(), 'scoop', 'shims'),
        path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
      ]
    : [
        '/usr/local/bin', '/usr/bin', '/opt/homebrew/bin',
        path.join(os.homedir(), '.local', 'bin'), '/opt/local/bin',
      ];

  for (const extra of extraPaths) {
    for (const c of candidates) {
      const full = path.join(extra, c);
      if (fs.existsSync(full)) return full;
    }
  }
  return name;
}

const YTDLP = resolveBin('yt-dlp');
const FFMPEG = resolveBin('ffmpeg');

// ─── Dependency check ─────────────────────────────────────────────────────────
function checkBin(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 5000 }, (err, stdout) => {
      resolve({ ok: !err, version: err ? null : stdout.trim().split('\n')[0] });
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseTimestamp(ts) {
  const parts = ts.trim().split(':').map(Number);
  if (parts.some(isNaN)) throw new Error(`Invalid timestamp: "${ts}"`);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
}

function qualityToFmtArg(quality) {
  if (quality === 'best' || !quality) {
    return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
  }
  const h = parseInt(quality);
  return `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`;
}

function aspectToVfFilter(aspect) {
  if (!aspect || aspect === 'original') return null;
  const [wRatio, hRatio] = aspect.split(':').map(Number);
  return [
    `scale='if(gt(iw/ih,${wRatio}/${hRatio}),trunc(oh*${wRatio}/${hRatio}/2)*2,-2)':'if(gt(iw/ih,${wRatio}/${hRatio}),-2,trunc(ow*${hRatio}/${wRatio}/2)*2)'`,
    `crop='if(gt(iw/ih,${wRatio}/${hRatio}),trunc(ih*${wRatio}/${hRatio}/2)*2,iw)':'if(gt(iw/ih,${wRatio}/${hRatio}),ih,trunc(iw*${hRatio}/${wRatio}/2)*2)'`,
  ].join(',');
}

function broadcast(jobId, data) {
  const job = jobs.get(jobId);
  if (!job) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  job.clients.forEach(res => {
    try { res.write(msg); } catch (e) {}
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// oEmbed proxy — avoids CORS issues from the browser
app.get('/api/oembed', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const https = require('https');
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    https.get(oembedUrl, (r) => {
      let body = '';
      r.on('data', c => body += c);
      r.on('end', () => {
        try {
          res.json(JSON.parse(body));
        } catch {
          res.status(500).json({ error: 'Invalid oEmbed response' });
        }
      });
    }).on('error', () => res.status(500).json({ error: 'oEmbed fetch failed' }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Check deps
app.get('/api/deps', async (req, res) => {
  const [ytdlp, ffmpeg] = await Promise.all([checkBin(YTDLP), checkBin(FFMPEG)]);
  res.json({ ytdlp, ffmpeg });
});

// SSE progress stream
app.get('/api/jobs/:jobId/progress', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  job.clients.add(res);

  // Send current state immediately
  res.write(`data: ${JSON.stringify({ type: 'state', ...job })}\n\n`);

  req.on('close', () => {
    job.clients.delete(res);
  });
});

// Start extraction job
app.post('/api/extract', async (req, res) => {
  const { url, startTime, endTime, format, quality, aspect } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  const jobId = uuidv4();
  const job = {
    id: jobId,
    status: 'pending',
    progress: 0,
    message: 'Starting…',
    stage: 'init',
    filePath: null,
    downloadReady: false,
    error: null,
    clients: new Set(),
  };
  jobs.set(jobId, job);
  res.json({ jobId });

  // Run async
  runExtraction(jobId, { url, startTime, endTime, format, quality, aspect });
});

// Download result
app.get('/api/jobs/:jobId/download', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(job.filePath, path.basename(job.filePath), (err) => {
    if (!err) {
      // Clean up after download
      setTimeout(() => {
        try { fs.unlinkSync(job.filePath); } catch {}
        jobs.delete(req.params.jobId);
      }, 60000);
    }
  });
});

// ─── Extraction logic ─────────────────────────────────────────────────────────
async function runExtraction(jobId, options) {
  const { url, startTime, endTime, format, quality, aspect } = options;
  const job = jobs.get(jobId);

  function update(data) {
    Object.assign(job, data);
    broadcast(jobId, { type: 'progress', ...data });
  }

  try {
    const startSec = parseTimestamp(startTime);
    const endSec = parseTimestamp(endTime);
    if (endSec <= startSec) throw new Error('End time must be greater than start time.');
    if (endSec - startSec > 3600) throw new Error('Clip duration cannot exceed 1 hour.');

    update({ stage: 'fetch', message: 'Fetching video info…', progress: 5 });

    // Get title via yt-dlp
    const title = await getVideoTitle(url);
    const safeTitle = sanitizeFilename(title || 'clip');
    const qualityTag = quality && quality !== 'best' ? `_${quality}p` : '';
    const aspectTag = aspect && aspect !== 'original' ? `_${aspect.replace(':', 'x')}` : '';
    const ext = format === 'mp3' ? 'mp3' : 'mp4';
    const outputFile = path.join(os.tmpdir(), `${safeTitle}${qualityTag}${aspectTag}_${Date.now()}.${ext}`);

    update({ stage: 'fetch', message: 'Resolving stream URL…', progress: 15 });

    const streamUrls = await getStreamUrl(url, format, quality);

    update({ stage: 'extract', message: 'Extracting clip…', progress: 30 });

    await runFFmpeg(streamUrls, startTime, endTime, format, aspect, outputFile, (p) => {
      update({
        stage: 'extract',
        message: `Processing… ${p}%`,
        progress: 30 + Math.floor(p * 0.65),
      });
    });

    job.filePath = outputFile;
    job.downloadReady = true;
    update({ stage: 'done', message: 'Clip ready!', progress: 100, status: 'done', downloadReady: true, filePath: outputFile });

  } catch (err) {
    update({ status: 'error', error: err.message, message: err.message });
  }
}

function getVideoTitle(url) {
  return new Promise((resolve) => {
    execFile(YTDLP, ['--get-title', '--no-playlist', url], { timeout: 20000 }, (err, stdout) => {
      resolve(err ? 'clip' : stdout.trim());
    });
  });
}

function getStreamUrl(url, format, quality) {
  return new Promise((resolve, reject) => {
    const fmtArg = format === 'mp3' ? 'bestaudio/best' : qualityToFmtArg(quality);
    execFile(YTDLP, ['--get-url', '--no-playlist', '-f', fmtArg, url], { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr || err.message;
        if (msg.includes('not available') || msg.includes('private')) return reject(new Error('Video is unavailable or private.'));
        if (msg.includes('ENOENT')) return reject(new Error('yt-dlp not found. Please install it.'));
        return reject(new Error('Failed to fetch stream. Check the URL and try again.'));
      }
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (!lines.length) return reject(new Error('No stream URL returned by yt-dlp.'));
      resolve(lines);
    });
  });
}

function runFFmpeg(streamUrls, startTime, endTime, format, aspect, outputFile, onPercent) {
  return new Promise((resolve, reject) => {
    const vf = aspectToVfFilter(aspect);
    let args = [];

    if (format === 'mp3') {
      args = ['-ss', startTime, '-to', endTime, '-i', streamUrls[0], '-q:a', '0', '-map', 'a', '-y', outputFile];
    } else if (streamUrls.length >= 2) {
      args = [
        '-ss', startTime, '-to', endTime, '-i', streamUrls[0],
        '-ss', startTime, '-to', endTime, '-i', streamUrls[1],
        ...(vf ? ['-vf', vf] : ['-c:v', 'copy']),
        '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0',
        '-y', outputFile,
      ];
    } else {
      args = [
        '-ss', startTime, '-to', endTime, '-i', streamUrls[0],
        ...(vf ? ['-vf', vf, '-c:a', 'copy'] : ['-c', 'copy']),
        '-y', outputFile,
      ];
    }

    const proc = spawn(FFMPEG, args);
    let stderr = '';
    let duration = null;

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (!duration) {
        const dm = chunk.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        if (dm) duration = parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);
      }
      const tm = chunk.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (tm && duration) {
        const elapsed = parseInt(tm[1]) * 3600 + parseInt(tm[2]) * 60 + parseFloat(tm[3]);
        onPercent(Math.min(99, Math.floor((elapsed / duration) * 100)));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error('FFmpeg not found. Please install it.'));
      else reject(new Error(`FFmpeg error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) { onPercent(100); resolve(); }
      else {
        let msg = 'FFmpeg failed to process the clip.';
        if (stderr.includes('Invalid data')) msg = 'Invalid stream data. Try a shorter clip or different quality.';
        else if (stderr.includes('HTTP error')) msg = 'Stream download failed. Video may be geo-restricted.';
        reject(new Error(msg));
      }
    });
  });
}

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ClipForge running at http://localhost:${PORT}`);
});
