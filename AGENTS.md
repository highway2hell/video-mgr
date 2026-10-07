# AGENTS.md

## What this is

`vid-mgr` ("Movie Wall") is a working, self-hosted video browser — **not** a
greenfield scaffold (an earlier version of this file claimed the directory was
empty; it never was).

- Scans configured local/NAS folders, shows a poster grid, streams video with
  HTTP byte-range support. Folders holding a numbered run of videos are folded
  into a "series" card that opens an episode list with sequential playback.
- Stack: **Node.js + Express** (`server.js`, single file), plus a zero-build
  vanilla HTML/CSS/JS frontend in `public/`. No database, no bundler, no
  transpiler, no test framework. Dependency list is just `express`.
- `bin/ffmpeg` (git-ignored, ~45 MB static build) is used for thumbnail
  extraction and duration probing; the Docker image symlinks `/usr/bin/ffmpeg`
  there instead.

## Running it

```bash
npm start          # node server.js, serves http://localhost:3000
```

`config.json` (git-ignored, machine-specific, holds personal media paths) is
required — copy `config.example.json` if it is missing. The server scans
synchronously on startup, so the port does not open until the first scan of
~1000 files finishes (a few seconds). Restart it after changing `server.js`;
`public/` changes are picked up on reload.

## Layout

| Path | Role |
| --- | --- |
| `server.js` | Scan, series grouping, config persistence, all API routes |
| `public/index.html` | Grid, single-video player overlay, series view, modals |
| `public/app.js` | All frontend logic (one IIFE, no framework) |
| `public/style.css` | Styling; CSS variables live in `:root` |
| `Dockerfile`, `docker-compose.yml` | Container deploy (NAS mount, read-only config) |

## Things to know before changing code

- **Movie ids are array positions**, reassigned by `applyScan()` / `reindex()`
  on every scan and delete. Never cache an id across a rescan on the frontend;
  resolve the current episode by `filePath` (see `refreshSeriesView`).
- **Series grouping lives in `buildSeries()`** and has a per-category mode
  (`auto` | `force` | `off`, from each `mediaDirs[].mode`; see the README's
  "Series" section). `auto` is deliberately conservative: same folder, ≥2
  numbered files, ≥80 % distinct numbers, and a dense run
  (`max - min + 1 <= distinct * 2`). The density test exists to stop unrelated
  films like `3 Idiots` + `12 Angry Men` being folded together — do not loosen
  it to make a stubborn folder fold; set that category to `force` instead.
- **Episode numbers must stay unique and ascending**; the client sorts by
  `episode`. `assignEpisodes()` hands them out, and numbers above
  `EPISODE_NUMBER_MAX` (9999) fall back to `1..N` because the row badge only
  fits a few digits.
- **History/navigation**: the grid uses `#category=<name>`, a series uses
  `#series/<id>`. `route()` handles both; deep links deliberately do not
  autoplay.
- **Durations are lazy**: only rows scrolled into view are probed, ≤3 ffmpeg
  processes at a time, cached in memory in `durationCache` (server) and
  `durCache` (client). Do not add eager probing over the whole library.
- **`DELETE /api/movies/:id` deletes the real file** and there is no auth. Be
  extremely careful with it in tests — never exercise it against a real media
  directory.

## Verifying changes

There is no test suite. Verify with the API and a browser:

```bash
node --check server.js && node --check public/app.js
curl -s localhost:3000/api/movies | head -c 400
```

The frontend has no DOM test harness; when you touch `public/app.js`, at least
confirm every `getElementById` target exists in `index.html` and load the page
in a browser. Keep `README.md` (user-facing) and this file in sync with the
code — an inaccurate AGENTS.md has already misled one agent.
