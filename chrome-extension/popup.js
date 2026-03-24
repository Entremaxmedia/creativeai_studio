'use strict';

// ─── Preset data (mirrors structured-filename-dialog.tsx) ─────────────────────

const PRESET_CATEGORIES = [
  { id: 'preset-product',     name: 'product',     displayName: 'Product',     abbreviation: 'pr' },
  { id: 'preset-adcreative',  name: 'adcreative',  displayName: 'Ad Creative', abbreviation: 'ad' },
  { id: 'preset-lifestyle',   name: 'lifestyle',   displayName: 'Lifestyle',   abbreviation: 'lifestyle' },
  { id: 'preset-element',     name: 'element',     displayName: 'Element',     abbreviation: 'el' },
];

const PRESET_PRODUCT_IDS_BY_CATEGORY = {
  'preset-product':    [],
  'preset-adcreative': [
    { id: 'preset-fb',  name: 'fb',  displayName: 'Facebook' },
    { id: 'preset-yt',  name: 'yt',  displayName: 'YouTube' },
    { id: 'preset-rum', name: 'rum', displayName: 'Rumble' },
  ],
  'preset-lifestyle': [],
  'preset-element':   [],
};

const PRESET_TYPES_BY_CATEGORY = {
  'preset-product': [
    { id: 'preset-product-null',    name: 'null',    displayName: 'Null' },
    { id: 'preset-product-photo',   name: 'photo',   displayName: 'Photo' },
    { id: 'preset-product-graphic', name: 'graphic', displayName: 'Graphic' },
    { id: 'preset-product-mockup',  name: 'mockup',  displayName: 'Mockup' },
    { id: 'preset-product-review',  name: 'review',  displayName: 'Review' },
  ],
  'preset-adcreative': [
    { id: 'preset-ad-hero',        name: 'hero',        displayName: 'Hero' },
    { id: 'preset-ad-variation',   name: 'variation',   displayName: 'Variation' },
    { id: 'preset-ad-testimonial', name: 'testimonial', displayName: 'Testimonial' },
    { id: 'preset-ad-comparison',  name: 'comparison',  displayName: 'Comparison' },
  ],
  'preset-lifestyle': [
    { id: 'preset-lifestyle-null',    name: 'null',    displayName: 'Null' },
    { id: 'preset-lifestyle-photo',   name: 'photo',   displayName: 'Photo' },
    { id: 'preset-lifestyle-graphic', name: 'graphic', displayName: 'Graphic' },
    { id: 'preset-lifestyle-mockup',  name: 'mockup',  displayName: 'Mockup' },
    { id: 'preset-lifestyle-review',  name: 'review',  displayName: 'Review' },
  ],
  'preset-element': [
    { id: 'preset-element-badge',   name: 'badge',   displayName: 'Badge' },
    { id: 'preset-element-icon',    name: 'icon',    displayName: 'Icon' },
    { id: 'preset-element-texture', name: 'texture', displayName: 'Texture' },
    { id: 'preset-element-logo',    name: 'logo',    displayName: 'Logo' },
  ],
};

// ─── State ────────────────────────────────────────────────────────────────────

let settings = { backendUrl: '', apiKey: '' };
let allImages = [];
let allVideos = [];
let activeTab = 'images'; // 'images' | 'videos'

// ─── Library state ─────────────────────────────────────────────────────────────
let mainTab = 'importer';         // 'library' | 'importer'
let librarySubTab = 'images';     // 'images' | 'videos'
let libraryAllImages = [];        // raw items from API (images)
let libraryAllVideos = [];        // raw items from API (videos)
let librarySearch = '';
let libraryFolderId = null;       // null = all folders
let libSearchTimeout = null;
let libraryPage = 1;
const LIBRARY_PAGE_SIZE = 48;

let namingState = {
  categoryId: '', categoryName: '', categoryPrefix: '',
  productId: '', productName: '',
  typeId: '', typeName: '',
  variant: '',
};
let selectedFolderId = null;
let dbCategories = [];
let dbProductIds = [];
let dbTypes = [];
let dbFolders = [];
let sequenceDebounce = null;

// ─── DOM helpers ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const mainPanel     = $('main-panel');
const libraryPanel  = $('library-panel');
const settingsPanel = $('settings-panel');
const loadingState  = $('loading-state');
const emptyState    = $('empty-state');
const imageGrid     = $('image-grid');
const videoGrid     = $('video-grid');
const tabImages     = $('tab-images');
const tabVideos     = $('tab-videos');
const tabImagesCount = $('tab-images-count');
const tabVideosCount = $('tab-videos-count');
const emptyIcon     = $('empty-icon');
const emptyText     = $('empty-text');
const uploadBtn        = $('upload-btn');
const convertWebpChk   = $('convert-webp');

// Upload modal elements
const uploadModal        = $('upload-modal');
const uploadModalProg    = $('upload-modal-progress');
const uploadModalSub     = $('upload-modal-sub');
const uploadModalDone    = $('upload-modal-done');
const uploadModalDoneTitle = $('upload-modal-done-title');
const uploadModalDoneSub   = $('upload-modal-done-sub');
const uploadModalIconDone  = $('upload-modal-icon-done');
const uploadModalList      = $('upload-modal-list');
const uploadModalClose     = $('upload-modal-close');
const selectedCount = $('selected-count');
const imageCount    = $('image-count');
const filenamePreview = $('filename-preview');
const previewText   = $('preview-text');

// ─── Custom dropdown system ───────────────────────────────────────────────────
// Each dropdown is initialized ONCE. The `update(items, selectedId)` method
// re-renders the list without rebinding event listeners.

