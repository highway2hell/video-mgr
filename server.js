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

function normalizeDirs() {
  return (config.mediaDirs || [])
    .map((d) => {
      if (typeof d === 'string' && d) {
        return { name: path.basename(d) || d, path: d };
      }
      if (d && typeof d === 'object' && d.path) {
        return { name: d.name || path.basename(d.path) || d.path, path: d.path };
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

async function walkDir(dir, category, movies, scanErrors) {
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
      await walkDir(fullPath, category, movies, scanErrors);
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
        category,
      });
    }
  }
}

async function scan() {
  const movies = [];
  const scanErrors = [];

  for (const d of normalizeDirs()) {
    await walkDir(d.path, d.name, movies, scanErrors);
  }

  movies.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  movies.forEach((m, i) => {
    m.id = i;
  });

  return { movies, scanErrors };
}

let movies = [];
let scanErrors = [];

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

function probeDuration(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null);
    execFile(ffmpegPath, ['-i', filePath], { timeout: 30000 }, (err, stdout, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr || '');
      if (!m) return resolve(null);
      const sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
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
    })),
    count: movies.length,
    categories,
    scanErrors,
    mediaDirs: dirs,
  };
}

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
  movies = result.movies;
  scanErrors = result.scanErrors;
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
  movies = result.movies;
  scanErrors = result.scanErrors;
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
  movies.forEach((m, i) => {
    m.id = i;
  });
  res.json(movieSummary());
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

async function startup() {
  if (config.scanOnStart) {
    const result = await scan();
    movies = result.movies;
    scanErrors = result.scanErrors;
  }

  try {
    app.listen(config.port, () => {
      console.log('Movie Wall running at http://localhost:' + config.port);
      console.log('Scanning media dirs:');
      for (const d of normalizeDirs()) {
        console.log('  - ' + d.name + ' (' + d.path + ')');
      }
      console.log('Found ' + movies.length + ' video(s).');
    });
  } catch (err) {
    console.error('Failed to start server on port ' + config.port + ': ' + err.message);
    console.error('The port may already be in use (EADDRINUSE).');
    process.exit(1);
  }

  generateThumbnails();
}

startup();
