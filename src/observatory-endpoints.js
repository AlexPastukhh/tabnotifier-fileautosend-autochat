(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Explicit finite local origins. In particular, never trust an origin
  // supplied by a pasted pairing code without validating the whole string.
  // 18754 is Docker internal; 18755 is the explicit owner-launched local
  // viewer's narrow per-session observer/original transport, not a Docker port.
  const OBSERVATORY_ORIGINS = Object.freeze([
    'http://127.0.0.1:18753',
    'http://127.0.0.1:18754',
    'http://127.0.0.1:18755'
  ]);
  function allowedObservatoryOrigin(value) {
    return typeof value === 'string' && OBSERVATORY_ORIGINS.includes(value);
  }
  return { allowedObservatoryOrigin };
});
