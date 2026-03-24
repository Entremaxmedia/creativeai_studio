// Creative AI - Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  // Open the side panel when the toolbar icon is clicked
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log('[Creative AI] Extension installed');
});

// Relay messages from side panel to content script and back
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ type: 'PONG' });
    return true;
  }

  if (message.type === 'CHECK_FOR_UPDATES') {
    handleUpdateCheck(message.backendUrl, sendResponse);
    return true; // Keep channel open for async response
  }
});

async function handleUpdateCheck(backendUrl, sendResponse) {
  const currentVersion = chrome.runtime.getManifest().version;

  // Step 1: Try Chrome's native update check (only works for CRX-installed extensions)
  try {
    const nativeResult = await new Promise(resolve => {
      chrome.runtime.requestUpdateCheck((status, details) => {
        resolve({ status, details });
      });
    });

    if (nativeResult.status === 'update_available') {
      // Chrome has already downloaded the update — reload to apply it
      setTimeout(() => chrome.runtime.reload(), 1500);
      sendResponse({ status: 'updating', currentVersion });
      return;
    }
  } catch (e) {
    // requestUpdateCheck unavailable or failed — fall through to server check
  }

  // Step 2: Fallback — ask our server for the latest version number.
  // Works for both CRX and unpacked installs; at minimum tells the user a new
  // version is available so they know to re-download.
  if (!backendUrl) {
    sendResponse({ status: 'no_server', currentVersion });
    return;
  }

  try {
    const res = await fetch(`${backendUrl}/api/extension/version`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const data = await res.json();
    const latestVersion = data.version;

    if (compareVersions(latestVersion, currentVersion) > 0) {
      sendResponse({ status: 'update_available', currentVersion, latestVersion });
    } else {
      sendResponse({ status: 'up_to_date', currentVersion });
    }
  } catch (err) {
    sendResponse({ status: 'error', error: err.message, currentVersion });
  }
}

// Returns positive if a > b, negative if a < b, 0 if equal
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
