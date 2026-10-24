(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./task-favicon.js'), root.ChatGPTTabNotifier || {})
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
      const withoutConnection = value.replace(/^\[(?:Observatory: (?:нет связи|нет доступа|статус устарел|старый API|проверка|неполная сводка)|ChatGPT: генерация наблюдается)\]\s*/, '');
      if (withoutConnection !== value) { value = withoutConnection; removed = true; }
    }
    return value.trim();
  }

  function faviconSvg(type) {
    const kind = { working: 'hourglass', fresh: 'check', viewed: 'check', uploading: 'upload' }[type];
    // Legacy/raw state alone never grants an Observatory status color.
    return kind ? deps.monoFaviconSvg({ source: type === 'uploading' ? 'local' : 'dom',
      kind, unread: type === 'fresh' }) : '';
  }

  return { removeUnpairedSurrogates, cleanTitle, faviconSvg };
});
