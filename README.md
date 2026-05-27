# ClipForge 2.0 — YouTube Clip Extractor

A web app to extract clips from YouTube videos as MP4 or MP3.

## Requirements

- Node.js 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your PATH
- [FFmpeg](https://ffmpeg.org/) on your PATH

## Install & Run

```bash
npm install
npm start
```

Open http://localhost:3000

## Deploy to Render / Railway / Fly.io

This is a standard Express app. Set the start command to `node server.js`.
The server needs yt-dlp and ffmpeg available on the host.

## Features

- Paste a YouTube URL → instant preview with embedded player
- Set In/Out points by playing the video and clicking Set In / Set Out
- Dual-handle range slider to visually mark clip boundaries
- Preview just the selected clip range in the player
- Queue multiple clips from the same video
- Export as MP4 (with quality and aspect ratio options) or MP3
- Light/dark mode toggle (persisted in localStorage)
- Server-Sent Events for real-time extraction progress
- Download the finished clip directly from the browser
