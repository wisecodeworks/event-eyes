;(function () {
  'use strict';

  // Read and remove the nonce planted by background.js in the ISOLATED world.
  const NONCE = window.__eeContentNonce || '';
  delete window.__eeContentNonce;

  const PANEL_ID = 'event-eyes-panel';
  const STYLE_ID  = 'event-eyes-style';

  // ── Prevent double-initialisation (e.g. if executeScript is called twice) ──
  if (window.__eeContentInit) {
    if (!document.getElementById(PANEL_ID)) createPanel();
    return;
  }
  window.__eeContentInit = true;

  // ── State ──────────────────────────────────────────────────────────────
  let events      = [];
  let counter     = 0;
  let activeFilter = 'all';
  let filterText  = '';

  // Cached DOM refs set during createPanel()
  let logEl    = null;
  let countEl  = null;
  let tabEls   = null;

  // ── Background message handler ─────────────────────────────────────────
  // Lets the toolbar icon act as a true toggle after the first injection.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'EE_TOGGLE') return;
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.remove();
      sendResponse({ handled: true, visible: false });
    } else {
      createPanel();
      sendResponse({ handled: true, visible: true });
    }
    return true; // keep channel open for async sendResponse
  });

  // ── Event bridge from injected.js ─────────────────────────────────────
  // Only accept messages that carry our nonce — rejects anything a
  // malicious page might try to post into the panel.
  window.addEventListener('message', (e) => {
    if (
      !e.data ||
      e.data.__eventEyes !== true ||
      e.data.nonce !== NONCE ||
      !NONCE
    ) return;

    addEvent(e.data.type, e.data.name, e.data.data, e.data.timestamp);
  });

  // ── Event management ───────────────────────────────────────────────────

  function addEvent(type, name, data, ts) {
    counter++;
    events.unshift({ id: counter, type, name, data, timestamp: ts });
    if (events.length > 200) events.pop();
    renderEvents();
  }

  // ── Panel construction ─────────────────────────────────────────────────
  // All user-supplied values are inserted via textContent — never innerHTML.

  function createPanel() {
    injectStyles();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    // ── Resize handle (top-left corner) ──
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ee-resize';
    panel.appendChild(resizeHandle);

    // ── Header ──
    const hdr = document.createElement('div');
    hdr.className = 'ee-hdr';

    const title = document.createElement('div');
    title.className = 'ee-title';
    const icon = document.createElement('span');
    icon.textContent = '👁';
    title.appendChild(icon);
    title.appendChild(document.createTextNode(' Event Eyes'));

    countEl = document.createElement('span');
    countEl.className = 'ee-count';

    const btns = document.createElement('div');
    btns.className = 'ee-btns';

    const clearBtn = makeBtn('Clear', () => { events = []; renderEvents(); });
    const miniBtn  = makeBtn('_',     () => {
      panel.classList.toggle('ee-mini');
      miniBtn.textContent = panel.classList.contains('ee-mini') ? '□' : '_';
    });
    const closeBtn = makeBtn('✕', () => panel.remove());

    btns.append(clearBtn, miniBtn, closeBtn);
    hdr.append(title, countEl, btns);
    panel.appendChild(hdr);

    // ── Tabs ──
    const tabBar = document.createElement('div');
    tabBar.className = 'ee-tabs';

    const tabDefs = [
      { label: 'All',          value: 'all' },
      { label: 'dataLayer',    value: 'dataLayer' },
      { label: 'GA4 Requests', value: 'ga4', extra: 'ga4' }
    ];

    tabEls = tabDefs.map(def => {
      const tab = document.createElement('div');
      tab.className = 'ee-tab' +
        (def.value === activeFilter ? ' active' : '') +
        (def.extra ? ` ${def.extra}` : '');
      tab.textContent = def.label;
      tab.dataset.filter = def.value;
      tab.addEventListener('click', function () {
        tabEls.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        activeFilter = this.dataset.filter;
        renderEvents();
      });
      tabBar.appendChild(tab);
      return tab;
    });

    panel.appendChild(tabBar);

    // ── Filter ──
    const filterWrap = document.createElement('div');
    filterWrap.className = 'ee-filter';
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.placeholder = 'Filter by event name or parameter…';
    filterInput.addEventListener('input', () => {
      filterText = filterInput.value.toLowerCase();
      renderEvents();
    });
    filterWrap.appendChild(filterInput);
    panel.appendChild(filterWrap);

    // ── Log ──
    logEl = document.createElement('div');
    logEl.className = 'ee-log';
    panel.appendChild(logEl);

    document.body.appendChild(panel);

    setupDrag(hdr, panel);
    setupResize(resizeHandle, panel);

    renderEvents();
  }

  function makeBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function renderEvents() {
    if (!logEl) return;

    const dlCount  = events.filter(e => e.type === 'dataLayer').length;
    const ga4Count = events.filter(e => e.type === 'ga4').length;
    if (countEl) countEl.textContent = `${dlCount} DL / ${ga4Count} GA4`;

    const filtered = events.filter(evt => {
      if (activeFilter !== 'all' && evt.type !== activeFilter) return false;
      if (filterText) {
        const hay = (evt.name + ' ' + safeStringify(evt.data)).toLowerCase();
        if (!hay.includes(filterText)) return false;
      }
      return true;
    });

    // Clear log safely
    while (logEl.firstChild) logEl.removeChild(logEl.firstChild);

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ee-empty';
      empty.textContent = events.length === 0
        ? 'Waiting for events…'
        : 'No events match filter';
      logEl.appendChild(empty);
      return;
    }

    for (const evt of filtered) {
      logEl.appendChild(buildEventEl(evt));
    }
  }

  function buildEventEl(evt) {
    const isGA4 = evt.type === 'ga4';

    const el = document.createElement('div');
    el.className = 'ee-evt' + (isGA4 ? ' ga4' : '');

    // Header row
    const hdr = document.createElement('div');
    hdr.className = 'ee-evt-hdr';

    const time = document.createElement('span');
    time.className = 'ee-evt-time';
    time.textContent = evt.timestamp;

    const badge = document.createElement('span');
    badge.className = 'ee-evt-badge ' + (isGA4 ? 'ga4' : 'dl');
    badge.textContent = isGA4 ? 'GA4' : 'DL';

    const name = document.createElement('span');
    name.className = 'ee-evt-name';
    name.textContent = evt.name; // textContent — never innerHTML

    hdr.append(time, badge, name);
    el.appendChild(hdr);

    // Parameter rows
    if (evt.data && typeof evt.data === 'object') {
      const pairs = flattenParams(evt.data);
      if (pairs.length > 0) {
        const paramsWrap = document.createElement('div');
        paramsWrap.className = 'ee-params';

        for (const [key, val] of pairs) {
          const row = document.createElement('div');
          row.className = 'ee-param';

          const k = document.createElement('span');
          k.className = 'ee-param-key';
          k.textContent = key; // textContent — safe

          const v = document.createElement('span');
          v.className = 'ee-param-val';
          v.textContent = typeof val === 'object' && val !== null
            ? safeStringify(val) : String(val); // textContent — safe

          row.append(k, v);
          paramsWrap.appendChild(row);
        }

        el.appendChild(paramsWrap);
      }
    }

    return el;
  }

  /**
   * Flattens one level of nested objects into dot-notation key/value pairs
   * for display. Skips 'event' and 'eventName' since they're shown in the header.
   */
  function flattenParams(data) {
    const result = [];
    for (const [key, val] of Object.entries(data)) {
      if (key === 'event' || key === 'eventName' || key === '_source') continue;
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        for (const [subKey, subVal] of Object.entries(val)) {
          result.push([`${key}.${subKey}`, subVal]);
        }
      } else {
        result.push([key, val]);
      }
    }
    return result;
  }

  function safeStringify(obj) {
    const seen = new WeakSet();
    try {
      return JSON.stringify(obj, (k, v) => {
        if (typeof v === 'function') return '[Function]';
        if (v instanceof Element) return `[Element:${v.tagName}]`;
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      }, 2);
    } catch {
      return '[Unserializable]';
    }
  }

  // ── Drag ───────────────────────────────────────────────────────────────

  function setupDrag(handle, panel) {
    let active = false, startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      active = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.style.right  = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left   = rect.left + 'px';
      panel.style.top    = rect.top  + 'px';
    });

    document.addEventListener('mousemove', (e) => {
      if (!active) return;
      panel.style.left = (startLeft + e.clientX - startX) + 'px';
      panel.style.top  = (startTop  + e.clientY - startY) + 'px';
    });

    document.addEventListener('mouseup', () => { active = false; });
  }

  // ── Resize (top-left handle) ───────────────────────────────────────────

  function setupResize(handle, panel) {
    let active = false, startX, startY, startW, startH, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = panel.getBoundingClientRect();
      active = true;
      startX = e.clientX; startY = e.clientY;
      startW = rect.width; startH = rect.height;
      startLeft = rect.left; startTop = rect.top;
      panel.style.right  = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left   = rect.left + 'px';
      panel.style.top    = rect.top  + 'px';
    });

    document.addEventListener('mousemove', (e) => {
      if (!active) return;
      const newW = Math.max(360, startW + (startX - e.clientX));
      const newH = Math.max(300, startH + (startY - e.clientY));
      panel.style.width  = newW + 'px';
      panel.style.height = newH + 'px';
      panel.style.left   = (startLeft - (newW - startW)) + 'px';
      panel.style.top    = (startTop  - (newH - startH)) + 'px';
    });

    document.addEventListener('mouseup', () => { active = false; });
  }

  // ── Styles ─────────────────────────────────────────────────────────────
  // Injected once into <head>. All selectors are scoped under #event-eyes-panel
  // to avoid colliding with any page styles.

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#event-eyes-panel {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 500px;
  height: 550px;
  background: #0a0a0a;
  border: 2px solid #FF4876;
  border-radius: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
  font-size: 12px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  min-width: 360px;
  min-height: 300px;
  overflow: hidden;
}
#event-eyes-panel.ee-mini {
  height: 42px !important;
  min-height: 42px !important;
  overflow: hidden;
}
#event-eyes-panel * { box-sizing: border-box; }

