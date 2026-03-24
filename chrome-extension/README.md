# MTP Image Importer — Chrome Extension

A Chrome extension that lets you scrape images from any web page and upload them directly to the MTP-Images library with the correct naming convention.

## Installation (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder from this project
5. The "MTP Image Importer" extension will appear in your extensions bar

## First-Time Setup

1. Click the extension icon in Chrome's toolbar
2. The Settings panel opens automatically on first use
3. Enter your **Backend URL** — the full URL of your deployed Entremax app (e.g. `https://your-app.replit.app`)
4. Enter your **API Key** — this must match the `MTP_IMPORT_API_KEY` secret set on the server
5. Click **Test Connection** to verify it works
6. Click **Save Settings**

## How to Use

1. Navigate to any web page containing images you want to import
2. Click the MTP Image Importer icon — it will scan the page and show all found images in a grid
3. Click images to select/deselect them (a purple border shows selected state)
4. Fill in the naming fields:
   - **Category** (required) — e.g. Product, Ad Creative, Lifestyle, Element
   - **Product/ID** (optional) — e.g. fb, yt, your-product-id
   - **Type** (required) — e.g. photo, hero, graphic
   - **Variant** (optional) — e.g. blue, v2
5. Optionally select or create a **Folder** for organization
6. The filename preview updates automatically showing what the files will be named
7. Click **Upload to MTP** — images upload with auto-incrementing sequence numbers
8. Green checkmarks appear on successful uploads; red X on failures
9. The results panel shows the final filenames for all uploads

## Features

- Scrapes `<img>` tags, srcset, Open Graph meta tags, CSS background-images, `<picture>` sources, and image links
- Dropdowns populated live from your backend (same categories/types as the web app)
- "Add new" option in each dropdown when you type a name that doesn't exist yet
- Auto-increments sequence numbers to avoid filename collisions (checks existing R2 files)
- Per-image upload status shown on the grid thumbnails
- Settings (URL + API key) are saved locally in Chrome storage

## File Structure

```
chrome-extension/
├── manifest.json        # Manifest V3
├── background.js        # Service worker
├── content-script.js   # Image scraper (injected into page)
├── popup.html           # Extension popup UI
├── popup.css            # Popup styling
├── popup.js             # Popup logic
├── generate-icons.js   # Script to regenerate PNG icons
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Backend Endpoint

The extension communicates with:

```
POST /api/mtp-images/import-from-urls
Header: x-api-key: <MTP_IMPORT_API_KEY>
Body: {
  imageUrls: ["https://example.com/image.jpg", ...],
  category: "pr",          // category abbreviation (required)
  productId: "fb",         // optional
  type: "photo",           // type segment (required)
  variant: "blue",         // optional
  folderId: 42             // optional virtual folder ID
}
```

The server computes the MTP filename prefix server-side, scans R2 for existing files to find the next sequence number, downloads each image (with SSRF protection blocking private/localhost URLs), and uploads to Cloudflare R2. Returns per-image success/failure with the final generated filename.

## Regenerating Icons

If you want to customize the icons:

```bash
node chrome-extension/generate-icons.js
```

This requires the project's dependencies (sharp) to be installed.
