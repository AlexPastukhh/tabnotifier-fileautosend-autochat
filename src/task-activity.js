(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const LEGACY_ORIGIN = 'http://127.0.0.1:18753';
  const allowedOrigin = deps.allowedObservatoryOrigin ||
    (origin => origin === LEGACY_ORIGIN || origin === 'http://127.0.0.1:18754' || origin === 'http://127.0.0.1:18755');
  const TASK_RE = /^task_[0-9a-f]{32}$/;
  const SESSION_RE = /^rs_[0-9a-f]{32}$/;
  const MIN_CHECK_INTERVAL_MS = 3500;

  function describeWaitingActivity({ record, pairing, connection = 'checking', now = Date.now(), warningDelayMs = 15000 } = {}) {
    if (!record || record.send_status !== 'sent' || record.activity_status === 'accepted') return '';
    if (!record.reporting_session_id) return 'Без привязки Observatory — пока только локально';
    if (!pairing || pairing.reporting_session_id !== record.reporting_session_id ||
        pairing.conversation_id !== record.conversation_id ||
        (record.observatory_origin ?? LEGACY_ORIGIN) !== pairing.origin) {
      return 'Нет прежней привязки Observatory — сообщение остаётся локально';
    }
    if (connection === 'unavailable') return 'Observatory недоступен — проверим после восстановления связи';
    if (connection === 'denied') return 'Observatory отклонил доступ — проверьте привязку';
    if (connection !== 'online') return 'Проверяем подтверждение активности Observatory';
    if (Number.isFinite(record.sent_at) && record.sent_at > 0 &&
        now - record.sent_at >= warningDelayMs) {
      return 'Пока нет подтверждения активности Observatory (более 15 секунд)';
    }
    return 'Ожидает активности Observatory';
  }

  function createTaskActivityMonitor({
    messages, getPairing, getConversationId, request, now = () => Date.now(),
    onStatus = () => {}
  } = {}) {
    let inFlight = false;
    let lastCheckAt = -Infinity;
    let nextIndex = 0;
    const taskConnections = new Map();

    function setConnection(taskId, value) {
      taskConnections.set(taskId, { ...value, checkedAt: now() });
      try { onStatus(); } catch (_) {}
    }

    function getTaskStatus(taskId) {
      const pairing = getPairing?.();
      const state = taskConnections.get(taskId);
      if (!pairing || !state || state.chat !== getConversationId?.() ||
          state.session !== pairing.reporting_session_id || state.key !== pairing.observer_key || state.origin !== pairing.origin ||
          now() - state.checkedAt > 12000) return 'checking';
      return state.status;
    }

    function check() {
      if (inFlight || typeof request !== 'function') return false;
      const chatId = getConversationId?.();
      const pairing = getPairing?.();
      if (!chatId || !pairing || !allowedOrigin(pairing.origin) ||
          pairing.conversation_id !== chatId ||
          !SESSION_RE.test(pairing.reporting_session_id || '') ||
          !/^[A-Za-z0-9_-]{40,70}$/.test(pairing.observer_key || '')) return false;
      const time = now();
      if (time - lastCheckAt < MIN_CHECK_INTERVAL_MS) return false;

      // Only tasks created in this chat under THIS reporting session are queried.
      // No raw message body, owner token, or arbitrary task is transmitted.
      const waiting = (messages?.listForChat(chatId) || [])
        .filter(record => TASK_RE.test(record.task_id || '') &&
          record.reporting_session_id === pairing.reporting_session_id &&
          (record.observatory_origin ?? LEGACY_ORIGIN) === pairing.origin &&
          record.activity_status !== 'accepted' &&
          ['sent', 'send_unconfirmed'].includes(record.send_status))
        .sort((a, b) => a.created_at - b.created_at);
      if (!waiting.length) return false;
      const selected = waiting[nextIndex++ % waiting.length];
      const expectedOrigin = pairing.origin;
      const expectedChat = chatId;
      const expectedSession = pairing.reporting_session_id;
      const expectedKey = pairing.observer_key;
      lastCheckAt = time;
      inFlight = true;

      function recordConnection(status) {
        const pairingNow = getPairing?.();
        if (getConversationId?.() !== expectedChat ||
            pairingNow?.reporting_session_id !== expectedSession ||
            pairingNow?.observer_key !== expectedKey ||
            pairingNow?.origin !== expectedOrigin) return;
        setConnection(selected.task_id, { chat: expectedChat, session: expectedSession,
          key: expectedKey, origin: expectedOrigin, status });
      }
      function settle() { inFlight = false; }
      try {
        request({
          method: 'GET',
          url: expectedOrigin + '/api/task-activity?session=' +
            encodeURIComponent(expectedSession) + '&task=' +
            encodeURIComponent(selected.task_id),
          headers: { 'X-Fortis-Observer-Key': expectedKey },
          timeout: 3000,
          onload(response) {
            settle();
            if (response?.status !== 200) {
              recordConnection(response?.status === 401 || response?.status === 403 ? 'denied' : 'unavailable');
              return;
            }
            try {
              const currentPairing = getPairing?.();
              if (getConversationId?.() !== expectedChat ||
                  currentPairing?.reporting_session_id !== expectedSession ||
                  currentPairing?.observer_key !== expectedKey ||
                  currentPairing?.origin !== expectedOrigin) return;
              const data = JSON.parse(response.responseText);
              if (data?.task_id !== selected.task_id ||
                  data?.reporting_session_id !== expectedSession ||
                  data?.conversation_id !== expectedChat) return;
              if (data?.ok !== true || data?.version !== 1 || typeof data.found !== 'boolean') return;
              recordConnection('online');
              if (data.found) messages.acceptActivity(data);
            } catch (_) { /* No private data in console logs. */ }
          },
          onerror() { settle(); recordConnection('unavailable'); },
          ontimeout() { settle(); recordConnection('unavailable'); }
        });
        return true;
      } catch (_) {
        settle();
        recordConnection('unavailable');
        return false;
      }
    }
    return { check, isChecking: () => inFlight, getTaskStatus };
  }
  return { createTaskActivityMonitor, describeWaitingActivity };
});