/* Resize handle */
#event-eyes-panel .ee-resize {
  position: absolute;
  top: 0; left: 0;
  width: 18px; height: 18px;
  cursor: nw-resize;
  z-index: 1;
}
#event-eyes-panel .ee-resize::before {
  content: '';
  position: absolute;
  top: 4px; left: 4px;
  width: 9px; height: 9px;
  border-left: 2px solid #555;
  border-top: 2px solid #555;
}

/* Header */
#event-eyes-panel .ee-hdr {
  background: #151515;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: grab;
  border-bottom: 1px solid #333;
  border-radius: 10px 10px 0 0;
  flex-shrink: 0;
  user-select: none;
}
#event-eyes-panel .ee-title {
  color: #FEF484;
  font-weight: 600;
  font-size: 13px;
  flex: 1;
}
#event-eyes-panel .ee-title span { margin-right: 4px; }
#event-eyes-panel .ee-count { color: #666; font-size: 11px; }
#event-eyes-panel .ee-btns { display: flex; gap: 6px; }
#event-eyes-panel .ee-btns button {
  background: #252525;
  border: 1px solid #444;
  color: #999;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
#event-eyes-panel .ee-btns button:hover { background: #333; color: #fff; }

/* Tabs */
#event-eyes-panel .ee-tabs {
  display: flex;
  background: #151515;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}
