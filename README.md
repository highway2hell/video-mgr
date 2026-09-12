# Movie Wall

A minimal, self-hosted "movie wall" web app. It scans configurable local/NAS
folders for video files and poster images, shows them in a responsive poster
grid in the browser, and streams the selected video through HTML5 `<video>`
with HTTP byte-range support so seeking works.

No transcoding, no database, no build step — just Node.js + Express and a
plain HTML/CSS/JS frontend.

## Requirements

- Node.js (v18+) and npm

## Setup

```bash
npm install
```

## Configuration

Copy `config.example.json` to `config.json` and edit it (the single source of
config — `config.json` is git-ignored so your personal paths stay local):

```json
{
  "port": 3000,
  "mediaDirs": [
    { "name": "Movies", "path": "/path/to/your/movies" },
    { "name": "NAS", "path": "/Volumes/YourNAS/Media" }
  ],
  "videoExtensions": [".mp4", ".mkv", ".avi", ".mov", ".m4v", ".webm", ".ts"],
  "posterNames": ["poster", "folder", "cover"],
  "posterExtensions": [".jpg", ".jpeg", ".png", ".webp"],
  "generateThumbnails": true,
  "thumbnailSeconds": 60,
  "scanOnStart": true
}
```

- `mediaDirs` — the folders to scan (recursively), each shown as a **category**
  in the UI. Each entry is either a plain path string (category name = folder
  name) or `{ "name": "Display name", "path": "/actual/path" }`. Point these
  at your local drives and NAS mounts. Missing or unreadable folders are
  skipped gracefully and reported in the UI.
- `videoExtensions` — file extensions treated as videos.
- `posterNames` / `posterExtensions` — fallback poster filenames to look for in
  the same folder as each video (e.g. `poster.jpg`, `folder.png`, `cover.webp`).
- `generateThumbnails` — when `true` (default), videos with no poster get a
  frame extracted and saved as `<video-basename>.jpg` next to the video.
- `thumbnailSeconds` — the time offset (seconds) into the video used for the
  extracted frame (default `60`). Videos shorter than this fall back to the
  first frame.
- `scanOnStart` — scan immediately on startup.

### Poster matching

For each video, posters are looked up (in the video's own folder) in this
priority order:

1. `<video-basename>.<posterExt>` (e.g. `Movie.Name.jpg`)
2. `<video-basename>-poster.<posterExt>` (e.g. `Movie.Name-poster.jpg`)
3. Each `posterNames` × `posterExtensions` combination (e.g. `poster.jpg`,
   `folder.jpg`, `cover.png`, …)

The first existing match wins. If no poster is found, a generated text
placeholder is shown instead.

### Generated thumbnails

When `generateThumbnails` is enabled and a bundled `ffmpeg` binary is present
at `bin/ffmpeg`, any video without a poster gets a frame auto-extracted (at
`thumbnailSeconds`) and saved as `<video-basename>.jpg` next to the video. On
later scans that file matches rule #1 above, so generated thumbnails persist
and behave like ordinary posters. Extraction runs in the background — one
video at a time, after each scan — and never blocks the server.

The `bin/ffmpeg` binary is a static ffmpeg 6.0 build from the `ffmpeg-static`
project. If it's missing, re-download it (or `brew install ffmpeg`) and place
it at `bin/ffmpeg`.

## Usage

```bash
npm start
```

Open <http://localhost:3000>. Click a poster to play; press `Esc` or `Close`
to stop and go back. Use the **category chips** at the top to filter by media
folder, type in the search box to filter titles live, and press **Rescan** to
re-scan the folders without restarting.

## Codec caveats

This app uses the browser's native `<video>` element as the only player — there
is no transcoding or server-side remuxing. Playback depends entirely on what
your browser can decode:

- **MP4/H.264 + AAC** plays everywhere.
- **WebM (VP8/VP9 + Opus/Vorbis)** plays in Chrome, Firefox, and Edge, but not
  Safari.
- **MKV** (Matroska) may play if the browser supports it and the inner codecs
  are compatible (Chrome/Firefox are often fine with H.264/AAC inside MKV;
  Safari generally is not).
- **AVI / MOV / M4V / TS** support varies widely by container and codec. MOV
  with H.264/AAC usually plays in Safari/Chrome; AVI and MPEG-TS often do not.

If a video won't play, the fix is to convert it to MP4 (H.264 + AAC) — e.g.:

```bash
ffmpeg -i input.mkv -c:v libx264 -c:a aac -movflags +faststart output.mp4
```

## Endpoints

- `GET /` — the web UI.
- `GET /api/movies` — `{ movies: [{ id, title, size, ext, hasPoster, category, filePath }], count, categories, scanErrors, mediaDirs }`.
- `POST /api/scan` — re-scan synchronously and return the same shape.
- `GET /stream/:id` — byte-range-aware video stream.
- `GET /poster/:id` — poster image (404 if none).

The client only ever sees integer `id`s that map to the in-memory movie array,
so there is no path-traversal surface.
