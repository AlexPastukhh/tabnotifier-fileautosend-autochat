(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const PREFIX = 'fortis-observatory-v1-pair-';
  const AUTO_PROOF_PREFIX = 'fortis-observatory-v1-client-proof-';
  const AUTO_ENROLL_ORIGIN = 'http://127.0.0.1:18755';
  const AUTO_ENROLL_INTERVAL = 7000;
  function makeClientProof() {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function')
      return null;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }
  const LEGACY_ORIGIN = 'http://127.0.0.1:18753';
  const allowedOrigin = deps.allowedObservatoryOrigin ||
    (origin => origin === LEGACY_ORIGIN || origin === 'http://127.0.0.1:18754' || origin === 'http://127.0.0.1:18755');

  function currentChatId(url = location.href) {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://chatgpt.com' && parsed.origin !== 'https://chat.openai.com') return '';
      const match = parsed.pathname.match(/^\/c\/([A-Za-z0-9-]{8,100})\/?$/);
      return match ? match[1] : '';
    } catch (_) { return ''; }
  }

  function validatePairing(value, chatId) {
    if (!value || typeof value !== 'object' || value.version !== 1 ||
        !allowedOrigin(value.origin) || value.conversation_id !== chatId ||
        !/^rs_[0-9a-f]{32}$/.test(value.reporting_session_id || '') ||
        !/^[A-Za-z0-9_-]{40,70}$/.test(value.observer_key || '') ||
        (value.message_writer_key !== undefined &&
         !/^[A-Za-z0-9_-]{40,70}$/.test(value.message_writer_key || '')) ||
        (value.task_intent_key !== undefined &&
         !/^[A-Za-z0-9_-]{40,70}$/.test(value.task_intent_key || '')) ||
        (value.dispatch_key !== undefined &&
         !/^[A-Za-z0-9_-]{40,70}$/.test(value.dispatch_key || ''))) return null;
    return {
      version: 1, origin: value.origin, conversation_id: chatId,
      reporting_session_id: value.reporting_session_id, observer_key: value.observer_key,
      ...(value.message_writer_key ? { message_writer_key: value.message_writer_key } : {}),
      ...(value.task_intent_key ? { task_intent_key: value.task_intent_key } : {}),
      ...(value.dispatch_key ? { dispatch_key: value.dispatch_key } : {})
    };
  }

  function createObservatoryCompletionBridge({
    tabState, responseMonitor, notify = () => {}, isEnabled = () => true
  } = {}) {
    let chatId = '';
    let latestSequence = -1;
    let workStartedAt = 0;
    let requestPending = null;
    let lastCheckAt = 0;
    let pairing = null;
    let generation = 0;
    let lastAutoEnroll = 0;
    let autoEnrollPending = false;
    let autoProof = null;
    let titleReportingSupported = false;
    let lastTriggeredSequence = -1;
    let initialStatusRead = false;
    let startSequence = -1;
    // Old archives must not cause stale working indicators after a page reload.
    const MAX_EVENT_AGE_MS = 120000;

    function refreshChat() {
      const next = currentChatId();
      if (next === chatId) return;
      tabState?.setObservatoryBinding?.(null);
      generation += 1;
      chatId = next;
      latestSequence = -1;
      lastTriggeredSequence = -1;
      initialStatusRead = false;
      startSequence = -1;
      workStartedAt = 0;
      requestPending = null;
      autoEnrollPending = false;
      lastAutoEnroll = 0;
      autoProof = null;
      try {
        pairing = next && typeof GM_getValue === 'function'
          ? validatePairing(GM_getValue(PREFIX + next, null), next) : null;
      } catch (_) { pairing = null; }
    }

    function currentTabTitle() {
      try {
        let value = tabState?.getNaturalTitle?.();
        if (typeof value !== 'string') value = typeof document === 'undefined' ? '' : document.title;
        if (typeof deps.cleanTitle === 'function') value = deps.cleanTitle(value);
        value = String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
          .replace(/\s+/g, ' ').trim();
        return [...value].filter(ch => {
          const code = ch.codePointAt(0);
          return code < 0xD800 || code > 0xDFFF;
        }).slice(0, 128).join('');
      } catch (_) { return ''; }
    }

    function checkAutoEnrollment() {
      if (!chatId || !isEnabled() || autoEnrollPending ||
          typeof GM_xmlhttpRequest !== 'function' ||
          typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function' ||
          Date.now() - lastAutoEnroll < AUTO_ENROLL_INTERVAL) return;
      lastAutoEnroll = Date.now();
      try {
        if (!autoProof) {
          const stored = GM_getValue(AUTO_PROOF_PREFIX + chatId, null);
          if (typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored))
            autoProof = stored;
          else {
            autoProof = makeClientProof();
            if (!autoProof) return;
            GM_setValue(AUTO_PROOF_PREFIX + chatId, autoProof);
          }
        }
        const snapshot = generation;
        const intendedChat = chatId;
        const title = titleReportingSupported ? currentTabTitle() : '';
        const payload = {chat: intendedChat, proof: autoProof, ...(title ? {title} : {})};
        autoEnrollPending = true;
        GM_xmlhttpRequest({
          method: 'POST',
          url: AUTO_ENROLL_ORIGIN + '/api/notifier/enroll',
          headers: {'Content-Type': 'application/json'},
          data: JSON.stringify(payload),
          timeout: 3500,
          onload(reply) {
            autoEnrollPending = false;
            if (generation !== snapshot || currentChatId() !== intendedChat) return;
            // Older Viewers reject the optional field. Keep the old pairing
            // intact and retry legacy enrollment on the next normal heartbeat.
            if (reply?.status !== 200) {
              if (title && [400, 403].includes(reply?.status)) titleReportingSupported = false;
              return;
            }
            try {
              const info = JSON.parse(reply.responseText);
              if (info?.ok !== true) return;
              titleReportingSupported = info.supports_tab_titles === true;
              if (info.status !== 'approved') return;
              const candidate = validatePairing(info.pairing, intendedChat);
              if (!candidate || candidate.origin !== AUTO_ENROLL_ORIGIN) return;
              const updated = !pairing || pairing.reporting_session_id !== candidate.reporting_session_id ||
                pairing.dispatch_key !== candidate.dispatch_key ||
                pairing.observer_key !== candidate.observer_key ||
                pairing.message_writer_key !== candidate.message_writer_key ||
                pairing.task_intent_key !== candidate.task_intent_key;
              if (!updated) return;
              GM_setValue(PREFIX + intendedChat, candidate);
              generation += 1;
              pairing = candidate;
              requestPending = null;
              latestSequence = -1;
              lastTriggeredSequence = -1;
              initialStatusRead = false;
              startSequence = -1;
              workStartedAt = 0;
              lastCheckAt = 0;
              notify('Fortis: привязка чата подтверждена Observatory и сохранена.');
              check();
            } catch (_) { /* invalid enrollment must not change the pairing */ }
          },
          onerror() { autoEnrollPending = false; },
          ontimeout() { autoEnrollPending = false; }
        });
      } catch (_) { autoEnrollPending = false; }
    }

    function noteArmed() {
      refreshChat();
      workStartedAt = Date.now();
      startSequence = Math.max(startSequence, latestSequence);
    }

    function receive(data, snapshot) {
      if (!isEnabled() || !pairing || !allowedOrigin(pairing.origin) || snapshot !== generation || currentChatId() !== chatId) return false;
      if (!data || data.ok !== true || data.version !== 1 ||
          data.conversation_id !== chatId ||
          data.reporting_session_id !== pairing.reporting_session_id ||
          !Number.isInteger(data.sequence) || data.sequence < -1 ||
          !['none', 'started', 'progress', 'checkpoint', 'blocked', 'completed', 'failed'].includes(data.event)) {
        tabState?.clearObservatorySummary?.('unavailable', snapshot); return false;
      }
      // Summary age and task counts change even when latest work sequence does not.
      if (data.task_overview === undefined || data.task_overview?.version !== 2) tabState?.clearObservatorySummary?.('unsupported', snapshot);
      else if (tabState?.setObservatorySummary?.(data.task_overview, {
        conversation_id: chatId, reporting_session_id: pairing.reporting_session_id,
        generation: snapshot }) === false) tabState?.clearObservatorySummary?.('unavailable', snapshot);

      const acceptedMs = typeof data.accepted_unix === 'number' ? data.accepted_unix * 1000 : 0;
      const fresh = acceptedMs > 0 && Number.isFinite(acceptedMs) &&
        acceptedMs <= Date.now() + 30000 && Date.now() - acceptedMs <= MAX_EVENT_AGE_MS;
      const initialRead = !initialStatusRead;
      initialStatusRead = true;
      if (data.sequence <= latestSequence) return false;
      latestSequence = data.sequence;
      if (!fresh) return false;

      if (['started', 'progress', 'checkpoint'].includes(data.event)) {
        // Progress is active work when a rapid started event fell between polls.
        if (startSequence < 0 || data.event === 'started' ||
            !['working', 'observatory-working'].includes(tabState?.getState?.())) {
          startSequence = data.sequence;
          workStartedAt = acceptedMs;
        }
        if (responseMonitor?.startFromExternal?.()) {
          notify('Работа начата по событию Fortis Observatory');
          return true;
        }
        return false;
      }

      if (data.event === 'completed' && !initialRead && workStartedAt > 0 &&
          acceptedMs >= workStartedAt &&
          data.sequence > Math.max(startSequence, lastTriggeredSequence) &&
          ['working', 'observatory-working'].includes(tabState?.getState?.()) &&
          responseMonitor?.finishFromExternal?.()) {
        lastTriggeredSequence = data.sequence;
        workStartedAt = 0;
        startSequence = -1;
        notify('Работа завершена по событию Fortis Observatory');
        return true;
      }
      return false;
    }

    function check() {
      refreshChat();
      tabState?.setObservatoryBinding?.(pairing ? { conversation_id: chatId,
        reporting_session_id: pairing.reporting_session_id, generation } : null);
      tabState?.refreshObservatoryAge?.();
      checkAutoEnrollment();
      if (!isEnabled()) { tabState?.clearObservatorySummary?.('disabled', generation); return; }
      if (!pairing || requestPending || typeof GM_xmlhttpRequest !== 'function') return;
      if (Date.now() - lastCheckAt < 3000) return;
      lastCheckAt = Date.now();
      const snapshot = generation, expectedOrigin = pairing.origin, expectedKey = pairing.observer_key;
      const token = {};
      requestPending = token;
      function settle() {
        if (requestPending !== token) return false;
        requestPending = null;
        return snapshot === generation && pairing?.origin === expectedOrigin &&
          pairing?.observer_key === expectedKey && currentChatId() === chatId;
      }
      function fail(reason) {
        if (settle()) tabState?.clearObservatorySummary?.(reason, snapshot);
      }
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: pairing.origin + '/api/observer-status?session=' + encodeURIComponent(pairing.reporting_session_id),
          headers: { 'X-Fortis-Observer-Key': expectedKey }, timeout: 3000,
          onload(response) {
            if (!settle()) return;
            if (!isEnabled()) { tabState?.clearObservatorySummary?.('disabled', snapshot); return; }
            if (response.status !== 200) {
              tabState?.clearObservatorySummary?.([401, 403].includes(response.status) ? 'denied' : 'unavailable', snapshot);
              return;
            }
            try { receive(JSON.parse(response.responseText), snapshot); }
            catch (_) { tabState?.clearObservatorySummary?.('unavailable', snapshot); }
          },
          onerror() { fail('unavailable'); }, ontimeout() { fail('unavailable'); }
        });
      } catch (_) { fail('unavailable'); }
    }

    function pairCurrent() {
      refreshChat();
      if (!chatId || typeof GM_setValue !== 'function') {
        alert('Открой обычную беседу /c/... для привязки.');
        return;
      }
      const raw = prompt('Вставь код привязки из Observatory (НЕ отправляй его в чат):');
      if (!raw) return;
      let candidate;
      try { candidate = validatePairing(JSON.parse(raw), chatId); } catch (_) { candidate = null; }
      if (!candidate) { alert('Код не подходит для этого Chat ID или сервера.'); return; }
      GM_setValue(PREFIX + chatId, candidate);
      generation += 1;
      pairing = candidate;
      requestPending = null;
      latestSequence = -1;
      lastTriggeredSequence = -1;
      initialStatusRead = false;
      startSequence = -1;
      workStartedAt = 0;
      lastCheckAt = 0;
      check();
      alert(candidate.dispatch_key
        ? 'Привязка сохранена. Этот чат может получать адресные команды из Owner Viewer.'
        : candidate.message_writer_key
          ? 'Привязка с записью исходных сообщений сохранена только для этого Chat ID.'
          : 'Привязка только для чтения сохранена для текущего Chat ID.');
    }

    function unpairCurrent() {
      refreshChat();
      if (chatId && typeof GM_deleteValue === 'function') {
        GM_deleteValue(PREFIX + chatId);
        GM_deleteValue(AUTO_PROOF_PREFIX + chatId);
      }
      generation += 1;
      pairing = null;
      tabState?.setObservatoryBinding?.(null);
      requestPending = null;
      workStartedAt = 0;
      startSequence = -1;
      initialStatusRead = false;
      alert('Привязка Observatory удалена для текущего чата.');
    }

    refreshChat();
    return {
      noteArmed, check, resetForNavigation: refreshChat, pairCurrent, unpairCurrent,
      isPaired: () => Boolean(pairing),
      getLatestSequence: () => latestSequence,
      getPairing: () => { refreshChat(); return pairing ? { ...pairing } : null; }
    };
  }

  // Each chat has a separate mode per browser tab, persisted for reloads.
  const MODE_PREFIX = 'fortis-observatory-v1-completion-mode-';
  const MODES = Object.freeze(['both', 'dom', 'observatory', 'off']);

  function createCompletionModeSettings({ show = message => alert(message) } = {}) {
    let chatId = null;
    let mode = 'both';

    function syncChat() {
      const next = currentChatId();
      if (next === chatId) return;
      chatId = next;
      mode = 'both';
      if (!chatId) return;
      try {
        const stored = sessionStorage.getItem(MODE_PREFIX + chatId);
        if (MODES.includes(stored)) mode = stored;
      } catch (_) { /* fail back to original native behavior */ }
    }

    function domEnabled() {
      syncChat();
      return mode === 'both' || mode === 'dom';
    }

    function observatoryEnabled() {
      syncChat();
      return mode === 'both' || mode === 'observatory';
    }

    function describe() {
      syncChat();
      return 'Источники начала и завершения текущего чата:\n' +
        'DOM Tab Notifier: ' + (domEnabled() ? 'ВКЛ' : 'ВЫКЛ') + '\n' +
        'Fortis Observatory: ' + (observatoryEnabled() ? 'ВКЛ' : 'ВЫКЛ') + '\n\n' +
        'Отключаются НАЧАЛО и КОНЕЦ по выбранному источнику; автоотправка не меняется.\n' +
        'Для сравнения запусти новую генерацию после переключения.';
    }

    function setMode(nextMode) {
      syncChat();
      if (!chatId || !MODES.includes(nextMode)) return false;
      try {
        sessionStorage.setItem(MODE_PREFIX + chatId, nextMode);
      } catch (_) {
        show('Не удалось сохранить режим для этой вкладки.');
        return false;
      }
      mode = nextMode;
      return true;
    }

    function toggleDom() {
      const next = domEnabled()
        ? (observatoryEnabled() ? 'observatory' : 'off')
        : (observatoryEnabled() ? 'both' : 'dom');
      if (!setMode(next)) return show('Открой обычный чат /c/... для настройки.');
      show(describe());
    }

    function toggleObservatory() {
      const next = observatoryEnabled()
        ? (domEnabled() ? 'dom' : 'off')
        : (domEnabled() ? 'both' : 'observatory');
      if (!setMode(next)) return show('Открой обычный чат /c/... для настройки.');
      show(describe());
    }

    function showStatus() { show(describe()); }

    syncChat();
    return {
      domEnabled, observatoryEnabled, toggleDom, toggleObservatory,
      showStatus, getMode: () => { syncChat(); return mode; }
    };
  }

  return { createObservatoryCompletionBridge, createCompletionModeSettings,
           currentChatId, validatePairing };
});
