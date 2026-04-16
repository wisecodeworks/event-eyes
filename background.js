'use strict';

/**
 * Generates a cryptographically random nonce used to validate
 * postMessage traffic between injected.js (MAIN world) and content.js
 * (ISOLATED world), preventing a malicious page from spoofing events.
 */
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // If content.js is already running on this tab, just toggle the panel.
  // This avoids re-injecting scripts on every click.
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'EE_TOGGLE' });
    if (res && res.handled) return;
  } catch {
    // No content script running on this tab — fall through to fresh injection.
  }

  const nonce = generateNonce();

  try {
    // Step 1 — Plant nonce into MAIN world so injected.js can read it at startup.
    // We delete it from window immediately inside injected.js to minimise exposure.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (n) => { window.__eeNonce = n; },
      args: [nonce],
      world: 'MAIN'
    });

    // Step 2 — Run the interception script in the page's own JS context (MAIN world).
    // This gives it access to the real window.dataLayer, navigator.sendBeacon, etc.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['injected.js'],
      world: 'MAIN'
    });

    // Step 3 — Plant nonce into ISOLATED world so content.js can validate messages.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (n) => { window.__eeContentNonce = n; },
      args: [nonce],
      world: 'ISOLATED'
    });

    // Step 4 — Run the UI panel script in the extension's isolated world.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
      world: 'ISOLATED'
    });

  } catch (err) {
    console.error('[Event Eyes] Injection failed:', err.message);
  }
});
