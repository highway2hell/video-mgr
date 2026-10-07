const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const app = express();
app.use(express.json());

let config = null;
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (err) {
  console.error('Failed to load config.json: ' + err.message);
  console.error('Make sure config.json exists next to server.js and contains valid JSON.');
  process.exit(1);
}

const FFMPEG_PATH = path.join(__dirname, 'bin', 'ffmpeg');
const ffmpegPath = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : null;

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
};

const IMAGE_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const QUALITY_TOKENS = new Set([
  '1080p', '2160p', '720p', '480p', '4k', 'bluray', 'blu-ray', 'web-dl',
  'webrip', 'hdrip', 'bdrip', 'x264', 'x265', 'h264', 'h265', 'hevc',
  'remux', 'aac', 'dts', '5.1', '7.1',
]);

function mimeFor(ext) {
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function imageMimeFor(ext) {
  return IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
}

function cleanTitle(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  let title = base
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  title = title.replace(/\s*\(\d{4}\)\s*/g, ' ');
  title = title.replace(/\s+\d{4}\s*$/g, ' ');

  const tokens = title.split(' ').filter((t) => !QUALITY_TOKENS.has(t.toLowerCase()));
  title = tokens.join(' ').replace(/\s+/g, ' ').trim();

  return title || base;
}

function isVideoFile(name) {
  const ext = path.extname(name).toLowerCase();
  return config.videoExtensions.indexOf(ext) !== -1;
}

function isHidden(name) {
  return name.startsWith('.');
}

// Per media directory: "auto" folds only numbered runs, "force" folds every
// folder holding 2+ videos, "off" never folds.
const SERIES_MODES = ['auto', 'force', 'off'];

function normalizeMode(mode) {
  return SERIES_MODES.indexOf(mode) === -1 ? 'auto' : mode;
}

function normalizeDirs() {
  return (config.mediaDirs || [])
    .map((d) => {
      if (typeof d === 'string' && d) {
        return { name: path.basename(d) || d, path: d, mode: 'auto' };
      }
      if (d && typeof d === 'object' && d.path) {
        return {
          name: d.name || path.basename(d.path) || d.path,
          path: d.path,
          mode: normalizeMode(d.mode),
        };
      }
      return null;
    })
    .filter(Boolean);
}

function saveConfig() {
  fs.writeFileSync(
    path.join(__dirname, 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
    'utf8'
  );
}

// How much "gaps" a numbered folder may have and still count as one series:
// max - min + 1 must not exceed count * SERIES_GAP_FACTOR. This keeps a folder
// of real episodes (01, 02, 03 …) together while refusing to bundle unrelated
// films that merely happen to start or end with a number (e.g. "3 Idiots"
// next to "12 Angry Men").
const SERIES_GAP_FACTOR = 2;

// At least this share of the numbered files must carry a distinct number.
// Two files sharing an episode number is fine; every file sharing one number
// (a "2024 …" folder) is not a series.
const SERIES_UNIQUE_RATIO = 0.8;

// Episode numbers above this are treated as junk (hash IDs, concatenated
// dates) and the folder is numbered 1..N instead; the badge has to stay short.
const EPISODE_NUMBER_MAX = 9999;

// The episode number of a video: a leading number (01.mp4, 10462 xxx.mp4) or,
// failing that, a trailing one (Show 1.mp4, Show 2.mp4). Returns null when the
// basename carries no number at all.
function sequenceOf(basenameNoExt) {
  let m = /^(\d+)/.exec(basenameNoExt);
  if (m) return parseInt(m[1], 10);
  m = /(\d+)\s*$/.exec(basenameNoExt);
  if (m) return parseInt(m[1], 10);
  return null;
}

// Fold video files that live in the same folder and carry a dense number into
// one "series" (a season / a numbered collection). Movies that don't qualify
// stay standalone cards. A few repeated numbers are tolerated (two files that
// share an episode number still belong together), but a folder where almost
// every file repeats the same number is not a series — that is what a folder of
// dated or same-year files looks like.
function buildSeries(allMovies) {
  const dirs = normalizeDirs();
  const byDir = new Map();

  for (const m of allMovies) {
    m.seriesId = null;
    m.episode = null;
    const dir = path.dirname(m.filePath);
    let bucket = byDir.get(dir);
    if (!bucket) {
      bucket = [];
      byDir.set(dir, bucket);
    }
    bucket.push(m);
  }

  const pending = [];

  for (const [dir, group] of byDir) {
    if (group.length < 2) continue;

    const mode = normalizeMode(group[0].seriesMode);
    if (mode === 'off') continue;

    const entries = group.map((movie) => ({
      movie,
      seq: sequenceOf(path.basename(movie.filePath, path.extname(movie.filePath))),
    }));

    if (mode === 'auto') {
      const numbered = entries.filter((e) => e.seq != null);
      if (numbered.length < 2) continue;

      const values = numbered.map((n) => n.seq);
      const distinct = new Set(values).size;
      if (distinct < 2 || distinct < numbered.length * SERIES_UNIQUE_RATIO) continue;

      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      if (max - min + 1 > distinct * SERIES_GAP_FACTOR) continue;

      entries.length = 0;
      entries.push.apply(entries, numbered);
    }

    // Numbered files first, in number order; unnumbered ones after them, by
    // title — a forced folder is usually a mix of both.
    entries.sort(
      (a, b) =>
        (a.seq == null ? 1 : 0) - (b.seq == null ? 1 : 0) ||
        (a.seq || 0) - (b.seq || 0) ||
        a.movie.title.localeCompare(b.movie.title)
    );

    // Long IDs and concatenated dates make unusable episode badges (the row
    // only has room for a few digits), so such a folder is numbered 1..N in the
    // order we just sorted instead.
    const maxSeq = entries.reduce((max, e) => (e.seq != null && e.seq > max ? e.seq : max), 0);
    if (maxSeq > EPISODE_NUMBER_MAX) {
      for (const entry of entries) entry.seq = null;
    }

    assignEpisodes(entries);

    pending.push({
      dir,
      category: entries[0].movie.category,
      entries,
      size: entries.reduce((sum, n) => sum + (n.movie.size || 0), 0),
      mtime: Math.max.apply(null, entries.map((n) => n.movie.mtime || 0)),
    });
  }

  nameSeries(pending, dirs);
  pending.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  return pending.map((s, id) => {
    for (const entry of s.entries) {
      entry.movie.seriesId = id;
      entry.movie.episode = entry.episode;
    }
    const cover = s.entries.find((n) => n.movie.posterPath) || s.entries[0];
    return {
      id,
      title: s.title,
      dir: s.dir,
      category: s.category,
      count: s.entries.length,
      coverId: cover.movie.id,
      size: s.size,
      mtime: s.mtime,
    };
  });
}

// Hand out unique, ascending episode numbers. A file keeps its own number while
// that number is still free; duplicates and unnumbered files continue from the
// previous one, so the order stays unambiguous everywhere (clients sort by it).
function assignEpisodes(entries) {
  let next = 1;
  for (const entry of entries) {
    if (entry.seq != null && entry.seq >= next) next = entry.seq;
    entry.episode = next;
    next++;
  }
}

// A series is named after its folder, but folders called "Videos" / "Season 1"
// are common, so when two series would end up with the same name we grow the
// name towards the media root ("Show · Videos") until it is unique again.
function nameSeries(pending, dirs) {
  for (const s of pending) {
    let owner = null;
    for (const d of dirs) {
      if ((s.dir === d.path || s.dir.startsWith(d.path + path.sep)) &&
          (!owner || d.path.length > owner.path.length)) {
        owner = d;
      }
    }
    s.owner = owner;
    s.segs = owner
      ? path.relative(owner.path, s.dir).split(path.sep).filter(Boolean)
      : [path.basename(s.dir) || s.dir];
    s.fallback = owner ? owner.name : (path.basename(s.dir) || s.dir);
    s.title = null;
  }

  const titleAt = (s, depth) => {
    if (!s.segs.length) return s.fallback;
    return s.segs.slice(-depth).join(' · ');
  };

  const maxDepth = Math.max(1, ...pending.map((s) => s.segs.length));
  for (let depth = 1; depth <= maxDepth; depth++) {
    const counts = new Map();
    for (const s of pending) {
      if (s.title) continue;
      const t = titleAt(s, depth);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    for (const s of pending) {
      if (s.title) continue;
      const t = titleAt(s, depth);
      if (counts.get(t) === 1) s.title = t;
    }
  }
  for (const s of pending) {
    if (!s.title) s.title = s.segs.join(' · ') || s.fallback;
  }
}

async function findPoster(videoDir, videoBase) {
  const candidates = [];
  candidates.push(videoBase);
  candidates.push(videoBase + '-poster');
  for (const name of config.posterNames) {
    candidates.push(name);
  }

  const seen = new Set();
  for (const c of candidates) {
    const lower = c.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    for (const ext of config.posterExtensions) {
      const full = path.join(videoDir, c + ext);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

async function walkDir(dir, mediaDir, movies, scanErrors) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    scanErrors.push(dir + ': ' + err.message);
    return;
  }

  for (const entry of entries) {
    if (isHidden(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      await walkDir(fullPath, mediaDir, movies, scanErrors);
    } else if (entry.isFile() && isVideoFile(entry.name)) {
      let stat;
      try {
        stat = await fs.promises.stat(fullPath);
      } catch (err) {
        scanErrors.push(fullPath + ': ' + err.message);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const videoBase = entry.name.slice(0, entry.name.length - ext.length);
      const posterPath = await findPoster(dir, videoBase);

      movies.push({
        title: cleanTitle(entry.name),
        filePath: fullPath,
        posterPath,
        size: stat.size,
        ext,
        category: mediaDir.name,
        seriesMode: mediaDir.mode,
        mtime: stat.mtimeMs,
      });
    }
  }
}

async function scan() {
  const movies = [];
  const scanErrors = [];

  for (const d of normalizeDirs()) {
    await walkDir(d.path, d, movies, scanErrors);
  }

  movies.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  movies.forEach((m, i) => {
    m.id = i;
  });

  return { movies, series: buildSeries(movies), scanErrors };
}

let movies = [];
let series = [];
let scanErrors = [];

// Adopt a fresh scan result as the live index, re-indexing movie ids so that
// series/episode references stay consistent.
function applyScan(result) {
  movies = result.movies;
  series = result.series || [];
  scanErrors = result.scanErrors;
  movies.forEach((m, i) => {
    m.id = i;
  });
}

// Rebuild the series index after the movie array changed in place (deletion).
function reindex() {
  movies.forEach((m, i) => {
    m.id = i;
  });
  series = buildSeries(movies);
}

function thumbPathFor(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  return path.join(dir, base + '.jpg');
}

function extractFrame(filePath, outPath, seconds) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(false);
    const args = [
      '-y',
      '-ss', String(seconds == null ? (config.thumbnailSeconds || 60) : seconds),
      '-i', filePath,
      '-frames:v', '1',
      '-update', '1',
      '-vf', 'scale=640:-2',
      '-q:v', '3',
      outPath,
    ];
    execFile(ffmpegPath, args, { timeout: 60000 }, (err) => {
      if (err) return resolve(false);
      resolve(fs.existsSync(outPath));
    });
  });
}

// Durations are probed lazily (only for episodes the browser actually scrolls
// into view) and cached in memory for the lifetime of the process.
const durationCache = new Map();

function probeDuration(filePath) {
  if (durationCache.has(filePath)) return Promise.resolve(durationCache.get(filePath));
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null);
    execFile(ffmpegPath, ['-i', filePath], { timeout: 30000 }, (err, stdout, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr || '');
      if (!m) return resolve(null);
      const sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
      durationCache.set(filePath, sec);
      resolve(sec);
    });
  });
}

