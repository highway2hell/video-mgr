# Movie Wall

A minimal, self-hosted "movie wall" web app. It scans configurable local/NAS
folders for video files and poster images, shows them in a responsive poster
grid in the browser, and streams the selected video through HTML5 `<video>`
with HTTP byte-range support so seeking works.

Folders that hold a numbered run of videos (`01.mp4`, `02.mp4`, …) are folded
into a single **series card**; opening one leads to a full-page episode list
with sequential playback.

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

## Series (folded folders)

A folder whose videos carry a **dense, numbered run** is shown as one series
card instead of many loose cards:

- Each video's episode number is a leading number (`01.mp4`,
  `10462 Something.mp4`) or, failing that, a trailing one (`Show 1.mp4`).
- At least 2 videos must have a number, at least 80% of those numbers must be
  distinct (two files may share an episode number), and the numbers must be
  dense — the span `max - min + 1` may not exceed twice the number of distinct
  numbers. That density test is what stops unrelated films such as
  `3 Idiots (2009).mp4` and `12 Angry Men (1954).mp4` from being bundled into a
  fake series.
- Videos without a number, and folders that fail the test, stay as standalone
  cards.
- Series are named after their folder. When two folders would produce the same
  name (both called `Videos`, say), the name grows towards the media root —
  `Show · Videos` — until it is unique.

### Folding mode per category

Each entry in `mediaDirs` takes an optional `mode`:

| `mode` | Behaviour |
| --- | --- |
| `auto` (default) | Fold only dense, numbered runs, as described above |
| `force` | Fold **every** folder holding 2+ videos, numbers or not |
| `off` | Never fold this category — every video stays its own card |

`force` is for collections whose files are not usefully numbered (anime with
fansub naming like `[Group] Title - 01 [1080p].mkv`, or TV seasons like
`Show.S01E01.mkv`): the folder becomes one series and the episodes are ordered
by their number first, then by name. Episode numbers are handed out uniquely,
and a folder whose numbers are junk (long IDs or concatenated dates, over 4
digits) is simply numbered `1..N`.

```json
{ "name": "Movies", "path": "/media/movies", "mode": "force" }
```

You do not have to edit the JSON: the **Folders** dialog has a
`折叠：数字序号 / 折叠：强制全部 / 不折叠` dropdown per row, and Save writes it
into `config.json`.

Clicking a series card opens a full-page episode list (`#series/<id>`, so the
browser Back button works) with a player on the left and the episodes on the
right. Episodes play in order and roll on to the next one automatically; a
click jumps straight to that episode. Each row shows its poster (or generated
thumbnail), name, duration and file date.

Durations are probed lazily: only rows scrolled into view are read with
`ffmpeg`, at most three at a time, and the results are cached in memory for the
lifetime of the process — opening a 100-episode folder costs nothing until you
scroll.

## Usage

```bash
npm start
```

Open <http://localhost:3000>. Click a poster to play; press `Esc` or `Close`
to stop and go back. Use the **category chips** at the top to filter by media
folder, type in the search box to filter titles live, and press **Rescan** to
re-scan the folders without restarting. Search matches series names as well as
the names of the episodes inside them.

Chip counts show the number of **cards** in each category (a series counts
once), not the number of video files.

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
- `GET /api/movies` — `{ movies: [{ id, title, size, ext, hasPoster, category, filePath, mtime, seriesId, episode }], series: [{ id, title, dir, category, count, coverId, size, mtime }], count, seriesCount, categories, scanErrors, mediaDirs }`. `seriesId` is `null` for a standalone video.
- `GET /api/series/:id` — `{ series, episodes: [...] }`, episodes ordered by episode number.
- `POST /api/scan` — re-scan synchronously and return the same shape.
- `GET /stream/:id` — byte-range-aware video stream.
- `GET /poster/:id` — poster image (404 if none).
- `GET /api/movies/:id/duration` — duration in seconds (probed with ffmpeg, then cached in memory).
- `POST /api/movies/:id/preview` — one JPEG frame at `{ seconds }` (thumbnail picker).
- `POST /api/movies/:id/thumbnail` — write `<video-basename>.jpg` from `{ seconds }`.
- `POST /api/dirs` — replace and persist `mediaDirs`, then rescan.
- `DELETE /api/movies/:id` — delete the video file (and its generated thumbnail) from disk, then re-index.

The client only ever sees integer `id`s that map to the in-memory movie array,
so there is no path-traversal surface. There is no authentication, though:
anyone who can reach the port can stream and **delete** media files.