#event-eyes-panel .ee-tab {
  flex: 1;
  padding: 8px;
  text-align: center;
  color: #666;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}
#event-eyes-panel .ee-tab:hover { color: #aaa; }
#event-eyes-panel .ee-tab.active { color: #fff; border-bottom-color: #FF4876; }
#event-eyes-panel .ee-tab.ga4.active { border-bottom-color: #60a5fa; }

/* Filter */
#event-eyes-panel .ee-filter {
  padding: 8px 12px;
  background: #111;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
}
#event-eyes-panel .ee-filter input {
  width: 100%;
  background: #1a1a1a;
  border: 1px solid #333;
  color: #fff;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
#event-eyes-panel .ee-filter input:focus { border-color: #FF4876; }

/* Log */
#event-eyes-panel .ee-log {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  min-height: 100px;
}
#event-eyes-panel .ee-log::-webkit-scrollbar { width: 6px; }
#event-eyes-panel .ee-log::-webkit-scrollbar-track { background: #111; }
#event-eyes-panel .ee-log::-webkit-scrollbar-thumb {
  background: #333; border-radius: 3px;
}

/* Events */
#event-eyes-panel .ee-evt {
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: #141414;
  border-left: 3px solid #FF4876;
}
#event-eyes-panel .ee-evt.ga4 { border-left-color: #60a5fa; }
#event-eyes-panel .ee-evt-hdr {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
#event-eyes-panel .ee-evt-time {
  color: #555;
  font-size: 10px;
  min-width: 80px;
  flex-shrink: 0;
}
#event-eyes-panel .ee-evt-badge {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  flex-shrink: 0;
}
#event-eyes-panel .ee-evt-badge.dl  { background: rgba(255,72,118,.2); color: #FF4876; }
#event-eyes-panel .ee-evt-badge.ga4 { background: rgba(96,165,250,.2); color: #60a5fa; }
#event-eyes-panel .ee-evt-name {
  color: #fff;
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Params */
#event-eyes-panel .ee-params {
  margin-top: 6px;
  padding: 6px 8px;
  background: #0d0d0d;
  border-radius: 4px;
  font-size: 11px;
}
#event-eyes-panel .ee-param {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid #1a1a1a;
}
#event-eyes-panel .ee-param:last-child { border-bottom: none; }
#event-eyes-panel .ee-param-key {
  color: #888;
  min-width: 140px;
  flex-shrink: 0;
}
#event-eyes-panel .ee-param-val { color: #ccc; word-break: break-all; }

/* Empty state */
#event-eyes-panel .ee-empty {
  color: #555;
  text-align: center;
  padding: 40px 20px;
}
    `;
    document.head.appendChild(style);
  }

  // ── Kick off ───────────────────────────────────────────────────────────
  createPanel();

})();
