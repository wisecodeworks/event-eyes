;(function () {
  'use strict';

  if (window.__eeEarlyInit) return;
  window.__eeEarlyInit = true;

  window.__eeEvents = [];
  window.__eeForward = null;

  // ── Element map for highlight feature ──────────────────────────────────
  window.__eeElementMap = new Map();
  var __eeEventId = 0;
  var __eeLastClick = { el: null, time: 0 };

  // While the user is interacting with the panel (click, drag, resize) we
  // suppress event recording entirely — page scripts triggered by those
  // interactions should not appear in the log.
  var __eePanelBusy = false;
  var __eePanelBusyTimer = null;

  // Capture last non-panel click so record() can associate events to elements.
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#event-eyes-panel')) return;
    __eeLastClick = { el: e.target, time: Date.now() };
  }, true);

  // Suppress recording and clear element association on any panel mousedown.
  document.addEventListener('mousedown', function (e) {
    if (e.target && e.target.closest && e.target.closest('#event-eyes-panel')) {
      __eePanelBusy = true;
      if (__eePanelBusyTimer) clearTimeout(__eePanelBusyTimer);
      __eeLastClick = { el: null, time: 0 };
    }
  }, true);

  // Re-enable recording 100 ms after mouse release (covers events that fire
  // synchronously after the interaction, e.g. custom click handlers).
  document.addEventListener('mouseup', function () {
    if (!__eePanelBusy) return;
    if (__eePanelBusyTimer) clearTimeout(__eePanelBusyTimer);
    __eePanelBusyTimer = setTimeout(function () { __eePanelBusy = false; }, 100);
  }, true);

  // ── Cosmic highlight ──────────────────────────────────────────────────
  var __eeHighlightedEl = null;
  var __eePingInterval  = null;

  function __eeInjectHighlightStyle() {
    if (document.getElementById('__ee-hl-style')) return;
    var s = document.createElement('style');
    s.id = '__ee-hl-style';
    s.textContent =
      // Glow animation on the element itself: pink → fuchsia → violet → back
      '@keyframes __ee-glow{' +
        '0%,100%{outline:2px solid #FF4876;outline-offset:2px;' +
          'box-shadow:0 0 6px 3px rgba(255,72,118,.9),0 0 18px 8px rgba(255,72,118,.45),0 0 38px 14px rgba(255,72,118,.18);}' +
        '40%{outline:2px solid #f0abfc;outline-offset:5px;' +
          'box-shadow:0 0 10px 5px rgba(240,171,252,.95),0 0 28px 12px rgba(255,72,118,.6),0 0 55px 22px rgba(168,85,247,.3);}' +
        '70%{outline:2px solid #c084fc;outline-offset:3px;' +
          'box-shadow:0 0 8px 4px rgba(192,132,252,.9),0 0 22px 9px rgba(168,85,247,.55),0 0 44px 18px rgba(255,72,118,.2);}' +
      '}' +
      '.__ee-hl{' +
        'outline:2px solid #FF4876!important;' +
        'outline-offset:2px!important;' +
        'animation:__ee-glow 2s ease-in-out infinite!important;' +
      '}' +
      // Ping rings: injected as separate fixed divs
      '@keyframes __ee-ping{' +
        '0%{transform:scale(1);opacity:.85;border-color:rgba(255,72,118,.9);}' +
        '60%{border-color:rgba(192,132,252,.6);}' +
        '100%{transform:scale(2);opacity:0;border-color:rgba(168,85,247,0);}' +
      '}' +
      '[data-ee-ping]{' +
        'position:fixed!important;pointer-events:none!important;' +
        'z-index:2147483646!important;border:2px solid rgba(255,72,118,.9)!important;' +
        'border-radius:6px!important;animation:__ee-ping 1.4s ease-out forwards!important;' +
      '}';
    (document.head || document.documentElement).appendChild(s);
  }

  function __eeCreatePing(el) {
    var rect = el.getBoundingClientRect();
    var p = document.createElement('div');
    p.setAttribute('data-ee-ping', '');
    p.style.top    = (rect.top    - 6) + 'px';
    p.style.left   = (rect.left   - 6) + 'px';
    p.style.width  = (rect.width  + 12) + 'px';
    p.style.height = (rect.height + 12) + 'px';
    document.body.appendChild(p);
    setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 1500);
  }

  function __eeClearHighlight() {
    if (__eeHighlightedEl) {
      __eeHighlightedEl.classList.remove('__ee-hl');
      __eeHighlightedEl = null;
    }
    if (__eePingInterval) { clearInterval(__eePingInterval); __eePingInterval = null; }
    document.querySelectorAll('[data-ee-ping]').forEach(function (p) { p.remove(); });
  }

  // When the panel requests a highlight, scroll to and pulse the element.
  // Clicking the same row again toggles the highlight off.
  window.addEventListener('message', function (e) {
    if (!e.data || !e.data.__eeHighlightRequest) return;
    var el = window.__eeElementMap.get(e.data.eventId);
    if (!el || !document.contains(el)) return;
    __eeInjectHighlightStyle();
    __eeClearHighlight();
    __eeHighlightedEl = el;
    el.classList.add('__ee-hl');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    __eeCreatePing(el);
    __eePingInterval = setInterval(function () {
      if (__eeHighlightedEl && document.contains(__eeHighlightedEl)) {
        __eeCreatePing(__eeHighlightedEl);
      }
    }, 1400);
  });

  // ── Native refs (captured before any page code runs) ──────────────────
  const _sendBeacon = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator) : null;
  const _fetch = typeof window.fetch === 'function'
    ? window.fetch.bind(window) : null;
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  // ── Helpers ────────────────────────────────────────────────────────────

  function timestamp() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0')   + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0') + '.' +
           String(d.getMilliseconds()).padStart(3, '0');
  }

  function sanitize(obj, depth, seen) {
    if (depth === undefined) depth = 0;
    if (depth > 5) return '[Deep]';
    if (obj === null || obj === undefined) return obj;
    const t = typeof obj;
    if (t === 'string' || t === 'number' || t === 'boolean') return obj;
    if (t === 'function') return '[Function]';
    if (t !== 'object') return String(obj);
    if (obj instanceof Element)
      return '[' + obj.tagName + (obj.id ? '#' + obj.id : '') + ']';
    if (obj instanceof Event) return '[Event:' + obj.type + ']';
    if (obj instanceof Node) return '[Node:' + obj.nodeName + ']';
    if (!seen) seen = new WeakSet();
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);
    if (Array.isArray(obj)) return obj.map(function (v) { return sanitize(v, depth + 1, seen); });
    var result = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      try { result[keys[i]] = sanitize(obj[keys[i]], depth + 1, seen); } catch (e) { result[keys[i]] = '[Error]'; }
    }
    return result;
  }

  function record(type, name, data) {
    if (__eePanelBusy) return;
    var id = ++__eeEventId;
    var hasElement = false;
    if (__eeLastClick.el && (Date.now() - __eeLastClick.time) < 1500) {
      window.__eeElementMap.set(id, __eeLastClick.el);
      hasElement = true;
      if (window.__eeElementMap.size > 200) {
        window.__eeElementMap.delete(window.__eeElementMap.keys().next().value);
      }
    }
    var evt = { id: id, type: type, name: name, data: sanitize(data), timestamp: timestamp(), hasElement: hasElement };
    window.__eeEvents.push(evt);
    if (window.__eeEvents.length > 500) window.__eeEvents.shift();
    if (typeof window.__eeForward === 'function') window.__eeForward(evt);
  }

  // ── GA4 helpers ────────────────────────────────────────────────────────

  const ga4Seen = new Set();

  function isGA4Url(url) {
    return typeof url === 'string' && url.includes('/g/collect');
  }

  function parseGA4(url, body) {
    const result = {
      eventName: '(unknown)',
      pageTitle: '',
      pageLocation: '',
      sessionId: '',
      clientId: '',
      eventParams: {},
      userProperties: {}
    };

    function parsePairs(str) {
      if (!str) return;
      for (const pair of str.split('&')) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        try {
          const k = decodeURIComponent(pair.slice(0, eq));
          const v = decodeURIComponent(pair.slice(eq + 1));
          if      (k.startsWith('ep.'))  result.eventParams[k.slice(3)]  = v;
          else if (k.startsWith('epn.')) result.eventParams[k.slice(4)]  = parseFloat(v);
          else if (k.startsWith('up.'))  result.userProperties[k.slice(3)] = v;
          else if (k === 'en')  result.eventName    = v;
          else if (k === 'dt')  result.pageTitle    = v;
          else if (k === 'dl')  result.pageLocation = v;
          else if (k === 'sid') result.sessionId    = v;
          else if (k === 'cid') result.clientId     = v;
        } catch {}
      }
    }

    parsePairs(url.split('?')[1] || '');
    if (typeof body === 'string') parsePairs(body);
    else if (body instanceof URLSearchParams) parsePairs(body.toString());
    return result;
  }

  function handleGA4(url, body, uniqueSuffix) {
    const bodySig = typeof body === 'string' ? body.slice(0, 150)
      : (body instanceof URLSearchParams ? body.toString().slice(0, 150)
        : (uniqueSuffix || ''));
    const sig = url.slice(0, 100) + '|' + bodySig;
    if (ga4Seen.has(sig)) return;
    ga4Seen.add(sig);
    if (ga4Seen.size > 500) ga4Seen.delete(ga4Seen.values().next().value);
    const parsed = parseGA4(url, body);
    record('ga4', parsed.eventName, parsed);
  }

  // ── navigator.sendBeacon ───────────────────────────────────────────────

  if (_sendBeacon) {
    navigator.sendBeacon = function (url, data) {
      if (isGA4Url(url)) handleGA4(url, data);
      return _sendBeacon(url, data);
    };
  }

  // ── window.fetch ───────────────────────────────────────────────────────

  if (_fetch) {
    window.fetch = function (resource, init) {
      const url = typeof resource === 'string' ? resource
        : (resource && typeof resource.url === 'string' ? resource.url : '');
      if (isGA4Url(url)) handleGA4(url, init && init.body);
      return _fetch(resource, init);
    };
  }

  // ── XMLHttpRequest ─────────────────────────────────────────────────────

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__eeUrl = typeof url === 'string' ? url : '';
    return _xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__eeUrl && isGA4Url(this.__eeUrl)) handleGA4(this.__eeUrl, body);
    return _xhrSend.apply(this, arguments);
  };

  // ── dataLayer ──────────────────────────────────────────────────────────

  window.dataLayer = window.dataLayer || [];

  for (const item of window.dataLayer) {
    if (item && typeof item === 'object' && typeof item !== 'function') {
      const name = item.event || Object.keys(item)[0] || '(data)';
      record('dataLayer', name, Object.assign({ _source: 'pre-existing' }, item));
    }
  }

  const _dlPush = window.dataLayer.push;
  window.dataLayer.push = function () {
    for (let i = 0; i < arguments.length; i++) {
      const item = arguments[i];
      if (item && typeof item === 'object' && typeof item !== 'function') {
        // Skip GTM auto-events originating from clicks inside our own panel.
        if (typeof item.event === 'string' && item.event.startsWith('gtm.')) {
          const el = item['gtm.element'];
          if (el && typeof el.closest === 'function' && el.closest('#event-eyes-panel')) continue;
        }
        const name = item.event || Object.keys(item)[0] || '(data)';
        record('dataLayer', name, item);
      }
    }
    return _dlPush.apply(window.dataLayer, arguments);
  };

  // ── PerformanceObserver fallback ───────────────────────────────────────

  if (window.PerformanceObserver) {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name && isGA4Url(entry.name)) {
            handleGA4(entry.name, undefined, String(entry.startTime));
          }
        }
      });
      obs.observe({ type: 'resource', buffered: true });
    } catch {}
  }

})();
