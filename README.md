# Event Eyes

A Chrome extension for monitoring analytics events in real time — dataLayer pushes, GA4 network hits, and third-party tag detection — without opening DevTools.

![Version](https://img.shields.io/badge/version-1.2.0-FF4876) ![Manifest](https://img.shields.io/badge/manifest-v3-blue)

---

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the **`Event Eyes`** subfolder (the one containing `manifest.json`)

Click the extension icon in the toolbar to toggle the panel on any page.

---

## Features

### Real-time event monitoring
Event Eyes intercepts analytics traffic at the lowest level — before GTM, GA4, or any other tag can cache native browser APIs. Events are captured even on pages you were already on when the extension was installed.

- **dataLayer pushes** — every `window.dataLayer.push()` call, including pre-existing items
- **GA4 network hits** — intercepted via `sendBeacon`, `fetch`, XHR, and a `PerformanceObserver` fallback
- Parsed event name, parameters, client ID, session ID, page title, and location

### Four tabs

| Tab | What it shows |
|-----|--------------|
| **All** | Every event in chronological order (newest first) |
| **dataLayer** | Only `dataLayer.push` events |
| **GA4 Requests** | Only GA4 network hits (`/g/collect`) with parsed parameters |
| **Tags** | Third-party scripts detected on the current page |

### Tags detection
The Tags tab scans `<script>` elements and performance resource entries against **30 known analytics and marketing tag patterns**, including:

Google Tag Manager · GA4 · Segment · Hotjar · Heap · Mixpanel · Amplitude · Facebook Pixel · LinkedIn Insight · HubSpot · Intercom · Drift · Optimizely · Microsoft Clarity · Pendo · FullStory · Sentry · Datadog RUM · VWO · Mouseflow · Lucky Orange · Marketo · Pardot · Braze · TikTok Pixel · Twitter/X Pixel · Pinterest Tag · Qualtrics · Chartbeat · Snowplow

A **Refresh** button rescans the page — useful on single-page apps where tags load after the initial render.

### Export
Click **Export** in the panel header to download all captured events as a timestamped `.json` file. Useful for sharing with teammates or auditing event schemas offline.

### Element highlighting
Events triggered by a user click show a `⊙` indicator and a pointer cursor. Clicking the event row scrolls the page to the element that triggered it and flashes a pink outline around it for 2 seconds.

Works for any event (dataLayer or GA4) that fires within 1.5 seconds of a click.

### Filter and search
Type in the filter bar to search across event names and all parameter values simultaneously. Filtering works within whichever tab is active.

### Panel controls
- **Drag** — grab the header to reposition the panel anywhere on screen
- **Resize** — drag the top-left corner handle to resize
- **Minimize** — collapse to a title bar with `_`
- **Clear** — wipe the current event log without reloading the page
- **Close** — dismiss the panel (click the extension icon to reopen)

---

## Architecture

The extension runs across four scripts with deliberate world isolation:

| File | World | Purpose |
|------|-------|---------|
| `early.js` | MAIN (document_start) | Intercepts `dataLayer`, `sendBeacon`, `fetch`, and XHR before any page script runs. Buffers events until the panel opens. |
| `injected.js` | MAIN (on-demand) | Replays the early buffer and forwards live events to `content.js` via nonce-validated `postMessage`. |
| `content.js` | ISOLATED | Renders the UI panel and receives events from `injected.js`. |
| `background.js` | Service worker | Handles toolbar icon clicks and orchestrates script injection. |

A random nonce generated per-session validates all cross-world messages, preventing a malicious page from injecting fake events into the panel.

---

## Privacy and security

- No data is sent anywhere — all event capture and display is local to your browser tab
- All user-supplied values are inserted via `textContent`, never `innerHTML`
- The panel stops GTM's click auto-events from polluting the log (clicks on the panel itself are filtered out at both the DOM propagation level and the dataLayer interceptor)

---

## Changelog

### v1.2.0
- Added **Tags tab** — detects 30 common analytics/marketing scripts
- Added **Export** — download captured events as JSON
- Added **element highlighting** — click an event row to highlight the triggering element on the page
- Fixed phantom click events caused by GTM's auto-click trigger firing on panel interactions

### v1.1.0
- Drag, resize, and minimize support
- Nonce-based postMessage security between MAIN and ISOLATED worlds
- PerformanceObserver fallback for GA4 hits that bypass interceptors

### v1.0.0
- Initial release: dataLayer and GA4 monitoring