let generatingThumbs = false;

async function generateThumbnails() {
  if (generatingThumbs || config.generateThumbnails === false || !ffmpegPath) return;
  generatingThumbs = true;
  let made = 0;
  try {
    for (const m of movies) {
      if (m.posterPath) continue;
      const outPath = thumbPathFor(m.filePath);
      let ok = await extractFrame(m.filePath, outPath);
      if (!ok) ok = await extractFrame(m.filePath, outPath, 0);
      if (ok) {
        m.posterPath = outPath;
        made++;
      }
    }
  } catch (err) {
    console.error('Thumbnail generation error: ' + err.message);
  } finally {
    generatingThumbs = false;
  }
  if (made > 0) console.log('Generated ' + made + ' thumbnail(s).');
}

function movieSummary() {
  const dirs = normalizeDirs();
  const categories = dirs.map((d) => ({
    name: d.name,
    path: d.path,
    count: movies.filter((m) => m.category === d.name).length,
  }));
  return {
    movies: movies.map((m) => ({
      id: m.id,
      title: m.title,
      size: m.size,
      ext: m.ext,
      hasPoster: !!m.posterPath,
      category: m.category,
      filePath: m.filePath,
      mtime: m.mtime || 0,
      seriesId: m.seriesId == null ? null : m.seriesId,
      episode: m.episode == null ? null : m.episode,
    })),
    series,
    count: movies.length,
    seriesCount: series.length,
    categories,
    scanErrors,
    mediaDirs: dirs,
  };
}