function createDropdown({ btnId, dropdownId, searchId, listId, addRowId, addBtnId, addLabelId, showAbbr = false }) {
  const btn      = $(btnId);
  const dropdown = $(dropdownId);
  const searchEl = searchId ? $(searchId) : null;
  const listEl   = $(listId);
  const addRow   = addRowId ? $(addRowId) : null;
  const addBtn   = addBtnId ? $(addBtnId) : null;
  const addLabel = addLabelId ? $(addLabelId) : null;

  let currentItems = [];
  let currentSelectedId = '';
  let onSelectCb = null;
  let onAddCb = null;

  function renderList(filter = '') {
    listEl.innerHTML = '';
    const lf = filter.toLowerCase();
    let rendered = 0;

    currentItems.forEach(item => {
      const label = item.displayName || item.name;
      if (lf && !label.toLowerCase().includes(lf) && !item.name.toLowerCase().includes(lf)) return;
      const el = document.createElement('div');
      el.className = 'dropdown-item' + (item.id === currentSelectedId ? ' selected' : '');
      el.dataset.itemId = item.id;
      el.innerHTML = `<span>${label}</span>${showAbbr && item.abbreviation ? `<span class="item-abbr">${item.abbreviation}</span>` : ''}`;
      listEl.appendChild(el);
      rendered++;
    });

    if (rendered === 0 && !filter) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty';
      empty.textContent = 'No options yet. Type to add.';
      listEl.appendChild(empty);
    }

    // Show "Add" button only when filter text doesn't exactly match any existing option
    if (addRow && addLabel) {
      if (filter && onAddCb) {
        const exactMatch = currentItems.some(i =>
          (i.displayName || i.name).toLowerCase() === lf || i.name.toLowerCase() === lf
        );
        if (!exactMatch) {
          addLabel.textContent = `Add "${filter}"`;
          addRow.classList.remove('hidden');
        } else {
          addRow.classList.add('hidden');
        }
      } else {
        addRow.classList.add('hidden');
      }
    }
  }

  function openDropdown() {
    // Close all other dropdowns first
    document.querySelectorAll('.dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
    document.querySelectorAll('.select-btn').forEach(b => { if (b !== btn) b.classList.remove('open'); });
    dropdown.classList.remove('hidden');
    btn.classList.add('open');
    if (searchEl) { searchEl.value = ''; searchEl.focus(); }
    renderList('');
  }

  function closeDropdown() {
    dropdown.classList.add('hidden');
    btn.classList.remove('open');
  }

  // ── One-time event binding ──
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (btn.disabled) return;
    dropdown.classList.contains('hidden') ? openDropdown() : closeDropdown();
  });

  if (searchEl) {
    searchEl.addEventListener('input', () => renderList(searchEl.value));
  }

  // List item clicks delegated to the list container (no rebinding on render)
  listEl.addEventListener('click', e => {
    const el = e.target.closest('[data-item-id]');
    if (!el) return;
    e.stopPropagation();
    const item = currentItems.find(i => i.id === el.dataset.itemId);
    if (item && onSelectCb) {
      onSelectCb(item);
      closeDropdown();
    }
  });

  // Add button: bind once, dispatch via the mutable onAddCb closure variable
  if (addBtn) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (onAddCb && searchEl) onAddCb(searchEl.value.trim());
    });
  }

  // Public API
  return {
    update(items, selectedId, onSelect, onAdd) {
      currentItems = items;
      currentSelectedId = selectedId;
      onSelectCb = onSelect;
      onAddCb = onAdd; // just reassign — the one listener above dispatches through this
      // Only re-render list if dropdown is currently open
      if (!dropdown.classList.contains('hidden')) {
        renderList(searchEl ? searchEl.value : '');
      }
    },
    setSelected(id, label) {
      currentSelectedId = id;
      if (label !== undefined) {
        const span = btn.querySelector('span');
        if (span) span.textContent = label;
        if (label && id) btn.classList.add('has-value');
        else btn.classList.remove('has-value');
      }
    },
    reset(placeholder) {
      currentSelectedId = '';
      const span = btn.querySelector('span');
      if (span) span.textContent = placeholder;
      btn.classList.remove('has-value');
    },
  };
}

// ─── Dropdown instances (created once) ────────────────────────────────────────

const catDD     = createDropdown({ btnId: 'cat-btn',      dropdownId: 'cat-dropdown',      searchId: 'cat-search',      listId: 'cat-list',      addRowId: 'cat-add-row',    addBtnId: 'cat-add-btn',    addLabelId: 'cat-add-label',    showAbbr: true });
const pidDD     = createDropdown({ btnId: 'pid-btn',      dropdownId: 'pid-dropdown',      searchId: 'pid-search',      listId: 'pid-list',      addRowId: 'pid-add-row',    addBtnId: 'pid-add-btn',    addLabelId: 'pid-add-label' });
const typeDD    = createDropdown({ btnId: 'type-btn',     dropdownId: 'type-dropdown',     searchId: 'type-search',     listId: 'type-list',     addRowId: 'type-add-row',   addBtnId: 'type-add-btn',   addLabelId: 'type-add-label' });
const folderDD  = createDropdown({ btnId: 'folder-btn',   dropdownId: 'folder-dropdown',   searchId: 'folder-search',   listId: 'folder-list' });
const libFolderDD = createDropdown({ btnId: 'lib-folder-btn', dropdownId: 'lib-folder-dropdown', searchId: 'lib-folder-search', listId: 'lib-folder-list' });

// ─── Utilities ────────────────────────────────────────────────────────────────

function apiFetch(path, opts = {}) {
  const url = settings.backendUrl.replace(/\/$/, '') + path;
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      ...(opts.headers || {}),
    },
  });
}

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.classList.remove('hidden');
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['backendUrl', 'apiKey'], data => {
      settings.backendUrl = data.backendUrl || '';
      settings.apiKey     = data.apiKey     || '';
      resolve();
    });
  });
}

async function saveSettings() {
  const wasConfigured = !!(settings.backendUrl && settings.apiKey);
  settings.backendUrl = $('settings-backend-url').value.trim().replace(/\/$/, '');
  settings.apiKey     = $('settings-api-key').value.trim();
  chrome.storage.local.set({ backendUrl: settings.backendUrl, apiKey: settings.apiKey });
  showStatus($('settings-status'), 'Settings saved.', 'success');
  // If this was the first-time setup (popup had returned early in init()),
  // close settings and kick off the full initialization now.
  if (!wasConfigured && settings.backendUrl && settings.apiKey) {
    closeSettings();
    await Promise.all([loadNamingData(), scanPageImages()]);
  }
}

async function testConnection() {
  const url = $('settings-backend-url').value.trim().replace(/\/$/, '');
  const key = $('settings-api-key').value.trim();
  if (!url || !key) { showStatus($('settings-status'), 'Please fill in both fields.', 'error'); return; }
  showStatus($('settings-status'), 'Testing connection\u2026', '');
  try {
    const res = await fetch(url + '/api/mtp-images/auth-check', { headers: { 'x-api-key': key } });
    if (res.ok) showStatus($('settings-status'), 'Connection successful! API key is valid.', 'success');
    else if (res.status === 401) showStatus($('settings-status'), 'Invalid API key. Check your settings.', 'error');
    else if (res.status === 503) showStatus($('settings-status'), 'Server reached but Import API not configured.', 'error');
    else showStatus($('settings-status'), `Server responded with ${res.status}. Check your URL.`, 'error');
  } catch (e) {
    showStatus($('settings-status'), `Could not reach server: ${e.message}`, 'error');
  }
}

