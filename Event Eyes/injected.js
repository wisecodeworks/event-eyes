;(function () {
  'use strict';

  const NONCE = window.__eeNonce || '';
  delete window.__eeNonce;

  function timestamp() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0')   + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0') + '.' +
           String(d.getMilliseconds()).padStart(3, '0');
  }

  function dispatch(type, name, data, ts, id, hasElement) {
    window.postMessage({
      __eventEyes: true,
      nonce: NONCE,
      type,
      name,
      data,
      timestamp: ts || timestamp(),
      id,
      hasElement
    }, '*');
  }

  // ── Path A: early.js ran in MAIN world before page scripts ────────────
  // Replay its buffer then subscribe for live events going forward.
  if (window.__eeEarlyInit && Array.isArray(window.__eeEvents)) {
    for (const evt of window.__eeEvents) {
      dispatch(evt.type, evt.name, evt.data, evt.timestamp, evt.id, evt.hasElement);
    }
    window.__eeForward = function (evt) {
      dispatch(evt.type, evt.name, evt.data, evt.timestamp, evt.id, evt.hasElement);
    };
    return; // done — early.js handles all capture
  }

  // ── Path B: early.js didn't run (page loaded before extension, or world
  // mismatch). Set up interceptors now as best-effort fallback. ──────────

  const _sendBeacon = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator) : null;
  const _fetch = typeof window.fetch === 'function'
    ? window.fetch.bind(window) : null;
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

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
    dispatch('ga4', parsed.eventName, parsed);
  }

  // sendBeacon
  if (_sendBeacon) {
    navigator.sendBeacon = function (url, data) {
      if (isGA4Url(url)) handleGA4(url, data);
      return _sendBeacon(url, data);
    };
  }

  // fetch
  if (_fetch) {
    window.fetch = function (resource, init) {
      const url = typeof resource === 'string' ? resource
        : (resource && typeof resource.url === 'string' ? resource.url : '');
      if (isGA4Url(url)) handleGA4(url, init && init.body);
      return _fetch(resource, init);
    };
  }

  // XHR
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__eeUrl = typeof url === 'string' ? url : '';
    return _xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__eeUrl && isGA4Url(this.__eeUrl)) handleGA4(this.__eeUrl, body);
    return _xhrSend.apply(this, arguments);
  };

  // dataLayer
  window.dataLayer = window.dataLayer || [];
  for (const item of window.dataLayer) {
    if (item && typeof item === 'object' && typeof item !== 'function') {
      const name = item.event || Object.keys(item)[0] || '(data)';
      dispatch('dataLayer', name, Object.assign({ _source: 'pre-existing' }, item));
    }
  }
  const _dlPush = window.dataLayer.push;
  window.dataLayer.push = function () {
    for (let i = 0; i < arguments.length; i++) {
      const item = arguments[i];
      if (item && typeof item === 'object' && typeof item !== 'function') {
        const name = item.event || Object.keys(item)[0] || '(data)';
        dispatch('dataLayer', name, item);
      }
    }
    return _dlPush.apply(window.dataLayer, arguments);
  };

  // PerformanceObserver fallback — catches GA4 hits even if GTM cached sendBeacon/fetch
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
