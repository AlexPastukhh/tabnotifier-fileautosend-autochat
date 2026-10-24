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
  const WRITER_RE = /^[A-Za-z0-9_-]{40,70}$/;
  const CHECK_INTERVAL_MS = 3500;

  function createUserMessageArchiveMonitor({
    messages, getPairing, getConversationId, request, now = () => Date.now()
  } = {}) {
    let inFlight = false;
    let lastCheckAt = -Infinity;
    let nextIndex = 0;

    function check() {
      if (inFlight || typeof request !== 'function') return false;
      const chat = getConversationId?.();
      const pair = getPairing?.();
      if (!chat || !pair || !allowedOrigin(pair.origin) ||
          pair.conversation_id !== chat ||
          !SESSION_RE.test(pair.reporting_session_id || '') ||
          !WRITER_RE.test(pair.message_writer_key || '')) return false;
      const current = now();
      if (current - lastCheckAt < CHECK_INTERVAL_MS) return false;

      const candidates = (messages?.listForChat(chat) || [])
        .filter(record => TASK_RE.test(record.task_id || '') &&
          record.conversation_id === chat &&
          record.reporting_session_id === pair.reporting_session_id &&
          (record.observatory_origin ?? LEGACY_ORIGIN) === pair.origin &&
          record.activity_status === 'accepted' &&
          record.archive_status !== 'archived' &&
          ['sent', 'send_unconfirmed'].includes(record.send_status))
        .sort((a, b) => a.created_at - b.created_at);
      if (!candidates.length) return false;
      const record = candidates[nextIndex++ % candidates.length];
      const expectedPair = { origin: pair.origin, conversation_id: chat,
        reporting_session_id: pair.reporting_session_id,
        message_writer_key: pair.message_writer_key };

      // Only an already accepted task is eligible. Full text never goes in
      // the event inbox, URLs, query string, or console.
      const body = JSON.stringify({
        reporting_session_id: record.reporting_session_id,
        conversation_id: record.conversation_id,
        task_id: record.task_id,
        original_text: record.original_text
      });
      lastCheckAt = current;
      inFlight = true;
      const settle = () => { inFlight = false; };
      try {
        request({
          method: 'POST',
          url: expectedPair.origin + '/api/user-messages',
          headers: {
            'Content-Type': 'application/json',
            'X-Fortis-Message-Writer-Key': expectedPair.message_writer_key
          },
          data: body,
          timeout: 4000,
          async onload(response) {
            settle();
            if (response?.status !== 201 && response?.status !== 200) return;
            try {
              const currentPair = getPairing?.();
              if (getConversationId?.() !== chat ||
                  currentPair?.origin !== expectedPair.origin ||
                  currentPair?.reporting_session_id !== expectedPair.reporting_session_id ||
                  currentPair?.message_writer_key !== expectedPair.message_writer_key) return;
              const receipt = JSON.parse(response.responseText);
              if (receipt.task_id !== record.task_id ||
                  receipt.reporting_session_id !== expectedPair.reporting_session_id ||
                  receipt.conversation_id !== chat) return;
              // Server read-back is required. Independently verify its digest
              // before changing local status to archived.
              if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') return;
              const bytes = new TextEncoder().encode(record.original_text);
              const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
              const digestHex = Array.from(new Uint8Array(digest),
                value => value.toString(16).padStart(2, '0')).join('');
              if (receipt.sha256 !== digestHex) return;
              messages.acceptArchive(receipt);
            } catch (_) { /* preserve local pending for later retry */ }
          },
          onerror: settle,
          ontimeout: settle
        });
        return true;
      } catch (_) {
        settle();
        return false;
      }
    }

    return { check, isChecking: () => inFlight };
  }
  return { createUserMessageArchiveMonitor };
});