function openSettings() {
  settingsPanel.classList.remove('hidden');
  mainPanel.classList.add('hidden');
  libraryPanel.classList.add('hidden');
  $('settings-backend-url').value = settings.backendUrl;
  $('settings-api-key').value     = settings.apiKey;
  $('settings-btn').classList.add('active');
  $('settings-status').classList.add('hidden');
  $('update-status').classList.add('hidden');
  $('settings-version').textContent = `v${chrome.runtime.getManifest().version}`;
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
  $('settings-btn').classList.remove('active');
  // Restore whichever main tab was active
  if (mainTab === 'library') {
    libraryPanel.classList.remove('hidden');
    mainPanel.classList.add('hidden');
  } else {
    mainPanel.classList.remove('hidden');
    libraryPanel.classList.add('hidden');
  }
}

// ─── Image scanning ───────────────────────────────────────────────────────────

async function scanPageImages() {
  showLoading();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js'],
    });
    const raw = results[0]?.result || {};
    // Content script returns { images: [{url, thumb?}], videos: [{url}] }
    // Backward-compat: also accept flat string arrays
    const imgData = Array.isArray(raw.images) ? raw.images : (Array.isArray(raw) ? raw : []);
    const vidData = Array.isArray(raw.videos) ? raw.videos : [];
    allImages = imgData.map(d => typeof d === 'string'
      ? { url: d, thumb: null, selected: false }
      : { url: d.url, thumb: d.thumb || null, selected: false });
    allVideos = vidData.map(d => typeof d === 'string'
      ? { url: d, poster: null, selected: false }
      : { url: d.url, poster: d.poster || null, selected: false });
    // Update tab counts
    tabImagesCount.textContent = allImages.length;
    tabVideosCount.textContent = allVideos.length;
    renderActiveTab();
  } catch (e) {
    console.error('[MTP] Failed to scan page:', e);
    showEmpty();
  }
}

function renderActiveTab() {
  if (activeTab === 'images') {
    renderImages();
  } else {
    renderVideos();
  }
}

function switchTab(tab) {
  activeTab = tab;
  tabImages.classList.toggle('active', tab === 'images');
  tabVideos.classList.toggle('active', tab === 'videos');
  // WebP option only applies to images
  const webpRow = $('webp-option-row');
  if (webpRow) webpRow.classList.toggle('hidden', tab === 'videos');
  renderActiveTab();
}

function showLoading() {
  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  imageGrid.classList.add('hidden');
  videoGrid.classList.add('hidden');
  imageCount.textContent = 'Loading\u2026';
}

function showEmpty() {
  loadingState.classList.add('hidden');
  emptyState.classList.remove('hidden');
  imageGrid.classList.add('hidden');
  videoGrid.classList.add('hidden');
  const isVideos = activeTab === 'videos';
  if (emptyIcon) {
    emptyIcon.innerHTML = isVideos
      ? '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'
      : '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>';
  }
  if (emptyText) emptyText.textContent = isVideos ? 'No videos found on this page' : 'No images found on this page';
  imageCount.textContent = isVideos ? '0 videos' : '0 images';
}

// ─── Hover preview overlays ───────────────────────────────────────────────────
// Video hover preview overlay (image overlay removed — cards have open-in-tab button instead)
const vidPreviewEl  = $('vid-preview-overlay');
const vidPreviewVid = $('vid-preview-el');

let previewHideTimer = null;

function positionPreview(overlayEl, cardEl) {
  const rect = cardEl.getBoundingClientRect();
  const PREVIEW_W = 262;
  const MARGIN = 8;
  const spaceRight = window.innerWidth - rect.right;
  const spaceLeft  = rect.left;
  let left;
  if (spaceRight >= PREVIEW_W + MARGIN)       left = rect.right + MARGIN;
  else if (spaceLeft >= PREVIEW_W + MARGIN)   left = rect.left - PREVIEW_W - MARGIN;
  else                                         left = Math.max(MARGIN, (window.innerWidth - PREVIEW_W) / 2);
  let top = rect.top;
  const overlayH = overlayEl.offsetHeight || 262;
  const maxTop = window.innerHeight - overlayH - MARGIN;
  if (top > maxTop) top = maxTop;
  if (top < MARGIN) top = MARGIN;
  overlayEl.style.left = `${left}px`;
  overlayEl.style.top  = `${top}px`;
}

function showVideoPreview(url, cardEl) {
  if (previewHideTimer) { clearTimeout(previewHideTimer); previewHideTimer = null; }
  if (vidPreviewVid.src !== url) {
    vidPreviewVid.src = url;
    vidPreviewVid.load();
  }
  vidPreviewVid.play().catch(() => {});
  positionPreview(vidPreviewEl, cardEl);
  vidPreviewEl.classList.remove('hidden');
  vidPreviewEl.classList.add('visible');
}

function hidePreview() {
  previewHideTimer = setTimeout(() => {
    vidPreviewEl.classList.remove('visible');
    setTimeout(() => {
      vidPreviewEl.classList.add('hidden');
      vidPreviewVid.pause();
      vidPreviewVid.src = '';
    }, 150);
    previewHideTimer = null;
  }, 80);
}

function renderImages() {
  loadingState.classList.add('hidden');
  emptyState.classList.add('hidden');
  videoGrid.classList.add('hidden');
  if (allImages.length === 0) { showEmpty(); return; }

  imageGrid.innerHTML = '';
  allImages.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'img-card' + (img.selected ? ' selected' : '');
    card.dataset.idx = idx;

    const checkbox = document.createElement('div');
    checkbox.className = 'img-checkbox';
    checkbox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';

    const imgEl = document.createElement('img');
    // Use pre-fetched base64 thumb for Drive images; fall back to the raw URL
    imgEl.src = img.thumb || img.url;
    imgEl.loading = 'lazy'; imgEl.alt = '';
    imgEl.onerror = () => {
      imgEl.style.display = 'none';
      const broken = document.createElement('div');
      broken.className = 'img-broken';
      broken.textContent = 'Load error';
      card.insertBefore(broken, checkbox.nextSibling);
    };

    const tooltip = document.createElement('div');
    tooltip.className = 'img-tooltip';
    tooltip.textContent = img.url.replace(/^https?:\/\//, '').substring(0, 60);

    const statusEl = document.createElement('div');
    statusEl.className = 'img-status';
    statusEl.id = `status-${idx}`;

    // Open-in-new-tab action button (visible on hover)
    const actionsEl = document.createElement('div');
    actionsEl.className = 'img-card-actions';
    const openBtn = document.createElement('a');
    openBtn.className = 'img-card-action';
    openBtn.href = img.url;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.title = 'Open full image in new tab';
    openBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    openBtn.addEventListener('click', e => e.stopPropagation());
    actionsEl.appendChild(openBtn);

    card.appendChild(checkbox);
    card.appendChild(imgEl);
    card.appendChild(tooltip);
    card.appendChild(statusEl);
    card.appendChild(actionsEl);
    card.addEventListener('click', () => toggleImage(idx));

    imageGrid.appendChild(card);
  });

  imageGrid.classList.remove('hidden');
  updateSelectionUI();
}

