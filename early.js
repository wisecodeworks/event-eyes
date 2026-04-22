;(function () {
  'use strict';

  // Runs at document_start (before any page scripts) so we intercept
  // sendBeacon/fetch before GTM or gtag.js can cache their own references.
  if (window.__eeEarlyInit) return;
  window.__eeEarlyInit = true;

  // Captured events buffer — read by injected.js when the panel opens.
  window.__eeEvents = [];
  // Live-forward callback — set by injected.js after panel opens.
  window.__eeForward = null;

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

  // Strip DOM nodes, Events, and circular refs so postMessage can clone the data.
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
    if (Array.isArray(obj)) return obj.map(function(v) { return sanitize(v, depth + 1, seen); });
    var result = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      try { result[keys[i]] = sanitize(obj[keys[i]], depth + 1, seen); } catch (e) { result[keys[i]] = '[Error]'; }
    }
    return result;
  }

  function record(type, name, data) {
    var evt = { type: type, name: name, data: sanitize(data), timestamp: timestamp() };
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

  // Replay any items already present before this script ran (rare at document_start).
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
        const name = item.event || Object.keys(item)[0] || '(data)';
        record('dataLayer', name, item);
      }
    }
    return _dlPush.apply(window.dataLayer, arguments);
  };

  // ── PerformanceObserver fallback ───────────────────────────────────────
  // Catches any GA4 requests that slip past the interceptors above.
  // Uses startTime as uniquifier so distinct hits to the same URL aren't collapsed.

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
