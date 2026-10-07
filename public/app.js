(function () {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const notices = document.getElementById('notices');
  const searchInput = document.getElementById('search');
  const rescanBtn = document.getElementById('rescan');
  const categoriesEl = document.getElementById('categories');
  const player = document.getElementById('player');
  const video = document.getElementById('video');
  const playerTitle = document.getElementById('player-title');
  const closeBtn = document.getElementById('close');

  const seriesView = document.getElementById('series-view');
  const seriesBack = document.getElementById('series-back');
  const seriesTitle = document.getElementById('series-title');
  const seriesSub = document.getElementById('series-sub');
  const seriesPlayAll = document.getElementById('series-playall');
  const seriesVideo = document.getElementById('series-video');
  const seriesNowTitle = document.getElementById('series-now-title');
  const seriesNowMeta = document.getElementById('series-now-meta');
  const seriesPrev = document.getElementById('series-prev');
  const seriesNext = document.getElementById('series-next');
  const seriesList = document.getElementById('series-list');

  const ctxMenu = document.getElementById('ctxmenu');
  const ctxRethumb = document.getElementById('ctx-rethumb');
  const ctxDelete = document.getElementById('ctx-delete');

  const thumbModal = document.getElementById('thumb-modal');
  const thumbTitle = document.getElementById('thumb-title');
  const thumbPreview = document.getElementById('thumb-preview');
  const thumbSlider = document.getElementById('thumb-slider');
  const thumbTimeLabel = document.getElementById('thumb-time-label');
  const thumbDuration = document.getElementById('thumb-duration');
  const thumbApply = document.getElementById('thumb-apply');
  const thumbClose = document.getElementById('thumb-close');

  const foldersBtn = document.getElementById('folders');
  const dirsModal = document.getElementById('dirs-modal');
  const dirsClose = document.getElementById('dirs-close');
  const dirsList = document.getElementById('dirs-list');
  const dirsAdd = document.getElementById('dirs-add');
  const dirsSave = document.getElementById('dirs-save');

  let movies = [];
  let series = [];
  let categories = [];
  let mediaDirs = [];
  let cards = [];
  let selectedCategory = null;
  let activeSeriesId = null;
  let currentEpisode = null; // { id, filePath, title, episode, mtime, hasPoster }
  let dataLoaded = false;
  let lastSignature = '';
  let ctxTarget = null;
  let thumbDurationSec = 0;
  let previewTimer = null;
  let deleteArmed = false;
  let deleteArmTimer = null;
  let posterVersion = 0;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function formatDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function renderNotices(scanErrors, dirs) {
    const parts = [];
    if (scanErrors && scanErrors.length) {
      parts.push('Could not read: ' + scanErrors.map(escapeHtml).join('; '));
    }
    if (!dirs || dirs.length === 0) {
      parts.push('No media directories configured.');
    }
    if (parts.length) {
      notices.hidden = false;
      notices.textContent = parts.join(' ');
    } else {
      notices.hidden = true;
    }
  }

  // ---------------------------------------------------------------- data ----

  function episodesOf(seriesId) {
    return movies
      .filter((m) => m.seriesId === seriesId)
      .sort((a, b) => (a.episode || 0) - (b.episode || 0));
  }

  // The grid shows one card per series plus one card per standalone video.
  function buildCards() {
    const out = [];
    for (const s of series) {
      out.push({
        type: 'series',
        id: s.id,
        title: s.title,
        size: s.size,
        mtime: s.mtime,
        category: s.category,
        count: s.count,
        coverId: s.coverId,
        dir: s.dir,
        episodes: episodesOf(s.id),
      });
    }
    for (const m of movies) {
      if (m.seriesId != null) continue;
      out.push({
        type: 'movie',
        id: m.id,
        title: m.title,
        size: m.size,
        mtime: m.mtime,
        category: m.category,
        movie: m,
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return out;
  }

  function signature(data) {
    const withImg = (data.movies || []).filter((m) => m.hasPoster).length;
    const cats = (data.categories || []).map((c) => c.name + ':' + c.count).join(',');
    return (data.count || 0) + '|' + (data.seriesCount || 0) + '|' + withImg + '|' + cats;
  }

  function applyData(data, force) {
    dataLoaded = true;
    const sig = signature(data);
    if (!force && sig === lastSignature) return;
    lastSignature = sig;
    movies = data.movies || [];
    series = data.series || [];
    categories = data.categories || [];
    mediaDirs = data.mediaDirs || [];
    cards = buildCards();
    renderNotices(data.scanErrors, data.mediaDirs);

    if (activeSeriesId != null) {
      if (!series[activeSeriesId]) {
        goToGrid();
      } else {
        refreshSeriesView();
      }
      return;
    }

    if (selectedCategory && !categories.some((c) => c.name === selectedCategory)) {
      setSelectedCategory(null);
    }
    renderCategories();
    renderGrid();
  }

  async function loadMovies(force) {
    try {
      const res = await fetch('/api/movies');
      const data = await res.json();
      applyData(data, force);
    } catch (err) {
      notices.hidden = false;
      notices.textContent = 'Failed to reach the server: ' + err.message;
    }
  }

  // ---------------------------------------------------------------- grid ----

  function parseCategory() {
    const m = location.hash.match(/^#category=(.+)$/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (err) {
      return null;
    }
  }

  function setSelectedCategory(value) {
    selectedCategory = value;
    const hash = value == null ? '' : '#category=' + encodeURIComponent(value);
    if (location.hash !== hash) {
      history.replaceState(null, '', hash || location.pathname + location.search);
    }
  }

  function selectCategory(value) {
    setSelectedCategory(value);
    renderCategories();
    renderGrid();
  }

  function categoryChip(label, value, active, count) {
    const b = document.createElement('button');
    b.className = 'chip' + (active ? ' chip-active' : '');
    b.textContent = count != null ? label + ' (' + count + ')' : label;
    b.addEventListener('click', () => selectCategory(value));
    return b;
  }

  function renderCategories() {
    categoriesEl.innerHTML = '';

    categoriesEl.appendChild(categoryChip('All', null, selectedCategory === null, cards.length));

    for (const c of categories) {
      const count = cards.filter((card) => card.category === c.name).length;
      categoriesEl.appendChild(categoryChip(c.name, c.name, selectedCategory === c.name, count));
    }
  }

  function matches(card, query) {
    if (!query) return true;
    if (card.title.toLowerCase().includes(query)) return true;
    if (card.type === 'series') {
      return card.episodes.some((e) => e.title.toLowerCase().includes(query));
    }
    return false;
  }

  function renderGrid() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = cards.filter((card) => {
      const matchCategory = selectedCategory === null || card.category === selectedCategory;
      return matchCategory && matches(card, query);
    });

    grid.innerHTML = '';

    for (const card of filtered) {
      grid.appendChild(card.type === 'series' ? seriesCard(card) : movieCard(card));
    }

    empty.hidden = filtered.length > 0;
  }

  function placeholder(title) {
    const div = document.createElement('div');
    div.className = 'card-placeholder';
    div.textContent = title;
    return div;
  }

  function posterNode(id, title, hasPoster) {
    const wrap = document.createElement('div');
    wrap.className = 'card-img-wrap';

    if (hasPoster) {
      const img = document.createElement('img');
      img.className = 'card-img';
      img.loading = 'lazy';
      img.alt = title;
      img.src = '/poster/' + id + (posterVersion ? '?v=' + posterVersion : '');
      img.addEventListener('error', () => {
        img.replaceWith(placeholder(title));
      });
      wrap.appendChild(img);
    } else {
      wrap.appendChild(placeholder(title));
    }
    return wrap;
  }

  function attachContextMenu(el, movie) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      disarmDelete();
      ctxTarget = movie;
      ctxMenu.hidden = false;
      const x = Math.min(e.clientX, window.innerWidth - 200);
      const y = Math.min(e.clientY, window.innerHeight - 110);
      ctxMenu.style.left = x + 'px';
      ctxMenu.style.top = y + 'px';
    });
  }

  function movieCard(card) {
    const el = document.createElement('div');
    el.className = 'card';

    el.appendChild(posterNode(card.id, card.title, card.movie.hasPoster));

    const caption = document.createElement('div');
    caption.className = 'card-caption';

    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = card.title;

    const metaEl = document.createElement('div');
    metaEl.className = 'card-size';
    metaEl.textContent = formatSize(card.size);

    caption.appendChild(titleEl);
    caption.appendChild(metaEl);
    el.appendChild(caption);

    const tooltip = document.createElement('div');
    tooltip.className = 'card-tooltip';
    tooltip.textContent = card.movie.filePath;
    el.appendChild(tooltip);

    el.addEventListener('click', () => openPlayer(card.movie));
    attachContextMenu(el, card.movie);
    return el;
  }

  function seriesCard(card) {
    const el = document.createElement('div');
    el.className = 'card card-series';

    const wrap = posterNode(card.coverId, card.title, true);
    const badge = document.createElement('div');
    badge.className = 'card-badge';
    badge.textContent = card.count + ' 集';
    wrap.appendChild(badge);
    el.appendChild(wrap);

    const caption = document.createElement('div');
    caption.className = 'card-caption';

    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = card.title;

    const metaEl = document.createElement('div');
    metaEl.className = 'card-size';
    metaEl.textContent = card.count + ' 集 · ' + formatSize(card.size);

    caption.appendChild(titleEl);
    caption.appendChild(metaEl);
    el.appendChild(caption);

    const tooltip = document.createElement('div');
    tooltip.className = 'card-tooltip';
    tooltip.textContent = card.dir;
    el.appendChild(tooltip);

    el.addEventListener('click', () => enterSeries(card.id));
    return el;
  }

  // -------------------------------------------------------- series view ----

  const durCache = new Map();
  let durActive = 0;
  const durQueue = [];

  const durObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        durObserver.unobserve(entry.target);
        queueDuration(entry.target);
      }
    },
    { rootMargin: '300px' }
  );

  function queueDuration(row) {
    const p = row.dataset.path;
    if (!p) return;
    if (durCache.has(p)) {
      setRowDuration(row, durCache.get(p));
      return;
    }
    durQueue.push(row);
    pumpDurations();
  }

  // Probe at most a few ffmpeg calls at a time so a 100-episode folder does not
  // spawn 100 processes at once.
  function pumpDurations() {
    while (durActive < 3 && durQueue.length) {
      const row = durQueue.shift();
      const p = row.dataset.path;
      if (!p) continue;
      if (durCache.has(p)) {
        setRowDuration(row, durCache.get(p));
        continue;
      }
      durActive++;
      fetch('/api/movies/' + row.dataset.id + '/duration')
        .then((res) => res.json())
        .then((data) => {
          if (data && typeof data.duration === 'number') {
            durCache.set(p, data.duration);
            setRowDuration(row, data.duration);
          }
        })
        .catch(() => {})
        .then(() => {
          durActive--;
          pumpDurations();
        });
    }
  }

  function setRowDuration(row, sec) {
    const el = row.querySelector('.ep-dur');
    if (el) el.textContent = formatTime(sec);
  }

  function parseSeriesHash() {
    const m = /^#series\/(\d+)$/.exec(location.hash);
    return m ? parseInt(m[1], 10) : null;
  }

  function enterSeries(id) {
    const hash = '#series/' + id;
    if (location.hash !== hash) history.pushState(null, '', hash);
    openSeriesView(id, true);
  }

  function openSeriesView(id, autoplay) {
    const s = series[id];
    if (!s) return false;
    const first = activeSeriesId !== id;
    activeSeriesId = id;
    document.body.classList.add('series-open');
    seriesView.hidden = false;

    const eps = episodesOf(id);
    renderSeriesHeader(s, eps);
    renderEpisodeList(s, eps);

    if (first) {
      stopSeriesVideo();
      currentEpisode = null;
      updateNowPlaying();
      if (autoplay && eps.length) {
        playEpisode(eps[0]);
      } else if (eps.length) {
        seriesVideo.poster = eps[0].hasPoster ? '/poster/' + eps[0].id : '';
        seriesNowTitle.textContent = '选择一集开始播放';
        seriesNowMeta.textContent = '';
      }
    }
    return true;
  }

  function exitSeriesView() {
    if (activeSeriesId == null) return;
    activeSeriesId = null;
    currentEpisode = null;
    stopSeriesVideo();
    seriesView.hidden = true;
    document.body.classList.remove('series-open');
    durObserver.disconnect();
    durQueue.length = 0;
  }

  function goToGrid() {
    if (selectedCategory && !categories.some((c) => c.name === selectedCategory)) {
      selectedCategory = null;
    }
    const hash = selectedCategory == null ? '' : '#category=' + encodeURIComponent(selectedCategory);
    history.replaceState(null, '', hash || location.pathname + location.search);
    exitSeriesView();
    renderCategories();
    renderGrid();
  }

  function renderSeriesHeader(s, eps) {
    seriesTitle.textContent = s.title;
    const total = eps.reduce((sum, e) => sum + (e.size || 0), 0);
    seriesSub.textContent = s.count + ' 集 · ' + formatSize(total) + ' · ' + s.category;
    seriesPlayAll.disabled = eps.length === 0;
  }

  function renderEpisodeList(s, eps) {
    durObserver.disconnect();
    durQueue.length = 0;
    seriesList.innerHTML = '';

    eps.forEach((ep, index) => {
      const row = document.createElement('div');
      row.className = 'ep-row';
      row.dataset.id = ep.id;
      row.dataset.path = ep.filePath;

      const num = document.createElement('div');
      num.className = 'ep-num';
      num.textContent = String(ep.episode != null ? ep.episode : index + 1).padStart(2, '0');

      const thumb = document.createElement('div');
      thumb.className = 'ep-thumb';
      if (ep.hasPoster) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = ep.title;
        img.src = '/poster/' + ep.id + (posterVersion ? '?v=' + posterVersion : '');
        thumb.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'ep-thumb-ph';
        ph.textContent = num.textContent;
        thumb.appendChild(ph);
      }
      const dur = document.createElement('span');
      dur.className = 'ep-dur';
      dur.textContent = '--:--';
      thumb.appendChild(dur);

      const meta = document.createElement('div');
      meta.className = 'ep-meta';

      const titleEl = document.createElement('div');
      titleEl.className = 'ep-title';
      titleEl.textContent = ep.title || '第 ' + (index + 1) + ' 集';

      const subEl = document.createElement('div');
      subEl.className = 'ep-sub';
      const bits = [];
      if (ep.mtime) bits.push(formatDate(ep.mtime));
      if (ep.size) bits.push(formatSize(ep.size));
      subEl.textContent = bits.join(' · ');

      meta.appendChild(titleEl);
      meta.appendChild(subEl);

      row.appendChild(num);
      row.appendChild(thumb);
      row.appendChild(meta);

      row.addEventListener('click', () => playEpisode(ep));
      attachContextMenu(row, ep);

      seriesList.appendChild(row);
      durObserver.observe(row);
    });

    markActiveRow(false);
  }

  function refreshSeriesView() {
    const s = series[activeSeriesId];
    if (!s) return;
    const eps = episodesOf(s.id);

    if (currentEpisode) {
      const still = eps.find((e) => e.filePath === currentEpisode.filePath);
      if (still) {
        currentEpisode = {
          id: still.id,
          filePath: still.filePath,
          title: still.title,
          episode: still.episode,
          mtime: still.mtime,
          hasPoster: still.hasPoster,
        };
      } else {
        stopSeriesVideo();
        currentEpisode = null;
      }
    }

    renderSeriesHeader(s, eps);
    renderEpisodeList(s, eps);
    updateNowPlaying();
  }

  function episodeIndex() {
    if (activeSeriesId == null || !currentEpisode) return -1;
    return episodesOf(activeSeriesId).findIndex((e) => e.filePath === currentEpisode.filePath);
  }

  function playEpisode(ep) {
    currentEpisode = {
      id: ep.id,
      filePath: ep.filePath,
      title: ep.title,
      episode: ep.episode,
      mtime: ep.mtime,
      hasPoster: ep.hasPoster,
    };
    seriesVideo.poster = ep.hasPoster ? '/poster/' + ep.id : '';
    seriesVideo.src = '/stream/' + ep.id;
    seriesVideo.play().catch(() => {});
    updateNowPlaying();
    markActiveRow(true);
  }

  function playNext() {
    const eps = episodesOf(activeSeriesId);
    const i = episodeIndex();
    if (i >= 0 && i + 1 < eps.length) playEpisode(eps[i + 1]);
  }

  function playPrev() {
    const eps = episodesOf(activeSeriesId);
    const i = episodeIndex();
    if (i > 0) playEpisode(eps[i - 1]);
  }

  function stopSeriesVideo() {
    try {
      seriesVideo.pause();
    } catch (err) {
      // ignore
    }
    seriesVideo.removeAttribute('src');
    seriesVideo.poster = '';
    seriesVideo.load();
  }

  function updateNowPlaying() {
    const eps = episodesOf(activeSeriesId);
    const i = episodeIndex();
    if (currentEpisode && i >= 0) {
      const label = currentEpisode.episode != null ? 'EP ' + currentEpisode.episode + ' · ' : '';
      seriesNowTitle.textContent = label + (currentEpisode.title || '');
      const bits = [];
      if (currentEpisode.mtime) bits.push(formatDate(currentEpisode.mtime));
      bits.push('第 ' + (i + 1) + ' / ' + eps.length + ' 集');
      seriesNowMeta.textContent = bits.join(' · ');
    } else {
      seriesNowTitle.textContent = '';
      seriesNowMeta.textContent = '';
    }
    seriesPrev.disabled = i <= 0;
    seriesNext.disabled = i < 0 || i + 1 >= eps.length;
  }

  function markActiveRow(scroll) {
    const path = currentEpisode ? currentEpisode.filePath : null;
    const rows = seriesList.querySelectorAll('.ep-row');
    for (const row of rows) {
      const active = path != null && row.dataset.path === path;
      row.classList.toggle('ep-active', active);
      if (active && scroll) row.scrollIntoView({ block: 'nearest' });
    }
  }

  seriesVideo.addEventListener('ended', playNext);
  seriesVideo.addEventListener('play', () => markActiveRow(true));
  seriesPrev.addEventListener('click', playPrev);
  seriesNext.addEventListener('click', playNext);
  seriesBack.addEventListener('click', goToGrid);
  seriesPlayAll.addEventListener('click', () => {
    const eps = episodesOf(activeSeriesId);
    if (eps.length) playEpisode(eps[0]);
  });

  // ------------------------------------------------------ single player ----

  function openPlayer(m) {
    playerTitle.textContent = m.title;
    video.src = '/stream/' + m.id;
    player.hidden = false;
    video.play().catch(() => {});
  }

  function closePlayer() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    player.hidden = true;
  }

  // ------------------------------------------------------------- routing ---

  function route() {
    const sid = parseSeriesHash();
    if (sid != null) {
      if (series[sid]) {
        openSeriesView(sid, false);
        return;
      }
      // Before the first scan lands we cannot tell a stale link from a fresh
      // one, so keep the hash and let the next route() decide.
      if (!dataLoaded) return;
      history.replaceState(null, '', location.pathname + location.search);
    }
    exitSeriesView();
    selectedCategory = parseCategory();
    renderCategories();
    renderGrid();
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);

  searchInput.addEventListener('input', renderGrid);

  rescanBtn.addEventListener('click', async () => {
    rescanBtn.disabled = true;
    rescanBtn.textContent = 'Scanning...';
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      lastSignature = signature(data);
      applyData(data, true);
    } catch (err) {
      notices.hidden = false;
      notices.textContent = 'Rescan failed: ' + err.message;
    } finally {
      rescanBtn.disabled = false;
      rescanBtn.textContent = 'Rescan';
    }
  });

  closeBtn.addEventListener('click', closePlayer);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!ctxMenu.hidden) {
      hideCtxMenu();
    } else if (!thumbModal.hidden) {
      closeThumbModal();
    } else if (!dirsModal.hidden) {
      closeDirsModal();
    } else if (activeSeriesId != null) {
      goToGrid();
    } else if (!player.hidden) {
      closePlayer();
    }
  });

  // ------------------------------------------------------- context menu ----

  function disarmDelete() {
    deleteArmed = false;
    if (deleteArmTimer) {
      clearTimeout(deleteArmTimer);
      deleteArmTimer = null;
    }
    ctxDelete.textContent = 'Delete file';
  }

  function hideCtxMenu() {
    ctxMenu.hidden = true;
    disarmDelete();
  }

  function closeThumbModal() {
    thumbModal.hidden = true;
    ctxTarget = null;
  }

  async function updateThumbPreview() {
    if (!ctxTarget) return;
    const sec = Number(thumbSlider.value);
    thumbTimeLabel.textContent = formatTime(sec);
    try {
      const res = await fetch('/api/movies/' + ctxTarget.id + '/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: sec }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      thumbPreview.src = url;
    } catch (err) {
      // ignore preview errors
    }
  }

  async function openThumbModal(m) {
    ctxTarget = m;
    thumbModal.hidden = false;
    thumbTitle.textContent = m.title;
    thumbPreview.src = '';
    thumbDurationSec = 0;
    thumbDuration.textContent = '';
    thumbSlider.value = 0;
    thumbSlider.max = 0;
    thumbTimeLabel.textContent = '0:00';
    try {
      const res = await fetch('/api/movies/' + m.id + '/duration');
      const data = await res.json();
      thumbDurationSec = Math.floor(data.duration || 0);
      thumbSlider.max = thumbDurationSec;
      thumbDuration.textContent = '/ ' + formatTime(thumbDurationSec);
      updateThumbPreview();
    } catch (err) {
      // ignore duration errors
    }
  }

  ctxRethumb.addEventListener('click', () => {
    hideCtxMenu();
    if (ctxTarget) openThumbModal(ctxTarget);
  });

  ctxDelete.addEventListener('click', async () => {
    if (!ctxTarget) {
      hideCtxMenu();
      return;
    }
    const m = ctxTarget;
    if (!deleteArmed) {
      deleteArmed = true;
      ctxDelete.textContent = 'Really delete? Click again';
      deleteArmTimer = setTimeout(disarmDelete, 5000);
      return;
    }
    disarmDelete();
    hideCtxMenu();
    if (!window.confirm('Delete this file?\n\n' + m.filePath)) return;
    try {
      const res = await fetch('/api/movies/' + m.id, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        notices.hidden = false;
        notices.textContent = 'Delete failed: ' + (data.error || res.status);
        return;
      }
      lastSignature = '';
      await loadMovies(true);
      if (activeSeriesId != null) markActiveRow(false);
    } catch (err) {
      notices.hidden = false;
      notices.textContent = 'Delete failed: ' + err.message;
    }
  });

  thumbSlider.addEventListener('input', () => {
    thumbTimeLabel.textContent = formatTime(Number(thumbSlider.value));
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updateThumbPreview, 300);
  });

  thumbApply.addEventListener('click', async () => {
    if (!ctxTarget) return;
    const sec = Number(thumbSlider.value);
    thumbApply.disabled = true;
    try {
      const res = await fetch('/api/movies/' + ctxTarget.id + '/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: sec }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        notices.hidden = false;
        notices.textContent = 'Failed to regenerate: ' + (data.error || res.status);
        return;
      }
      posterVersion++;
      durCache.clear();
      lastSignature = '';
      await loadMovies(true);
      closeThumbModal();
    } catch (err) {
      notices.hidden = false;
      notices.textContent = 'Failed to regenerate: ' + err.message;
    } finally {
      thumbApply.disabled = false;
    }
  });

  thumbClose.addEventListener('click', closeThumbModal);

  document.addEventListener('click', (e) => {
    if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) hideCtxMenu();
  });

  // ------------------------------------------------------- dirs modal -----

  // Per folder: auto = fold numbered runs only, force = fold any folder with
  // 2+ videos, off = never fold. Saved into config.json per media directory.
  const SERIES_MODE_LABELS = [
    ['auto', '折叠：数字序号'],
    ['force', '折叠：强制全部'],
    ['off', '不折叠'],
  ];

  function dirRow(d) {
    const row = document.createElement('div');
    row.className = 'dir-row';

    const nameInput = document.createElement('input');
    nameInput.className = 'dir-input dir-name';
    nameInput.type = 'text';
    nameInput.placeholder = 'Name (optional)';
    nameInput.value = (d && d.name) || '';

    const pathInput = document.createElement('input');
    pathInput.className = 'dir-input dir-path';
    pathInput.type = 'text';
    pathInput.placeholder = '/path/to/folder';
    pathInput.value = (d && d.path) || '';

    const modeSelect = document.createElement('select');
    modeSelect.className = 'dir-input dir-mode';
    modeSelect.title = '这个分类里的视频如何折叠成系列卡';
    for (const [value, label] of SERIES_MODE_LABELS) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      modeSelect.appendChild(opt);
    }
    modeSelect.value = (d && d.mode) || 'auto';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'dir-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(nameInput);
    row.appendChild(pathInput);
    row.appendChild(modeSelect);
    row.appendChild(removeBtn);
    return row;
  }

  function renderDirsList() {
    dirsList.innerHTML = '';
    for (const d of mediaDirs) dirsList.appendChild(dirRow(d));
  }

  function openDirsModal() {
    renderDirsList();
    dirsModal.hidden = false;
  }

  function closeDirsModal() {
    dirsModal.hidden = true;
  }

  dirsAdd.addEventListener('click', () => dirsList.appendChild(dirRow(null)));

  dirsSave.addEventListener('click', async () => {
    const rows = dirsList.querySelectorAll('.dir-row');
    const dirs = [];
    for (const row of rows) {
      const name = row.querySelector('.dir-name').value.trim();
      const p = row.querySelector('.dir-path').value.trim();
      if (!p) continue;
      dirs.push({ name, path: p, mode: row.querySelector('.dir-mode').value });
    }
    dirsSave.disabled = true;
    dirsSave.textContent = 'Saving...';
    try {
      const res = await fetch('/api/dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notices.hidden = false;
        notices.textContent = 'Failed to save folders: ' + (data.error || res.status);
        return;
      }
      lastSignature = signature(data);
      applyData(data, true);
      closeDirsModal();
    } catch (err) {
      notices.hidden = false;
      notices.textContent = 'Failed to save folders: ' + err.message;
    } finally {
      dirsSave.disabled = false;
      dirsSave.textContent = 'Save';
    }
  });

  foldersBtn.addEventListener('click', openDirsModal);
  dirsClose.addEventListener('click', closeDirsModal);

  // ---------------------------------------------------------------- init ---

  selectedCategory = parseCategory();
  // Route once the first scan is in: a deep link to #series/N then reopens the
  // list without autoplay (browsers block it without a user gesture).
  loadMovies(true).then(route);
  setInterval(loadMovies, 6000);
})();