function renderVideos() {
  loadingState.classList.add('hidden');
  emptyState.classList.add('hidden');
  imageGrid.classList.add('hidden');
  if (allVideos.length === 0) { showEmpty(); return; }

  videoGrid.innerHTML = '';
  allVideos.forEach((vid, idx) => {
    const card = document.createElement('div');
    card.className = 'vid-card' + (vid.selected ? ' selected' : '');
    card.dataset.idx = idx;

    const checkbox = document.createElement('div');
    checkbox.className = 'img-checkbox';
    checkbox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';

    // Thumbnail: video element preloads metadata to show first frame
    // Fall back to poster image if video can't load (e.g. m3u8 streams)
    const videoEl = document.createElement('video');
    videoEl.src = vid.url;
    videoEl.preload = 'metadata';
    videoEl.muted = true;
    videoEl.playsInline = true;
    if (vid.poster) videoEl.poster = vid.poster;
    videoEl.addEventListener('loadedmetadata', () => { videoEl.currentTime = 0.1; });
    videoEl.addEventListener('error', () => {
      // If video fails, show poster as <img> fallback
      if (vid.poster) {
        const img = document.createElement('img');
        img.src = vid.poster;
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain';
        videoEl.replaceWith(img);
      }
    });

    // Play icon overlay
    const playIcon = document.createElement('div');
    playIcon.className = 'vid-play-icon';
    playIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

    const tooltip = document.createElement('div');
    tooltip.className = 'img-tooltip';
    tooltip.textContent = vid.url.replace(/^https?:\/\//, '').substring(0, 60);

    const statusEl = document.createElement('div');
    statusEl.className = 'img-status';
    statusEl.id = `vstatus-${idx}`;

    card.appendChild(checkbox);
    card.appendChild(videoEl);
    card.appendChild(playIcon);
    card.appendChild(tooltip);
    card.appendChild(statusEl);
    card.addEventListener('click', () => toggleVideo(idx));

    card.addEventListener('mouseenter', () => showVideoPreview(vid.url, card));
    card.addEventListener('mouseleave', hidePreview);

    videoGrid.appendChild(card);
  });

  videoGrid.classList.remove('hidden');
  updateSelectionUI();
}

function toggleVideo(idx) {
  allVideos[idx].selected = !allVideos[idx].selected;
  const card = videoGrid.querySelector(`[data-idx="${idx}"]`);
  card.classList.toggle('selected', allVideos[idx].selected);
  updateSelectionUI();
}

function toggleImage(idx) {
  allImages[idx].selected = !allImages[idx].selected;
  const card = imageGrid.querySelector(`[data-idx="${idx}"]`);
  card.classList.toggle('selected', allImages[idx].selected);
  updateSelectionUI();
}

function selectAll() {
  if (activeTab === 'videos') {
    allVideos.forEach((vid, idx) => {
      vid.selected = true;
      const card = videoGrid.querySelector(`[data-idx="${idx}"]`);
      if (card) card.classList.add('selected');
    });
  } else {
    allImages.forEach((img, idx) => {
      img.selected = true;
      const card = imageGrid.querySelector(`[data-idx="${idx}"]`);
      if (card) card.classList.add('selected');
    });
  }
  updateSelectionUI();
}

function selectNone() {
  if (activeTab === 'videos') {
    allVideos.forEach((vid, idx) => {
      vid.selected = false;
      const card = videoGrid.querySelector(`[data-idx="${idx}"]`);
      if (card) card.classList.remove('selected');
    });
  } else {
    allImages.forEach((img, idx) => {
      img.selected = false;
      const card = imageGrid.querySelector(`[data-idx="${idx}"]`);
      if (card) card.classList.remove('selected');
    });
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  const isVideos = activeTab === 'videos';
  const items = isVideos ? allVideos : allImages;
  const count = items.filter(i => i.selected).length;
  const label = isVideos ? 'video' : 'image';
  imageCount.textContent = `${items.length} ${label}${items.length !== 1 ? 's' : ''}`;
  if (count > 0) {
    selectedCount.textContent = `${count} selected`;
    selectedCount.classList.remove('hidden');
  } else {
    selectedCount.classList.add('hidden');
  }
  const canUpload = count > 0 && namingState.categoryPrefix && namingState.typeName;
  uploadBtn.disabled = !canUpload;
}

// ─── Naming data loading ──────────────────────────────────────────────────────

async function loadNamingData() {
  try {
    const [catRes, pidRes, folderRes] = await Promise.all([
      apiFetch('/api/mtp-naming/categories'),
      apiFetch('/api/mtp-naming/product-ids'),
      apiFetch('/api/mtp-folders'),
    ]);
    if (catRes.ok)    { const d = await catRes.json();    dbCategories = d.categories || []; }
    if (pidRes.ok)    { const d = await pidRes.json();    dbProductIds = d.productIds || []; }
    if (folderRes.ok) { const d = await folderRes.json(); dbFolders = d.folders || []; }
  } catch (e) {
    console.warn('[MTP] Could not load naming data:', e.message);
  }
  updateCategoryDropdown();
  updateProductIdDropdown();
  updateTypeDropdown();
  updateFolderDropdown();
  updateLibFolderDropdown();
}

async function loadTypesForCategory(categoryId) {
  dbTypes = [];
  if (!categoryId || categoryId.startsWith('preset-')) return;
  try {
    const res = await apiFetch(`/api/mtp-naming/types?categoryId=${encodeURIComponent(categoryId)}`);
    if (res.ok) { const d = await res.json(); dbTypes = d.types || []; }
  } catch (e) {}
}

// ─── Sequence fetching ────────────────────────────────────────────────────────

function scheduleSequenceFetch() {
  updateFilenamePreview(); // show prefix immediately
  clearTimeout(sequenceDebounce);
  sequenceDebounce = setTimeout(updateFilenamePreview, 300);
}

function buildFilenamePrefix() {
  const parts = [
    namingState.categoryPrefix,
    namingState.productName ? namingState.productName.replace(/-/g, '') : '',
    namingState.typeName    ? namingState.typeName.replace(/-/g, '')    : '',
    namingState.variant     ? namingState.variant.toLowerCase().replace(/[^a-z0-9]/g, '') : '',
  ].filter(Boolean);
  return parts.join('-');
}

function updateFilenamePreview() {
  const prefix = buildFilenamePrefix();
  if (!prefix || !namingState.categoryId || !namingState.typeId) {
    filenamePreview.classList.add('hidden');
    return;
  }
  previewText.textContent = `${prefix}-###.{ext}`;
  filenamePreview.classList.remove('hidden');
  updateSelectionUI();
}

// ─── Category dropdown ────────────────────────────────────────────────────────

function getCategoryItems() {
  const presetNames = new Set(PRESET_CATEGORIES.map(p => p.name));
  const customDb = dbCategories.filter(c => !presetNames.has(c.name));
  return [
    ...PRESET_CATEGORIES,
    ...customDb.map(c => ({ id: c.id, name: c.name, displayName: c.displayName || c.name, abbreviation: '' })),
  ];
}

function updateCategoryDropdown() {
  catDD.update(
    getCategoryItems(),
    namingState.categoryId,
    async (item) => {
      const preset = PRESET_CATEGORIES.find(p => p.id === item.id);
      namingState.categoryId     = item.id;
      namingState.categoryName   = item.name;
      namingState.categoryPrefix = preset ? preset.abbreviation : item.name.replace(/-/g, '');
      namingState.typeId   = ''; namingState.typeName   = '';
      namingState.productId = ''; namingState.productName = '';
      catDD.setSelected(item.id, item.displayName || item.name);
      $('type-btn').disabled = false;
      pidDD.reset('Select...');
      typeDD.reset('Select type...');
      await loadTypesForCategory(item.id);
      updateProductIdDropdown();
      updateTypeDropdown();
      scheduleSequenceFetch();
    },
    async (name) => {
      if (!name) return;
      try {
        const res = await apiFetch('/api/mtp-naming/categories', { method: 'POST', body: JSON.stringify({ name }) });
        const d = await res.json();
        if (d.success && d.category) {
          dbCategories.push(d.category);
          updateCategoryDropdown();
          // Auto-select the newly created category
          const newItem = { ...d.category, displayName: d.category.displayName || d.category.name };
          namingState.categoryId     = newItem.id;
          namingState.categoryName   = newItem.name;
          namingState.categoryPrefix = newItem.name.replace(/-/g, '');
          namingState.typeId = ''; namingState.typeName = '';
          namingState.productId = ''; namingState.productName = '';
          catDD.setSelected(newItem.id, newItem.displayName);
          $('type-btn').disabled = false;
          pidDD.reset('Select...');
          typeDD.reset('Select type...');
          await loadTypesForCategory(newItem.id);
          updateProductIdDropdown();
          updateTypeDropdown();
          scheduleSequenceFetch();
        }
      } catch (e) {}
    }
  );
}

// ─── Product ID dropdown ──────────────────────────────────────────────────────

function getProductIdItems() {
  const presetIds = namingState.categoryId.startsWith('preset-')
    ? (PRESET_PRODUCT_IDS_BY_CATEGORY[namingState.categoryId] || [])
    : [];
  const presetNames = new Set(presetIds.map(p => p.name.toLowerCase()));
  const filteredDb = dbProductIds.filter(p => !presetNames.has(p.name.toLowerCase()));
  return [
    ...presetIds,
    ...filteredDb.map(p => ({ id: p.id, name: p.name, displayName: p.displayName || p.name })),
  ];
}

function updateProductIdDropdown() {
  pidDD.update(
    getProductIdItems(),
    namingState.productId,
    (item) => {
      namingState.productId   = item.id;
      namingState.productName = item.name;
      pidDD.setSelected(item.id, item.displayName || item.name);
      scheduleSequenceFetch();
    },
    async (name) => {
      if (!name) return;
      try {
        const res = await apiFetch('/api/mtp-naming/product-ids', { method: 'POST', body: JSON.stringify({ name }) });
        const d = await res.json();
        if (d.success && d.productId) {
          dbProductIds.push(d.productId);
          updateProductIdDropdown();
          // Auto-select the newly created product ID
          const newItem = { ...d.productId, displayName: d.productId.displayName || d.productId.name };
          namingState.productId   = newItem.id;
          namingState.productName = newItem.name;
          pidDD.setSelected(newItem.id, newItem.displayName);
          scheduleSequenceFetch();
        }
      } catch (e) {}
    }
  );
}

// ─── Type dropdown ────────────────────────────────────────────────────────────

function getTypeItems() {
  if (!namingState.categoryId) return [];
  if (namingState.categoryId.startsWith('preset-')) return (PRESET_TYPES_BY_CATEGORY[namingState.categoryId] || []);
  return dbTypes.map(t => ({ id: t.id, name: t.name, displayName: t.displayName || t.name }));
}

function updateTypeDropdown() {
  const isPreset = namingState.categoryId.startsWith('preset-');
  typeDD.update(
    getTypeItems(),
    namingState.typeId,
    (item) => {
      namingState.typeId   = item.id;
      namingState.typeName = item.name;
      typeDD.setSelected(item.id, item.displayName || item.name);
      scheduleSequenceFetch();
    },
    isPreset ? null : async (name) => {
      if (!name || !namingState.categoryId) return;
      try {
        const res = await apiFetch('/api/mtp-naming/types', { method: 'POST', body: JSON.stringify({ name, categoryId: namingState.categoryId }) });
        const d = await res.json();
        if (d.success && d.type) {
          dbTypes.push(d.type);
          updateTypeDropdown();
          // Auto-select the newly created type
          const newItem = { ...d.type, displayName: d.type.displayName || d.type.name };
          namingState.typeId   = newItem.id;
          namingState.typeName = newItem.name;
          typeDD.setSelected(newItem.id, newItem.displayName);
          scheduleSequenceFetch();
        }
      } catch (e) {}
    }
  );
}

// ─── Folder dropdown ──────────────────────────────────────────────────────────

function buildFolderTree(folders) {
  const result = [];
  const visited = new Set();
  function add(folder, depth) {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    result.push({ ...folder, depth });
    folders.filter(f => f.parentId === folder.id).sort((a, b) => a.name.localeCompare(b.name)).forEach(c => add(c, depth + 1));
  }
  folders.filter(f => f.parentId === null).sort((a, b) => a.name.localeCompare(b.name)).forEach(r => add(r, 0));
  return result;
}

function updateFolderDropdown() {
  const tree = buildFolderTree(dbFolders);
  // Build items list: root + folders
  const items = [
    { id: '__root__', name: '', displayName: 'Root (no folder)', depth: 0 },
    ...tree.map(f => ({ id: String(f.id), name: f.name, displayName: f.name, depth: f.depth })),
  ];

  folderDD.update(
    items,
    selectedFolderId === null ? '__root__' : String(selectedFolderId),
    (item) => {
      if (item.id === '__root__') {
        selectedFolderId = null;
        folderDD.setSelected('__root__', 'Root (no folder)');
        $('folder-btn').classList.remove('has-value');
      } else {
        selectedFolderId = parseInt(item.id, 10);
        folderDD.setSelected(item.id, item.displayName);
      }
    },
    null
  );
}

// ─── New folder creation ──────────────────────────────────────────────────────

$('new-folder-btn').addEventListener('click', () => {
  $('new-folder-row').classList.remove('hidden');
  $('new-folder-name').focus();
});
$('new-folder-cancel').addEventListener('click', () => {
  $('new-folder-row').classList.add('hidden');
  $('new-folder-name').value = '';
});
$('new-folder-confirm').addEventListener('click', async () => {
  const name = $('new-folder-name').value.trim();
  if (!name) return;
  try {
    const res = await apiFetch('/api/mtp-folders', { method: 'POST', body: JSON.stringify({ name, parentId: null }) });
    const d = await res.json();
    if (d.success && d.folder) {
      dbFolders.push(d.folder);
      selectedFolderId = d.folder.id;
      updateFolderDropdown();
      folderDD.setSelected(String(d.folder.id), d.folder.name);
      $('new-folder-row').classList.add('hidden');
      $('new-folder-name').value = '';
    }
  } catch (e) {}
});

// ─── Variant input ────────────────────────────────────────────────────────────

$('variant-input').addEventListener('input', e => {
  namingState.variant = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '');
  e.target.value = namingState.variant;
  scheduleSequenceFetch();
});

// ─── In-browser prefetch (handles auth-gated URLs like Google Drive) ─────────
// The extension runs in the user's browser session, so fetch() here sends the
// user's cookies automatically — meaning Google Drive images, etc. work even
// though the server can't access them.

async function prefetchAsBase64(url) {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    // Only accept image types (guard against login redirect HTML pages)
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// URLs that need auth cookies for the server to reach them
function needsPrefetch(url) {
  try {
    const h = new URL(url).hostname;
    return h.endsWith('googleusercontent.com') ||
           h.endsWith('drive.google.com') ||
           h.endsWith('lh3.google.com') ||
           h.endsWith('photos.google.com');
  } catch { return false; }
}

// ─── Upload modal helpers ─────────────────────────────────────────────────────

function showUploadProgress(count) {
  uploadModalSub.textContent = `Uploading ${count} image${count !== 1 ? 's' : ''}… please wait`;
  uploadModalProg.classList.remove('hidden');
  uploadModalDone.classList.add('hidden');
  uploadModal.classList.remove('hidden');
}

function showUploadComplete(results, selectedImgs) {
  const ok    = results.filter(r => r.success).length;
  const total = results.length;
  const failed = total - ok;

  // Icon + title based on outcome
  if (ok === total) {
    uploadModalIconDone.className = 'upload-modal-result-icon success';
    uploadModalIconDone.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    uploadModalDoneTitle.textContent = 'Upload complete!';
  } else if (ok > 0) {
    uploadModalIconDone.className = 'upload-modal-result-icon partial';
    uploadModalIconDone.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    uploadModalDoneTitle.textContent = 'Partially uploaded';
  } else {
    uploadModalIconDone.className = 'upload-modal-result-icon error';
    uploadModalIconDone.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    uploadModalDoneTitle.textContent = 'Upload failed';
  }

  uploadModalDoneSub.textContent =
    failed === 0
      ? `${ok} of ${total} image${total !== 1 ? 's' : ''} uploaded successfully`
      : `${ok} uploaded · ${failed} failed`;

  // Build per-image list
  uploadModalList.innerHTML = '';
  results.forEach((r, i) => {
    const srcImg = selectedImgs.find(si => si.url === r.originalUrl) || selectedImgs[i];
    const row = document.createElement('div');
    row.className = `upload-modal-list-item ${r.success ? 'success' : 'error'}`;

    const dot = document.createElement('div');
    dot.className = `upload-modal-list-dot ${r.success ? 'success' : 'error'}`;

    const thumb = document.createElement('img');
    thumb.className = 'upload-modal-list-thumb';
    thumb.src = r.originalUrl;
    thumb.onerror = () => { thumb.style.display = 'none'; };

    const lbl = document.createElement('div');
    if (r.success) {
      lbl.className = 'upload-modal-list-label filename';
      lbl.textContent = r.filename || r.key || '\u2014';
      lbl.title = r.url || r.filename || '';
    } else {
      lbl.className = 'upload-modal-list-label err';
      lbl.textContent = r.error || 'Failed';
      lbl.title = r.error || '';
    }

    row.appendChild(dot); row.appendChild(thumb); row.appendChild(lbl);
    uploadModalList.appendChild(row);
  });

  uploadModalProg.classList.add('hidden');
  uploadModalDone.classList.remove('hidden');
}

uploadModalClose.addEventListener('click', () => {
  uploadModal.classList.add('hidden');
  allImages.forEach(img => { img.selected = false; });
  allVideos.forEach(vid => { vid.selected = false; });
  renderActiveTab();
});

// ─── Upload ───────────────────────────────────────────────────────────────────

uploadBtn.addEventListener('click', async () => {
  const isVideos = activeTab === 'videos';
  const selected = isVideos ? allVideos.filter(v => v.selected) : allImages.filter(i => i.selected);
  if (!selected.length || !namingState.categoryPrefix || !namingState.typeName) return;

  uploadBtn.disabled = true;

  // Mark selected items as uploading on the grid
  if (isVideos) {
    allVideos.forEach((vid, idx) => {
      if (!vid.selected) return;
      const s = $(`vstatus-${idx}`);
      if (s) { s.textContent = '\u2b06'; s.className = 'img-status uploading'; }
    });
  } else {
    allImages.forEach((img, idx) => {
      if (!img.selected) return;
      const s = $(`status-${idx}`);
      if (s) { s.textContent = '\u2b06'; s.className = 'img-status uploading'; }
    });
  }

  showUploadProgress(selected.length);

  // Prefetch auth-gated URLs in the browser (Google Drive, etc.)
  const prefetchedData = await Promise.all(
    selected.map(item => needsPrefetch(item.url) ? prefetchAsBase64(item.url) : Promise.resolve(null))
  );

  const payload = {
    imageUrls: selected.map(i => i.url),
    imageDataBase64: prefetchedData,
    category: namingState.categoryPrefix,
    productId: namingState.productName || undefined,
    type: namingState.typeName,
    variant: namingState.variant || undefined,
    folderId: selectedFolderId,
    convertToWebP: !isVideos && convertWebpChk.checked,
  };

  let results = [];
  try {
    const res = await apiFetch('/api/mtp-images/import-from-urls', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (res.ok && d.results) {
      results = d.results;
    } else {
      const errMsg = d.error || `Server error (${res.status})`;
      results = selected.map(item => ({ originalUrl: item.url, success: false, error: errMsg }));
    }
  } catch (e) {
    results = selected.map(item => ({ originalUrl: item.url, success: false, error: e.message }));
  }

  // Update status chips on the grid
  results.forEach(r => {
    if (isVideos) {
      const idx = allVideos.findIndex(v => v.url === r.originalUrl);
      if (idx < 0) return;
      const s = $(`vstatus-${idx}`);
      if (!s) return;
      if (r.success) { s.textContent = '\u2713'; s.className = 'img-status success'; }
      else           { s.textContent = '\u2717'; s.className = 'img-status error'; }
    } else {
      const idx = allImages.findIndex(i => i.url === r.originalUrl);
      if (idx < 0) return;
      const s = $(`status-${idx}`);
      if (!s) return;
      if (r.success) { s.textContent = '\u2713'; s.className = 'img-status success'; }
      else           { s.textContent = '\u2717'; s.className = 'img-status error'; }
    }
  });

  // Update modal library link based on active tab
  const modalLink = $('upload-modal-link');
  if (modalLink) {
    const baseUrl = settings.backendUrl || 'https://entremax-creativeai-studio.replit.app';
    modalLink.href = isVideos ? `${baseUrl}/video-library` : `${baseUrl}/image-library`;
    modalLink.querySelector('span, svg + svg') ?.remove?.();
  }

  showUploadComplete(results, selected);

  uploadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload to MTP';
  uploadBtn.disabled = false;
});

// ─── Top-level tab buttons (Library | Importer) ───────────────────────────────

$('main-tab-library').addEventListener('click', () => switchMainTab('library'));
$('main-tab-importer').addEventListener('click', () => switchMainTab('importer'));

// ─── Importer tab buttons ─────────────────────────────────────────────────────

tabImages.addEventListener('click', () => switchTab('images'));
tabVideos.addEventListener('click', () => switchTab('videos'));

// ─── Toolbar ──────────────────────────────────────────────────────────────────

$('select-all-btn').addEventListener('click', selectAll);
$('select-none-btn').addEventListener('click', selectNone);
$('refresh-btn').addEventListener('click', scanPageImages);
document.getElementById('retry-btn')?.addEventListener('click', scanPageImages);

// ─── Settings button ──────────────────────────────────────────────────────────

$('settings-btn').addEventListener('click', () => {
  settingsPanel.classList.contains('hidden') ? openSettings() : closeSettings();
});
$('settings-save-btn').addEventListener('click', saveSettings);
$('settings-test-btn').addEventListener('click', testConnection);

// ─── Check for Updates ────────────────────────────────────────────────────────

$('check-update-btn').addEventListener('click', async () => {
  const btn = $('check-update-btn');
  const statusEl = $('update-status');
  btn.disabled = true;
  btn.textContent = 'Checking\u2026';
  statusEl.classList.add('hidden');

  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Request timed out')), 12000);
      chrome.runtime.sendMessage(
        { type: 'CHECK_FOR_UPDATES', backendUrl: settings.backendUrl },
        response => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });

    if (result.status === 'updating') {
      showStatus(statusEl, 'Update found! Reloading extension\u2026', 'success');
    } else if (result.status === 'update_available') {
      showStatus(statusEl, `v${result.latestVersion} is available \u2014 download the latest zip from Creative AI Settings.`, '');
    } else if (result.status === 'up_to_date') {
      showStatus(statusEl, `You\u2019re up to date (v${result.currentVersion})`, 'success');
    } else if (result.status === 'no_server') {
      showStatus(statusEl, 'Save your Backend URL first to check for updates.', 'error');
    } else {
      showStatus(statusEl, `Could not check: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showStatus(statusEl, `Could not check for updates: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check for Updates';
  }
});

// ─── Close dropdowns on outside click ────────────────────────────────────────

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown').forEach(d => d.classList.add('hidden'));
  document.querySelectorAll('.select-btn').forEach(b => b.classList.remove('open'));
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadSettings();
  if (!settings.backendUrl || !settings.apiKey) { openSettings(); return; }
  await Promise.all([loadNamingData(), scanPageImages()]);
  // Seed the library folder dropdown with the same folders loaded for the importer
  updateLibFolderDropdown();
}

init();

// ═══════════════════════════════════════════════════════════════════════════════
// LIBRARY TAB
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Top-level tab switcher ────────────────────────────────────────────────────

function switchMainTab(tab) {
  mainTab = tab;
  // Update tab indicators
  document.querySelectorAll('.toplevel-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mainTab === tab);
  });
  // Show/hide panels
  if (tab === 'library') {
    libraryPanel.classList.remove('hidden');
    mainPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    // Always refresh folder dropdown with latest dbFolders before showing library
    updateLibFolderDropdown();
    // Load library on first visit (or if empty)
    if (libraryAllImages.length === 0 && libraryAllVideos.length === 0) {
      loadLibrary();
    } else {
      renderLibraryGrid();
    }
  } else {
    mainPanel.classList.remove('hidden');
    libraryPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
  }
}

// ─── Library sub-tab switcher ──────────────────────────────────────────────────

function switchLibraryTab(tab) {
  librarySubTab = tab;
  document.querySelectorAll('[data-lib-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.libTab === tab);
  });
  renderLibraryGrid();
}