// One series plus its episodes, ordered by episode number.
app.get('/api/series/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = series[id];
  if (!s) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const episodes = movies
    .filter((m) => m.seriesId === id)
    .sort((a, b) => (a.episode || 0) - (b.episode || 0))
    .map((m) => ({
      id: m.id,
      title: m.title,
      size: m.size,
      ext: m.ext,
      hasPoster: !!m.posterPath,
      filePath: m.filePath,
      mtime: m.mtime || 0,
      episode: m.episode,
    }));
  res.json({ series: s, episodes });
});

app.get('/api/movies', (req, res) => {
  res.json(movieSummary());
});

app.get('/api/dirs', (req, res) => {
  res.json({ dirs: normalizeDirs() });
});

app.post('/api/dirs', async (req, res) => {
  const dirs = req.body && req.body.dirs;
  if (!Array.isArray(dirs)) {
    res.status(400).json({ error: 'Expected { dirs: [...] }' });
    return;
  }
  const cleaned = [];
  for (const d of dirs) {
    if (!d || typeof d !== 'object') continue;
    const p = typeof d.path === 'string' ? d.path.trim() : '';
    if (!p) continue;
    cleaned.push({
      name: (typeof d.name === 'string' && d.name.trim()) ? d.name.trim() : (path.basename(p) || p),
      path: p,
      mode: normalizeMode(d.mode),
    });
  }
  config.mediaDirs = cleaned;
  try {
    saveConfig();
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config.json: ' + err.message });
    return;
  }
  const result = await scan();
  applyScan(result);
  res.json(movieSummary());
  generateThumbnails();
});

