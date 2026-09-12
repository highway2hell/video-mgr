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
  let categories = [];
  let mediaDirs = [];
  let selectedCategory = null;
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

  function renderNotices(scanErrors, mediaDirs) {
    const parts = [];
    if (scanErrors && scanErrors.length) {
      parts.push('Could not read: ' + scanErrors.map(escapeHtml).join('; '));
    }
    if (!mediaDirs || mediaDirs.length === 0) {
      parts.push('No media directories configured.');
    }
    if (parts.length) {
      notices.hidden = false;
      notices.textContent = parts.join(' ');
    } else {
      notices.hidden = true;
    }
  }

  function renderCategories() {
    categoriesEl.innerHTML = '';

    const allBtn = categoryChip('All', null, selectedCategory === null, movies.length);
    categoriesEl.appendChild(allBtn);

    for (const c of categories) {
      categoriesEl.appendChild(categoryChip(c.name, c.name, selectedCategory === c.name, c.count));
    }
  }

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

  function renderGrid() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = movies.filter((m) => {
      const matchCategory = selectedCategory === null || m.category === selectedCategory;
      const matchQuery = !query || m.title.toLowerCase().includes(query);
      return matchCategory && matchQuery;
    });

    grid.innerHTML = '';

    for (const m of filtered) {
      const card = document.createElement('div');
      card.className = 'card';

      const imgWrap = document.createElement('div');
      imgWrap.className = 'card-img-wrap';

      if (m.hasPoster) {
        const img = document.createElement('img');
        img.className = 'card-img';
        img.loading = 'lazy';
        img.alt = m.title;
        img.src = '/poster/' + m.id + (posterVersion ? '?v=' + posterVersion : '');
        img.addEventListener('error', () => {
          img.replaceWith(placeholder(m.title));
        });
        imgWrap.appendChild(img);
      } else {
        imgWrap.appendChild(placeholder(m.title));
      }

      const caption = document.createElement('div');
      caption.className = 'card-caption';

      const titleEl = document.createElement('div');
      titleEl.className = 'card-title';
      titleEl.textContent = m.title;

      const sizeEl = document.createElement('div');
      sizeEl.className = 'card-size';
      sizeEl.textContent = formatSize(m.size);

      caption.appendChild(titleEl);
      caption.appendChild(sizeEl);

      card.appendChild(imgWrap);
      card.appendChild(caption);

      if (m.filePath) {
        const tooltip = document.createElement('div');
        tooltip.className = 'card-tooltip';
        tooltip.textContent = m.filePath;
        card.appendChild(tooltip);
      }

      card.addEventListener('click', () => openPlayer(m));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        disarmDelete();
        ctxTarget = m;
        ctxMenu.hidden = false;
        const x = Math.min(e.clientX, window.innerWidth - 200);
        const y = Math.min(e.clientY, window.innerHeight - 110);
        ctxMenu.style.left = x + 'px';
        ctxMenu.style.top = y + 'px';
      });

      grid.appendChild(card);
    }

    empty.hidden = filtered.length > 0;
  }

  function placeholder(title) {
    const div = document.createElement('div');
    div.className = 'card-placeholder';
    div.textContent = title;
    return div;
  }

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

  let lastSignature = '';

  function signature(data) {
    const withImg = (data.movies || []).filter((m) => m.hasPoster).length;
    const cats = (data.categories || []).map((c) => c.name + ':' + c.count).join(',');
    return (data.count || 0) + '|' + withImg + '|' + cats;
  }

  async function loadMovies(force) {
    try {
      const res = await fetch('/api/movies');
      const data = await res.json();
      const sig = signature(data);
      if (force || sig !== lastSignature) {
        lastSignature = sig;
        movies = data.movies || [];
        categories = data.categories || [];
        mediaDirs = data.mediaDirs || [];
        if (selectedCategory && !categories.some((c) => c.name === selectedCategory)) {
          setSelectedCategory(null);
        }
        renderNotices(data.scanErrors, data.mediaDirs);
        renderCategories();
        renderGrid();
      }
    } catch (err) {
      notices.hidden = false;
      notices.textContent = 'Failed to reach the server: ' + err.message;
    }
  }

  searchInput.addEventListener('input', renderGrid);

  rescanBtn.addEventListener('click', async () => {
    rescanBtn.disabled = true;
    rescanBtn.textContent = 'Scanning...';
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      lastSignature = signature(data);
      movies = data.movies || [];
      categories = data.categories || [];
      mediaDirs = data.mediaDirs || [];
      if (selectedCategory && !categories.some((c) => c.name === selectedCategory)) {
        setSelectedCategory(null);
      }
      renderNotices(data.scanErrors, data.mediaDirs);
      renderCategories();
      renderGrid();
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
    if (e.key === 'Escape' && !player.hidden) {
      closePlayer();
    }
  });

  window.addEventListener('hashchange', () => {
    selectedCategory = parseCategory();
    renderCategories();
    renderGrid();
  });

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
      await loadMovies(true);
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

  function renderDirsList() {
    dirsList.innerHTML = '';
    for (const d of mediaDirs) {
      const row = document.createElement('div');
      row.className = 'dir-row';

      const nameInput = document.createElement('input');
      nameInput.className = 'dir-input dir-name';
      nameInput.type = 'text';
      nameInput.placeholder = 'Name (optional)';
      nameInput.value = d.name || '';

      const pathInput = document.createElement('input');
      pathInput.className = 'dir-input dir-path';
      pathInput.type = 'text';
      pathInput.placeholder = '/path/to/folder';
      pathInput.value = d.path || '';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'dir-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => row.remove());

      row.appendChild(nameInput);
      row.appendChild(pathInput);
      row.appendChild(removeBtn);
      dirsList.appendChild(row);
    }
  }

  function openDirsModal() {
    renderDirsList();
    dirsModal.hidden = false;
  }

  function closeDirsModal() {
    dirsModal.hidden = true;
  }

  dirsAdd.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'dir-row';

    const nameInput = document.createElement('input');
    nameInput.className = 'dir-input dir-name';
    nameInput.type = 'text';
    nameInput.placeholder = 'Name (optional)';

    const pathInput = document.createElement('input');
    pathInput.className = 'dir-input dir-path';
    pathInput.type = 'text';
    pathInput.placeholder = '/path/to/folder';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'dir-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(nameInput);
    row.appendChild(pathInput);
    row.appendChild(removeBtn);
    dirsList.appendChild(row);
  });

  dirsSave.addEventListener('click', async () => {
    const rows = dirsList.querySelectorAll('.dir-row');
    const dirs = [];
    for (const row of rows) {
      const name = row.querySelector('.dir-name').value.trim();
      const p = row.querySelector('.dir-path').value.trim();
      if (!p) continue;
      dirs.push({ name, path: p });
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
      movies = data.movies || [];
      categories = data.categories || [];
      mediaDirs = data.mediaDirs || [];
      if (selectedCategory && !categories.some((c) => c.name === selectedCategory)) {
        setSelectedCategory(null);
      }
      renderNotices(data.scanErrors, data.mediaDirs);
      renderCategories();
      renderGrid();
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

  selectedCategory = parseCategory();
  loadMovies();
  setInterval(loadMovies, 6000);
})();