// ─── Folder dropdown for library ──────────────────────────────────────────────

function updateLibFolderDropdown() {
  const allFoldersItem = { id: '__all__', name: 'All folders', displayName: 'All folders' };
  const items = [allFoldersItem, ...dbFolders.map(f => ({ id: String(f.id), name: f.name, displayName: f.name }))];
  libFolderDD.update(items, libraryFolderId ? String(libraryFolderId) : '__all__', item => {
    if (item.id === '__all__') {
      libraryFolderId = null;
      $('lib-folder-label').textContent = 'All folders';
      libFolderDD.setSelected('__all__', 'All folders');
    } else {
      libraryFolderId = item.id;
      $('lib-folder-label').textContent = item.displayName;
      libFolderDD.setSelected(item.id, item.displayName);
    }
    loadLibrary();
  });
}

// ─── Load library from API ─────────────────────────────────────────────────────

async function loadLibrary() {
  // Reset to page 1 whenever the data source changes
  libraryPage = 1;

  // Show loading state
  $('lib-loading').classList.remove('hidden');
  $('lib-empty').classList.add('hidden');
  $('lib-grid').classList.add('hidden');
  $('lib-pagination').classList.add('hidden');

  try {
    // Build query params
    const params = new URLSearchParams({ fileType: 'images' });
    if (librarySearch) params.set('search', librarySearch);
    if (libraryFolderId) params.set('folderId', libraryFolderId);

    const [imgRes, vidRes] = await Promise.all([
      apiFetch(`/api/mtp-images?${params}`),
      apiFetch(`/api/mtp-images?${new URLSearchParams({ fileType: 'videos', ...(librarySearch ? { search: librarySearch } : {}), ...(libraryFolderId ? { folderId: libraryFolderId } : {}) })}`),
    ]);

    const imgData = await imgRes.json();
    const vidData = await vidRes.json();

    libraryAllImages = imgData.items || [];
    libraryAllVideos = vidData.items || [];

    // Update sub-tab counts
    $('lib-images-count').textContent = libraryAllImages.length;
    $('lib-videos-count').textContent = libraryAllVideos.length;
  } catch (e) {
    console.error('[MTP Library] Load error:', e);
    libraryAllImages = [];
    libraryAllVideos = [];
  }

  $('lib-loading').classList.add('hidden');
  renderLibraryGrid();
}

