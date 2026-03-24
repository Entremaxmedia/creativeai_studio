// MTP Image Importer - Content Script
// Returns { images: [{url, thumb?}], videos: [{url, poster?}] }
// For Google Drive, thumbnails are pre-fetched as base64 within the page's
// auth context so the popup can display them without needing authentication.

(async function collectMedia() {

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function fetchBase64(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  async function fetchAllBase64(urls, concurrency = 8) {
    const results = new Array(urls.length).fill(null);
    let next = 0;
    async function worker() {
      while (next < urls.length) {
        const i = next++;
        results[i] = await fetchBase64(urls[i]);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  // ── URL collection sets ────────────────────────────────────────────────────

  const imageEntries = new Map(); // url → thumbUrl | null
  const videoMap     = new Map(); // url → { poster: string|null }

  function addVideo(url, poster) {
    if (!url || typeof url !== 'string') return;
    url = url.trim();
    if (url.startsWith('blob:') || url.startsWith('data:') || !url.startsWith('http')) return;
    try { new URL(url); } catch { return; }
    if (!videoMap.has(url)) {
      videoMap.set(url, { poster: poster || null });
    } else if (poster && !videoMap.get(url).poster) {
      videoMap.get(url).poster = poster;
    }
  }

  // Extract all HTTP video file URLs embedded in an arbitrary text string.
  // Catches MP4/WebM/MOV/M3U8/MPD etc. inside JSON, JS, HTML attributes, etc.
  function extractVideoUrls(text) {
    if (!text || typeof text !== 'string') return [];
    const found = [];
    // Match URLs ending in common video extensions (with optional query string)
    const re = /https?:\/\/[^\s"'`<>\\\])}|,]+\.(?:mp4|m4v|webm|mov|mkv|avi|wmv|flv|ts|m2ts|mts|3gp|3g2|ogv|mpg|mpeg|f4v|divx|asf|rm|rmvb|vob|mxf|dv|m3u8|mpd)(?:[?#][^\s"'`<>\\\])}|,]*)?/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      // Strip trailing punctuation that might have been matched
      let url = m[0].replace(/[.,;:!?\])}]+$/, '');
      try { new URL(url); found.push(url); } catch {}
    }
    return found;
  }

  // ── 1. <video> element scanning ────────────────────────────────────────────
  // Amazon and many other sites use blob: src URLs created by MediaSource API.
  // We collect the poster (real CDN thumbnail), and scan nearby DOM + inline
  // scripts below to find the actual MP4/m3u8 source URL.

  const blobVideoPosters = []; // posters from blob-src video elements

  document.querySelectorAll('video').forEach(video => {
    const poster = (video.poster && video.poster.startsWith('http')) ? video.poster : null;

    // currentSrc is the most reliable — it reflects resolved <source> children
    // video.src may differ from getAttribute('src') if JS rewrote it to blob:
    const srcsToCheck = [
      video.currentSrc,
      video.src,
      video.getAttribute('src'),
    ];
    let foundReal = false;
    srcsToCheck.forEach(src => {
      if (src && src.startsWith('http')) { addVideo(src, poster); foundReal = true; }
    });

    // data-* attributes on the <video> element
    const VIDEO_ATTRS = ['data-src', 'data-video-url', 'data-mp4', 'data-url',
                         'data-stream', 'data-hls', 'data-dash', 'data-manifest'];
    VIDEO_ATTRS.forEach(attr => {
      const v = video.getAttribute(attr);
      if (v) extractVideoUrls(v).forEach(u => { addVideo(u, poster); foundReal = true; });
    });

    // <source> children
    video.querySelectorAll('source').forEach(s => {
      const src = s.getAttribute('src') || (s.src !== location.href ? s.src : '');
      if (src && src.startsWith('http')) { addVideo(src, poster); foundReal = true; }
      const ds = s.getAttribute('data-src');
      if (ds) extractVideoUrls(ds).forEach(u => { addVideo(u, poster); foundReal = true; });
    });

    // Track blob-src video elements — we'll scan the DOM and scripts for real URL
    const rawSrc = video.getAttribute('src') || '';
    if (rawSrc.startsWith('blob:') || (!foundReal && poster)) {
      if (poster) blobVideoPosters.push(poster);
    }

    // Walk up the DOM tree (up to 10 levels) looking for data attrs with video URLs
    // (Amazon, YouTube embeds, Vimeo, etc. store metadata on player containers)
    if (!foundReal || rawSrc.startsWith('blob:')) {
      let el = video.parentElement;
      let depth = 0;
      while (el && depth < 10) {
        Array.from(el.attributes || []).forEach(attr => {
          if (attr.value && attr.value.length > 5) {
            extractVideoUrls(attr.value).forEach(u => addVideo(u, poster));
          }
        });
        el = el.parentElement;
        depth++;
      }
    }
  });

  // ── 2. Inline <script> tag scanning ───────────────────────────────────────
  // Catches Amazon's per-product video config JSON, Vimeo/player API data,
  // video.js configuration objects, etc. — wherever CDN URLs are embedded
  // in JavaScript on the page.

  document.querySelectorAll('script:not([src])').forEach(script => {
    const content = script.textContent || '';
    if (content.length > 800000) return; // skip unreasonably huge bundles
    // Associate discovered URLs with the first blob video's poster (best guess)
    const poster = blobVideoPosters.length > 0 ? blobVideoPosters[0] : null;
    extractVideoUrls(content).forEach(u => addVideo(u, poster));
  });

  // ── 3. data-* attributes on player container elements ─────────────────────
  // Many players (JW Player, Brightcove, etc.) store the video URL in data
  // attributes on a <div> wrapping the player, not on the <video> itself.

  const CONTAINER_ATTRS = [
    'data-video-url', 'data-src', 'data-mp4', 'data-video',
    'data-stream-url', 'data-manifest-url', 'data-hls-url',
    'data-dash-url', 'data-video-src', 'data-media-url',
    'data-file', 'data-sources', 'data-setup',
  ];

  document.querySelectorAll(CONTAINER_ATTRS.map(a => `[${a}]`).join(',')).forEach(el => {
    if (el.tagName === 'VIDEO') return; // already handled above
    CONTAINER_ATTRS.forEach(attr => {
      const v = el.getAttribute(attr);
      if (!v) return;
      extractVideoUrls(v).forEach(u => addVideo(u, null));
      // data-setup / data-sources may contain JSON
      if ((attr === 'data-setup' || attr === 'data-sources') && v.startsWith('[') || v.startsWith('{')) {
        try {
          const parsed = JSON.parse(v);
          function extractFromJson(obj) {
            if (!obj) return;
            if (typeof obj === 'string') { extractVideoUrls(obj).forEach(u => addVideo(u, null)); return; }
            if (Array.isArray(obj)) { obj.forEach(extractFromJson); return; }
            if (typeof obj === 'object') { Object.values(obj).forEach(extractFromJson); }
          }
          extractFromJson(parsed);
        } catch {}
      }
    });
  });

  // ── 4. JSON-LD structured data ─────────────────────────────────────────────

  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    try {
      const data = JSON.parse(script.textContent || '');
      function walkLd(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(walkLd); return; }
        const t = obj['@type'];
        if (t === 'VideoObject' || t === 'Video' || t === 'MediaObject') {
          const url = obj.contentUrl || obj.embedUrl;
          const thumb = typeof obj.thumbnailUrl === 'string' ? obj.thumbnailUrl : null;
          if (url) extractVideoUrls(url).forEach(u => addVideo(u, thumb));
          if (url && url.startsWith('http') && !url.startsWith('blob:')) addVideo(url, thumb);
        }
        Object.values(obj).forEach(v => { if (v && typeof v === 'object') walkLd(v); });
      }
      walkLd(data);
    } catch {}
  });

  // ── 5. OG / Twitter / itemprop meta tags ──────────────────────────────────

  document.querySelectorAll([
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]',
    'meta[name="twitter:player:stream"]',
    'meta[itemprop="contentUrl"]',
    'meta[itemprop="embedUrl"]',
  ].join(',')).forEach(meta => {
    const c = meta.getAttribute('content') || '';
    // Try regex first (catches extension-having URLs)
    extractVideoUrls(c).forEach(u => addVideo(u, null));
    // Also accept bare HTTP URLs even without a video extension (OG video)
    if (c.startsWith('http') && !c.startsWith('blob:')) addVideo(c, null);
  });

  // ── 6. <a> links pointing directly to video files ─────────────────────────

  document.querySelectorAll('a[href]').forEach(a => {
    const h = a.href || '';
    if (/\.(mp4|m4v|webm|mov|mkv|avi|wmv|flv|ts|m2ts|mts|3gp|3g2|ogv|mpg|mpeg|f4v|divx|asf|rm|rmvb|vob|mxf|dv|m3u8|mpd)(\?|#|$)/i.test(h)) {
      addVideo(h, null);
    }
  });

  // ── Images ─────────────────────────────────────────────────────────────────

  // 1. <img> tags (src, srcset, lazy attrs)
  document.querySelectorAll('img').forEach(img => {
    const src = img.src;
    if (src && src.startsWith('http') && !src.includes('drive.google.com')) imageEntries.set(src, null);
    if (img.srcset) {
      img.srcset.split(',').forEach(part => {
        const u = part.trim().split(/\s+/)[0];
        if (u && u.startsWith('http') && !u.includes('drive.google.com')) imageEntries.set(u, null);
      });
    }
    ['data-src', 'data-lazy', 'data-original', 'data-lazy-src', 'data-image-src'].forEach(attr => {
      const v = img.getAttribute(attr);
      if (v && v.startsWith('http') && !v.includes('drive.google.com')) imageEntries.set(v, null);
    });
  });

  // 2. OG / Twitter meta tags
  document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"], meta[name="twitter:image:src"]').forEach(meta => {
    const c = meta.getAttribute('content');
    if (c && c.startsWith('http')) imageEntries.set(c, null);
  });

  // 3. <picture> sources
  document.querySelectorAll('picture source').forEach(source => {
    (source.getAttribute('srcset') || '').split(',').forEach(part => {
      const u = part.trim().split(/\s+/)[0];
      if (u && u.startsWith('http')) imageEntries.set(u, null);
    });
  });

  // 4. CSS background-image (first 2000 elements)
  let bgChecked = 0;
  for (const el of document.querySelectorAll('*')) {
    if (bgChecked++ > 2000) break;
    try {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
        if (m) imageEntries.set(m[1], null);
      }
    } catch {}
  }

  // 5. <a> links to image files
  document.querySelectorAll('a[href]').forEach(a => {
    const h = a.href;
    if (h && /\.(jpg|jpeg|png|gif|webp|svg|bmp|heic|heif)(\?|#|$)/i.test(h)) imageEntries.set(h, null);
  });

  // ── Google Drive ───────────────────────────────────────────────────────────

  if (window.location.hostname === 'drive.google.com') {
    document.querySelectorAll('[data-id]').forEach(el => {
      const fileId = el.getAttribute('data-id');
      if (!fileId || !/^[a-zA-Z0-9_-]{15,60}$/.test(fileId)) return;
      const thumbImg = el.querySelector('img[src]');
      if (!thumbImg) return;
      const thumbSrc = thumbImg.getAttribute('src') || thumbImg.src;
      if (!thumbSrc || thumbSrc.startsWith('data:')) return;
      const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const label = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.textContent || '';
      const isVideo = /\.(mp4|m4v|webm|mov|mkv|avi|wmv|flv|ts|m2ts|mts|3gp|3g2|ogv|mpg|mpeg|f4v|divx|asf|rm|rmvb|vob|mxf|dv|m3u8|mpd)\b/i.test(label) ||
                      el.querySelector('[data-type="video"]') !== null;
      if (isVideo) { addVideo(downloadUrl, null); }
      else { imageEntries.set(downloadUrl, thumbSrc); }
    });
    document.querySelectorAll('video, video source').forEach(el => {
      const src = el.src || el.getAttribute('src');
      if (src && src.startsWith('http')) addVideo(src, null);
    });
  }

  // ── Filter junk URLs ───────────────────────────────────────────────────────

  function isJunk(url) {
    const l = url.toLowerCase();
    return l.includes('google-analytics') ||
      l.includes('googletagmanager') ||
      l.includes('facebook.com/tr') ||
      l.includes('/pixel/') ||
      l.includes('/beacon/') ||
      /\/(1x1|tracking|pixel)\.(gif|png|jpg|mp4)/.test(l);
  }

  const cleanImageEntries = Array.from(imageEntries.entries()).filter(([u]) => !isJunk(u));
  const cleanVideoEntries = Array.from(videoMap.entries()).filter(([u]) => !isJunk(u));

  // ── Prefetch Drive thumbnails as base64 ────────────────────────────────────

  const toFetch = cleanImageEntries
    .map(([url, thumbUrl], idx) => ({ idx, url, thumbUrl }))
    .filter(e => e.thumbUrl !== null);

  let base64Results = [];
  if (toFetch.length > 0) {
    base64Results = await fetchAllBase64(toFetch.map(e => e.thumbUrl));
  }

  const images = cleanImageEntries.map(([url, thumbUrl], idx) => {
    if (thumbUrl === null) return { url };
    const fi = toFetch.findIndex(e => e.idx === idx);
    const b64 = fi >= 0 ? base64Results[fi] : null;
    return { url, thumb: b64 || undefined };
  });

  const videos = cleanVideoEntries.map(([url, { poster }]) => ({
    url,
    ...(poster ? { poster } : {}),
  }));

  return { images, videos };

})();