app.post('/api/scan', async (req, res) => {
  try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (err) {
    res.status(500).json({ error: 'Failed to reload config.json: ' + err.message });
    return;
  }
  const result = await scan();
  applyScan(result);
  res.json(movieSummary());
  generateThumbnails();
});

app.get('/stream/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const movie = movies[id];
  if (!movie) {
    res.status(404).send('Not found');
    return;
  }

  const filePath = movie.filePath;
  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch (err) {
    res.status(404).send('File missing');
    return;
  }

  const contentType = mimeFor(movie.ext);
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).set('Content-Range', 'bytes */' + size).send('Invalid range');
      return;
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : size - 1;

    if (isNaN(start) || isNaN(end) || start > end || start >= size) {
      res.status(416).set('Content-Range', 'bytes */' + size).send('Invalid range');
      return;
    }

    if (end >= size) end = size - 1;

    res.status(206);
    res.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Length', end - start + 1);
    res.set('Content-Type', contentType);

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => {
      res.destroy();
    });
    stream.pipe(res);
    return;
  }

  res.status(200);
  res.set('Content-Length', size);
  res.set('Accept-Ranges', 'bytes');
  res.set('Content-Type', contentType);

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.destroy();
  });
  stream.pipe(res);
});

app.get('/poster/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const movie = movies[id];
  if (!movie || !movie.posterPath) {
    res.status(404).send('Not found');
    return;
  }

  const ext = path.extname(movie.posterPath).toLowerCase();
  res.sendFile(movie.posterPath, {
    headers: { 'Content-Type': imageMimeFor(ext) },
  });
});

app.get('/api/movies/:id/duration', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const movie = movies[id];
  if (!movie) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const duration = await probeDuration(movie.filePath);
  if (duration == null) {
    res.status(500).json({ error: 'Could not read duration' });
    return;
  }
  res.json({ duration });
});

app.post('/api/movies/:id/preview', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const movie = movies[id];
  if (!movie || !ffmpegPath) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const seconds = Number(req.body && req.body.seconds);
  const sec = Number.isFinite(seconds) ? seconds : 0;
  const outPath = path.join(
    os.tmpdir(),
    'vidmgr-preview-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jpg'
  );
  const ok = await extractFrame(movie.filePath, outPath, sec);
  if (!ok) {
    res.status(500).json({ error: 'Preview failed' });
    return;
  }
  res.sendFile(outPath, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
  }, (err) => {
    fs.unlink(outPath, () => {});
  });
});

app.post('/api/movies/:id/thumbnail', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const movie = movies[id];
  if (!movie) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const seconds = Number(req.body && req.body.seconds);
  const sec = Number.isFinite(seconds) ? seconds : (config.thumbnailSeconds || 60);
  const outPath = thumbPathFor(movie.filePath);
  const ok = await extractFrame(movie.filePath, outPath, sec);
  if (!ok) {
    res.status(500).json({ error: 'Thumbnail generation failed' });
    return;
  }
  movie.posterPath = outPath;
  res.json(movieSummary());
});

app.delete('/api/movies/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const movie = movies[id];
  if (!movie) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    await fs.promises.unlink(movie.filePath);
  } catch (err) {
    res.status(500).json({ error: 'Delete failed: ' + err.message });
    return;
  }
  try {
    await fs.promises.unlink(thumbPathFor(movie.filePath));
  } catch (err) {
    // generated thumbnail may not exist; ignore
  }
  movies.splice(id, 1);
  reindex();
  res.json(movieSummary());
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

async function startup() {
  if (config.scanOnStart) {
    applyScan(await scan());
  }

  try {
    app.listen(config.port, () => {
      console.log('Movie Wall running at http://localhost:' + config.port);
      console.log('Scanning media dirs:');
      for (const d of normalizeDirs()) {
        console.log('  - ' + d.name + ' (' + d.path + ')');
      }
      console.log('Found ' + movies.length + ' video(s) in ' + series.length + ' series.');
    });
  } catch (err) {
    console.error('Failed to start server on port ' + config.port + ': ' + err.message);
    console.error('The port may already be in use (EADDRINUSE).');
    process.exit(1);
  }

  generateThumbnails();
}

startup();