// ─── Render library grid (paginated) ──────────────────────────────────────────

const VIDEO_EXTS = new Set([
  'mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'flv',
  'ts', 'm2ts', 'mts', '3gp', '3g2', 'ogv', 'mpg', 'mpeg',
  'f4v', 'divx', 'asf', 'rm', 'rmvb', 'vob', 'mxf', 'dv',
  'm3u8', 'mpd',
]);

function isVideoKey(key) {
  const ext = (key || '').split('.').pop().toLowerCase();
  return VIDEO_EXTS.has(ext);
}

function makeLibCard(item) {
  const isVid = isVideoKey(item.key);
  const shortName = (item.key || '').split('/').pop();
  const card = document.createElement('div');
  card.className = 'lib-card';
  card.title = shortName;

  if (isVid) {
    // Real video thumbnail — same technique as importer cards
    const videoEl = document.createElement('video');
    videoEl.src = item.url;
    videoEl.preload = 'metadata';
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.currentTime = 0.1;
    card.appendChild(videoEl);

    const playIcon = document.createElement('div');
    playIcon.className = 'lib-card-play-icon';
    playIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    card.appendChild(playIcon);
  } else {
    const imgEl = document.createElement('img');
    imgEl.src = item.url;
    imgEl.alt = shortName;
    imgEl.loading = 'lazy';
    card.appendChild(imgEl);
  }

  // Filename label (fades in on hover)
  const nameEl = document.createElement('div');
  nameEl.className = 'lib-card-name';
  nameEl.textContent = shortName;
  card.appendChild(nameEl);

  // Action buttons (open, copy)
  const actionsEl = document.createElement('div');
  actionsEl.className = 'lib-card-actions';
  actionsEl.innerHTML = `
    <button class="lib-card-action" title="Open in new tab" data-action="open" data-url="${item.url}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </button>
    <button class="lib-card-action" title="Copy URL" data-action="copy" data-url="${item.url}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    </button>`;
  card.appendChild(actionsEl);

  card.addEventListener('click', e => {
    const action = e.target.closest('[data-action]');
    if (action) {
      e.stopPropagation();
      if (action.dataset.action === 'open') {
        chrome.tabs.create({ url: action.dataset.url, active: false });
      } else if (action.dataset.action === 'copy') {
        navigator.clipboard.writeText(action.dataset.url).catch(() => {});
        const orig = action.title;
        action.title = 'Copied!';
        action.querySelector('svg').style.stroke = '#22c55e';
        setTimeout(() => { action.title = orig; action.querySelector('svg').style.stroke = ''; }, 1500);
      }
      return;
    }
    chrome.tabs.create({ url: item.url, active: false });
  });

  return card;
}

