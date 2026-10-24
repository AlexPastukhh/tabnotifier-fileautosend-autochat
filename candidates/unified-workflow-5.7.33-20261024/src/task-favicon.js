(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TASK_PALETTE = Object.freeze({ yellow: '#facc15', blue: '#60a5fa', purple: '#c084fc',
    green: '#4ade80', red: '#f87171' });
  const COLORS = { prepared: null, waiting_ai: 'yellow', activity_observed: 'yellow',
    working: 'blue', silent: 'purple', unknown: 'purple', completed: 'green', failed: 'red', blocked: null };
  const MARK = { yellow: '🟡', blue: '🔵', purple: '🟣', green: '🟢', red: '🔴' };
  const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function validateTaskOverview(value, now = Date.now()) {
    if (!value || value.version !== 2 || value.basis !== 'latest_task' || value.available !== true || !value.counts ||
        typeof value.counts !== 'object' || !Number.isFinite(value.checked_at_unix) ||
        value.checked_at_unix <= 0 || value.checked_at_unix * 1000 > now + 30000 ||
        now - value.checked_at_unix * 1000 > 20000) return null;
    const counts = {};
    for (const key of Object.keys(COLORS)) {
      if (!Number.isSafeInteger(value.counts[key]) || value.counts[key] < 0 || value.counts[key] > 1000000) return null;
      counts[key] = value.counts[key];
    }
    const primary = value.primary_state;
    if (primary === null ? Object.values(counts).some(Boolean) :
        typeof primary !== 'string' || !owns(COLORS, primary) || counts[primary] === 0) return null;
    if (value.primary_state !== primary || value.primary_color !== (primary ? COLORS[primary] : null)) return null;
    const totals = { pending_count: counts.waiting_ai + counts.activity_observed, working_count: counts.working,
      silent_count: counts.silent + counts.unknown, blocked_count: counts.blocked, draft_count: counts.prepared,
      completed_count: counts.completed, failed_count: counts.failed };
    for (const [key, total] of Object.entries(totals)) if (value[key] !== total) return null;
    // Copy only public scalar metadata. No raw API object, title, text or keys.
    return { primary_state: primary, primary_color: value.primary_color,
      checked_at_unix: value.checked_at_unix, incomplete: value.incomplete === true, ...totals,
      current_pending: primary === 'waiting_ai' || primary === 'activity_observed' };
  }

  function monoFaviconSvg(spec) {
    if (!spec || !['dom', 'local'].includes(spec.source)) return '';
    const paths = {
      hourglass: '<path d="M19 12h26M19 52h26M22 13v8l10 11-10 11v8M42 13v8L32 32l10 11v8"/>',
      check: '<path d="M15 32l11 12 22-25"/>',
      upload: '<path d="M32 13v30M21 24l11-11 11 11M18 49h28"/>'
    };
    if (!owns(paths, spec.kind)) return '';
    const unread = spec.unread === true
      ? '<circle cx="53" cy="53" r="6" fill="white" stroke="#10151f" stroke-width="3"/>' : '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="15" fill="#10151f"/>' +
      '<g fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">' +
      paths[spec.kind] + '</g>' + unread + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function taskFaviconSvg(spec) {
    if (spec && ['dom', 'local'].includes(spec.source)) return monoFaviconSvg(spec);
    if (spec?.source !== 'observatory') return '';
    if (!spec || !owns(TASK_PALETTE, spec.color)) return '';
    const ink = '#10151f';
    const paths = {
      upload: '<path d="M31 13v30M20 24l11-11 11 11M17 48h28"/>',
      dom: '<circle cx="17" cy="32" r="3"/><circle cx="31" cy="32" r="3"/><circle cx="45" cy="32" r="3"/>',
      work: '<path d="M21 14h20v7L26 43v7h15v-7L26 21v-7"/>',
      wait: '<circle cx="31" cy="32" r="17"/><path d="M31 21v12l9 6"/>',
      quiet: '<circle cx="31" cy="32" r="17"/><path d="M26 25v14M36 25v14"/>',
      check: '<path d="M15 32l11 12 22-25"/>',
      error: '<path d="M19 20l25 25M44 20L19 45"/>',
      bell: '<path d="M18 43h26l-5-7v-9c0-13-16-13-16 0v9z"/><path d="M28 49h6"/>'
    };
    const glyph = owns(paths, spec.kind) ? paths[spec.kind] : paths.work;
    const pending = spec.pending === true && spec.color !== 'yellow'
      ? '<circle cx="52" cy="12" r="10" fill="#facc15" stroke="#10151f" stroke-width="3"/>' : '';
    const unread = spec.unread === true
      ? '<circle cx="52" cy="52" r="7" fill="white" stroke="#10151f" stroke-width="3"/>' : '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="15" fill="' + TASK_PALETTE[spec.color] + '"/>' +
      '<g fill="none" stroke="' + ink + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">' +
      glyph + '</g>' + pending + unread + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function resolveTabVisual({ state = 'idle', uploadMarked = false, overview = null,
    bound = false, connection = 'unpaired', domGenerating = false } = {}) {
    const unread = ['fresh', 'observatory-fresh'].includes(state);
    const domActive = domGenerating && ['working', 'observatory-working'].includes(state);
    const pending = bound && overview ? overview.current_pending === true : false;
    const uncertain = bound && ((!overview && !['disabled', 'unpaired'].includes(connection)) || overview?.incomplete === true);
    const domKind = domActive || state === 'working' ? 'hourglass'
      : ['fresh', 'viewed'].includes(state) ? 'check' : null;
    const domMarker = domKind === 'hourglass' ? '⏳' : domKind === 'check' ? '✓' : '';
    let icon = null, marker = '';
    if (uploadMarked) {
      icon = { source: 'local', color: null, kind: 'upload', pending: false, unread };
      marker = '⇧';
    } else if (bound && overview) {
      const color = overview.primary_color;
      if (color) icon = { source: 'observatory', color,
        kind: { blue: 'work', yellow: 'wait', purple: 'quiet', green: 'check', red: 'error' }[color],
        pending, unread };
      marker = MARK[color] || (overview.primary_state === 'blocked' ? '⏸' : '');
    }
    // DOM indicators are independent shapes. They can never invent an
    // Observatory color, even when disconnected or after an expired summary.
    if (!icon && domKind) icon = { source: 'dom', color: null, kind: domKind, pending: false, unread };
    const markers = [marker, domMarker];
    if (unread) markers.push('●');
    if (domActive && bound && overview?.primary_state === 'completed')
      markers.push('[ChatGPT: генерация наблюдается]');
    if (uncertain) {
      const reason = overview?.incomplete === true ? 'неполная сводка' : ({
        checking: 'проверка', denied: 'нет доступа', stale: 'статус устарел', unsupported: 'старый API'
      }[connection] || 'нет связи');
      markers.push('◌', '[Observatory: ' + reason + ']');
    }
    return { icon,
      symbol: markers.filter(Boolean).join(' ') };
  }
  return { TASK_PALETTE, validateTaskOverview, monoFaviconSvg, taskFaviconSvg, resolveTabVisual };
});
