(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function removeUnpairedSurrogates(text) {
    const source = String(text || '');
    let result = '';
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = source.charCodeAt(index + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          result += source[index] + source[index + 1];
          index += 1;
        }
        continue;
      }
      if (code >= 0xDC00 && code <= 0xDFFF) continue;
      result += source[index];
    }
    return result;
  }

  function cleanTitle(title) {
    let value = String(title || '');
    while (value.length && deps.BROKEN_OLD_PREFIX_UNITS.has(value.charCodeAt(0))) {
      value = value.slice(1).trimStart();
    }
    value = value.replace(/^\uFFFD+\s*/, '');
    value = removeUnpairedSurrogates(value);

    let removed = true;
    while (removed) {
      removed = false;
      for (const symbol of deps.ALL_PREFIX_SYMBOLS) {
        if (value.startsWith(symbol)) {
          value = value.slice(symbol.length).trimStart();
          removed = true;
          break;
        }
      }
    }
    return value.trim();
  }

  function faviconSvg(type) {
    const svgs = {
      working: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#f59e0b"/><circle cx="18" cy="32" r="5" fill="white"/><circle cx="32" cy="32" r="5" fill="white"/><circle cx="46" cy="32" r="5" fill="white"/></svg>',
      fresh: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#dc2626"/><path d="M20 43h24l-4-6V28c0-6-3-11-8-11s-8 5-8 11v9z" fill="white"/><circle cx="32" cy="48" r="4" fill="white"/></svg>',
      viewed: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#64748b"/><path d="M16 33 L27 44 L49 20" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      uploading: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#2563eb"/><path d="M32 13v29M21 24l11-11 11 11M18 47h28" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };
    return svgs[type] ? `data:image/svg+xml,${encodeURIComponent(svgs[type])}` : '';
  }

  return { removeUnpairedSurrogates, cleanTitle, faviconSvg };
});