function renderLibraryGrid() {
  const grid = $('lib-grid');
  const pagination = $('lib-pagination');
  const allItems = librarySubTab === 'images' ? libraryAllImages : libraryAllVideos;
  const totalPages = Math.max(1, Math.ceil(allItems.length / LIBRARY_PAGE_SIZE));

  // Clamp page
  libraryPage = Math.min(Math.max(1, libraryPage), totalPages);

  if (allItems.length === 0) {
    grid.classList.add('hidden');
    pagination.classList.add('hidden');
    $('lib-empty').classList.remove('hidden');
    $('lib-empty-text').textContent = librarySearch
      ? 'No files match your search.'
      : librarySubTab === 'images' ? 'No images in library.' : 'No videos in library.';
    return;
  }

  // Slice to current page
  const start = (libraryPage - 1) * LIBRARY_PAGE_SIZE;
  const pageItems = allItems.slice(start, start + LIBRARY_PAGE_SIZE);

  $('lib-empty').classList.add('hidden');
  grid.classList.remove('hidden');
  grid.innerHTML = '';
  grid.scrollTop = 0;
  pageItems.forEach(item => grid.appendChild(makeLibCard(item)));

  // Update pagination bar
  $('lib-page-info').textContent = `Page ${libraryPage} of ${totalPages}  (${allItems.length} files)`;
  $('lib-prev').disabled = libraryPage <= 1;
  $('lib-next').disabled = libraryPage >= totalPages;
  pagination.classList.toggle('hidden', totalPages <= 1);
}

