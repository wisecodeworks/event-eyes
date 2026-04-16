;(function () {
  'use strict';

  // Read and immediately remove the nonce planted by background.js.
  // Keeping it on window longer than necessary is unnecessary exposure.
  const NONCE = window.__eeNonce || '';
  delete window.__eeNonce;

  // ── Security: cache all native refs before any page code has a chance
  // to tamper with prototypes or freeze global objects. ──────────────────
  const _sendBeacon  = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator) : null;
  const _fetch       = typeof window.fetch === 'function'
    ? window.fetch.bind(window) : null;
  const _xhrOpen     = XMLHttpRequest.prototype.open;
  const _xhrSend     = XMLHttpRequest.prototype.send;

  // Deduplication set — prevents the PerformanceObserver fallback from
  // double-counting a request already caught by sendBeacon/fetch/XHR.
  const ga4Seen = new Set();

  // ── Helpers ────────────────────────────────────────────────────────────

  function timestamp() {
    const d = new Date();
    return (
      String(d.getHours()).padStart(2, '0')   + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0') + '.' +
      String(d.getMilliseconds()).padStart(3, '0')
    );
  }

  function dispatch(type, name, data) {
    window.postMessage({
      __eventEyes: true,
      nonce: NONCE,          // content.js validates this before trusting the message
      type,
      name,
      data,
      timestamp: timestamp()
    }, '*');
  }

  /**
   * Parses a GA4 /collect URL and extracts the fields we care about.
   * Handles ep.* (event params), epn.* (numeric event params), up.* (user props).
   */
  function parseGA4(url) {
    const result = {
      eventName: '(unknown)',
      pageTitle: '',
      pageLocation: '',
      sessionId: '',
      clientId: '',
      eventParams: {},
      userProperties: {}
    };
    try {
      const qs = (url.split('?')[1] || '').split('&');
      for (const pair of qs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const key = decodeURIComponent(pair.slice(0, eqIdx));
        const val = decodeURIComponent(pair.slice(eqIdx + 1));
        if      (key.startsWith('ep.'))  result.eventParams[key.slice(3)]  = val;
        else if (key.startsWith('epn.')) result.eventParams[key.slice(4)]  = parseFloat(val);
        else if (key.startsWith('up.'))  result.userProperties[key.slice(3)] = val;
        else if (key === 'en')  result.eventName    = val;
        else if (key === 'dt')  result.pageTitle    = val;
        else if (key === 'dl')  result.pageLocation = val;
        else if (key === 'sid') result.sessionId    = val;
        else if (key === 'cid') result.clientId     = val;
      }
    } catch {}
    return result;
  }

  /**
   * Deduplicates GA4 hits and dispatches them.
   * Uses the first 200 chars of the URL as a signature to keep the Set bounded.
   */
  function handleGA4(url) {
    const sig = url.slice(0, 200);
    if (ga4Seen.has(sig)) return;
    ga4Seen.add(sig);
    if (ga4Seen.size > 500) {
      // Evict the oldest entry to prevent unbounded growth
      ga4Seen.delete(ga4Seen.values().next().value);
    }
    const parsed = parseGA4(url);
    dispatch('ga4', parsed.eventName, parsed);
  }

  // ── dataLayer interception ────────────────────────────────────────────

  window.dataLayer = window.dataLayer || [];

  // Replay items already in the dataLayer before we were injected
  for (const item of window.dataLayer) {
    if (item && typeof item === 'object' && typeof item !== 'function') {
      const name = item.event || Object.keys(item)[0] || '(data)';
      dispatch('dataLayer', name, Object.assign({ _source: 'pre-existing' }, item));
    }
  }

  // Wrap push — preserves any existing wrapper (e.g. GTM's own interceptor)
  const _originalPush = window.dataLayer.push;
  window.dataLayer.push = function () {
    for (let i = 0; i < arguments.length; i++) {
      const item = arguments[i];
      if (item && typeof item === 'object' && typeof item !== 'function') {
        const name = item.event || Object.keys(item)[0] || '(data)';
        dispatch('dataLayer', name, item);
      }
    }
    return _originalPush.apply(window.dataLayer, arguments);
  };

  // ── navigator.sendBeacon interception ─────────────────────────────────

  if (_sendBeacon) {
    navigator.sendBeacon = function (url, data) {
      if (typeof url === 'string' && url.includes('/g/collect')) {
        handleGA4(url);
      }
      return _sendBeacon(url, data);
    };
  }

  // ── window.fetch interception ─────────────────────────────────────────

  if (_fetch) {
    window.fetch = function (resource, init) {
      const url = typeof resource === 'string' ? resource
        : (resource && typeof resource.url === 'string' ? resource.url : '');
      if (url.includes('/g/collect')) handleGA4(url);
      return _fetch(resource, init);
    };
  }

  // ── XMLHttpRequest interception ───────────────────────────────────────

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__eeUrl = typeof url === 'string' ? url : '';
    return _xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__eeUrl && this.__eeUrl.includes('/g/collect')) {
      handleGA4(this.__eeUrl);
    }
    return _xhrSend.apply(this, arguments);
  };

  // ── PerformanceObserver fallback ──────────────────────────────────────
  // Catches any GA4 requests that slip past the above interceptors.

  if (window.PerformanceObserver) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name && entry.name.includes('/g/collect')) {
            handleGA4(entry.name);
          }
        }
      });
      observer.observe({ entryTypes: ['resource'] });
    } catch {}
  }

})();