// ─── Library sub-tab buttons ───────────────────────────────────────────────────

$('lib-tab-images').addEventListener('click', () => switchLibraryTab('images'));
$('lib-tab-videos').addEventListener('click', () => switchLibraryTab('videos'));

// ─── Library search ────────────────────────────────────────────────────────────

$('lib-search').addEventListener('input', e => {
  librarySearch = e.target.value.trim();
  $('lib-search-clear').classList.toggle('hidden', !librarySearch);
  clearTimeout(libSearchTimeout);
  libSearchTimeout = setTimeout(loadLibrary, 350);
});

$('lib-search-clear').addEventListener('click', () => {
  $('lib-search').value = '';
  librarySearch = '';
  $('lib-search-clear').classList.add('hidden');
  loadLibrary();
});

// ─── Library pagination buttons ────────────────────────────────────────────────

$('lib-prev').addEventListener('click', () => {
  if (libraryPage > 1) { libraryPage--; renderLibraryGrid(); }
});

$('lib-next').addEventListener('click', () => {
  const allItems = librarySubTab === 'images' ? libraryAllImages : libraryAllVideos;
  const totalPages = Math.ceil(allItems.length / LIBRARY_PAGE_SIZE);
  if (libraryPage < totalPages) { libraryPage++; renderLibraryGrid(); }
});
