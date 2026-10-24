(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./queued-prompt.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const PREFIX = 'fortis-local-user-message-v1-';
  const ID_RE = /^task_[0-9a-f]{32}$/;

  // Some Tampermonkey environments allow synchronous GM_get/GM_set but
  // GM_listValues is missing, throws, or returns an unexpected value.
  // Keep a verified PER-CHAT index of task keys using only get/set. This is
  // a discovery index, never a replacement for individually verified originals.
  // Legacy object records remain readable; old unindexed records stay intact.
  const INDEX_PREFIX = 'fortis-local-user-message-index-v1-';
  const CHAT_RE = /^[A-Za-z0-9-]{8,100}$/;
  const INDEX_KEY_RE = /^fortis-local-user-message-v1-task_[0-9a-f]{32}$/;

  function createGMRecordStorage({ getValue, setValue, listValues } = {}) {
    function decode(stored) {
      if (typeof stored !== 'string') return stored;
      try { return JSON.parse(stored); }
      catch (_) { return null; }
    }

    function readIndex(chatId) {
      if (!CHAT_RE.test(chatId || '')) throw new Error('INDEX_BAD_CHAT');
      if (typeof getValue !== 'function') throw new Error('GM_READ_UNAVAILABLE');
      const raw = getValue(INDEX_PREFIX + chatId, null);
      if (raw === null || raw === undefined) return [];
      const value = decode(raw);
      if (!Array.isArray(value) || value.length > 100000 ||
          value.some(name => typeof name !== 'string' || !INDEX_KEY_RE.test(name)) ||
          new Set(value).size !== value.length) {
        throw new Error('INDEX_INVALID');
      }
      return value;
    }

    function verifyReadBack(key, expected) {
      if (typeof getValue !== 'function') throw new Error('GM_READ_UNAVAILABLE');
      const actual = decode(getValue(key, null));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error('INDEX_READBACK_MISMATCH');
      }
    }

    return {
      get(key) {
        if (typeof getValue !== 'function') throw new Error('GM_READ_UNAVAILABLE');
        return decode(getValue(key, null));
      },
      set(key, record) {
        if (typeof setValue !== 'function') throw new Error('GM_WRITE_UNAVAILABLE');
        setValue(key, JSON.stringify(record));
        // All record updates first verify the record, then ensure its task is
        // discoverable even if GM_listValues cannot enumerate anything.
        if (!key.startsWith(PREFIX) || !ID_RE.test(record?.task_id || '') ||
            key !== PREFIX + record.task_id ||
            !CHAT_RE.test(record?.conversation_id || '')) return;
        verifyReadBack(key, record);
        const indexKey = INDEX_PREFIX + record.conversation_id;
        const names = readIndex(record.conversation_id);
        if (names.includes(key)) return;
        const updated = [...names, key];
        setValue(indexKey, JSON.stringify(updated));
        verifyReadBack(indexKey, updated);
      },
      list(chatId) {
        let nativeKeys = null;
        if (typeof listValues === 'function') {
          try {
            const found = listValues();
            if (Array.isArray(found)) nativeKeys = found;
          } catch (_) { /* Index fallback; no destructive cleanup. */ }
        }
        // The index also preserves discovery after a browser reload where the
        // platform has no working synchronous enumeration API.
        const indexedKeys = chatId ? readIndex(chatId) : [];
        if (nativeKeys) return [...new Set([...nativeKeys, ...indexedKeys])];
        if (chatId) return indexedKeys;
        throw new Error('GM_LIST_UNAVAILABLE');
      }
    };
  }

  function createTaskIdBehavior(cryptoSource = globalThis.crypto) {
    function newTaskId() {
      if (typeof cryptoSource?.randomUUID === 'function') {
        return 'task_' + cryptoSource.randomUUID().replace(/-/g, '').toLowerCase();
      }
      if (typeof cryptoSource?.getRandomValues !== 'function') {
        throw new Error('Нет криптографически стойкого генератора task_id');
      }
      const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      return 'task_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    function prepare(originalText, repoContext = null, { fileName = null } = {}) {
      const original = String(originalText ?? '');
      if (!original.trim()) return null;
      const taskId = newTaskId();
      if (!ID_RE.test(taskId)) throw new Error('Неверный формат task_id');
      const guidance = [
        '[Fortis task context]',
        'Этот блок создан поведенческим модулем Notifier для ТЕКУЩЕГО сообщения.',
        'task_id: ' + taskId,
        'Все события и сообщения AI этого запроса должны использовать только этот task_id.',
        'НЕ переноси ID предыдущего запроса или ID из стартового bootstrap.',
        'Основной инструмент AI для Observatory: Fortis Repo.',
        'Метаданные посылай через repo_task.py event, полные interim/final через repo_task.py message (UTF-8 STDIN).',
        'Observatory и Windows Viewer не обязаны отвечать: записывай события и каждый полный interim/final локально через Fortis Repo.',
        'Не проверяй HTTP, pairing или receipt перед записью; недоступность Observatory не отменяет работу и не означает failed.',
        'STAGED_ONLY = очередь, не receipt. Оригинал пользователя архивирует Notifier, не AI.',
        'Не отправляй ответы AI через G2, Windows owner HOST или browser relay.'
      ];
      if ((repoContext?.origin === 'http://127.0.0.1:18754' ||
           repoContext?.origin === 'http://127.0.0.1:18755') &&
          /^rs_[0-9a-f]{32}$/.test(repoContext.reporting_session_id || '') &&
          /^[A-Za-z0-9-]{8,100}$/.test(repoContext.conversation_id || '')) {
        const command = 'python3 /workspace/repos/tunnel/observatory/v1/repo_task.py';
        const args = ' --session ' + repoContext.reporting_session_id +
          ' --chat-id ' + repoContext.conversation_id + ' --task ' + taskId;
        guidance.push(
          'reporting_session_id: ' + repoContext.reporting_session_id,
          'conversation_id: ' + repoContext.conversation_id,
          'route: repo',
          'Маркер пользователя: ' + command + ' event' + args +
            " --event user_message --stage other --summary 'Получено сообщение пользователя'",
          'Значимый промежуточный этап: ' + command + ' event' + args +
            " --event progress --stage reviewing --summary 'Проверяю запрос'",
          'Полный ответ: ' + command + ' message' + args + ' --kind final',
          'Полный текст AI передавай UTF-8 STDIN, не через аргументы CLI или metadata inbox.',
          'Не выдумывай положительные статусы без проверки архива; продолжай ответ при недоступности Repo.'
        );
      } else if (CHAT_RE.test(repoContext?.conversation_id || '')) {
        const command = 'python3 /workspace/repos/tunnel/observatory/v1/repo_task.py';
        const args = ' --chat-id ' + repoContext.conversation_id + ' --task ' + taskId;
        guidance.push(
          'conversation_id: ' + repoContext.conversation_id,
          'route: repo',
          'Browser pairing отсутствует. Сохраняй события и полные ответы в локальную очередь без --session.',
          'Маркер пользователя: ' + command + ' event' + args +
            " --event user_message --stage other --summary 'Получено сообщение пользователя'",
          'Значимый промежуточный этап: ' + command + ' event' + args +
            " --event progress --stage reviewing --summary 'Проверяю запрос'",
          'Полный ответ: ' + command + ' message' + args + ' --kind final',
          'После регистрации именно этого чата очередь будет обработана; не создавай привязку сам и не подставляй старые ID.',
          'Продолжай выполнять запрос и отвечать пользователю независимо от pairing.'
        );
      } else {
        guidance.push('Нет ID текущего чата: не выдумывай и не переноси ID. Выполняй запрос; не заявляй сохранение без STAGED_ONLY.');
      }
      guidance.push('[/Fortis task context]');
      const guidanceText = guidance.join('\n');
      // Full file payload contains the exact original, Fortis task metadata,
      // and (in prepareDraft) the selected Planning Helper prompt/modules.
      // ProseMirror gets ONLY a small, task-bound pointer.
      if (fileName) {
        const pointer = [
          'Полный текст запроса, Fortis task context и выбранные модули находятся в файле ' +
            JSON.stringify(fileName) + '. Прочитай весь файл перед ответом.',
          '[Fortis task context]',
          'task_id: ' + taskId,
          ...(repoContext?.reporting_session_id ?
            ['reporting_session_id: ' + repoContext.reporting_session_id] : []),
          ...(repoContext?.conversation_id ?
            ['conversation_id: ' + repoContext.conversation_id] : []),
          'route: repo',
          'Инструкции и команды для текущей задачи находятся внутри файла.',
          '[/Fortis task context]'
        ].join('\n');
        return { task_id: taskId, original_text: original,
          submitted_text: pointer,
          file_text: original + '\n\n' + guidanceText };
      }
      return { task_id: taskId, original_text: original,
        submitted_text: original.trimEnd() + '\n\n' + guidanceText };
    }
    return { prepare };
  }

  function createPersistentMessageController({
    queue, storage, getConversationId, getPairing = () => null, onChange = () => {},
    behavior = createTaskIdBehavior(), now = () => Date.now(), onSaved = () => {}
  } = {}) {
    const queueToTask = new Map();
    let lastStatus = '';

    function notify(message) {
      lastStatus = message;
      // UI redraw must not modify the result of a verified storage write
      // or interrupt queue bookkeeping after the original is safely stored.
      try { onChange(); } catch (_) {}
    }

    function key(id) { return PREFIX + id; }

    function load(id) {
      if (!ID_RE.test(id || '')) return null;
      try {
        const value = storage.get(key(id));
        return value?.version === 1 && value.task_id === id ? value : null;
      } catch (_) { return null; }
    }

    function save(record) {
      const storageKey = key(record.task_id);
      if (!storage || typeof storage.set !== 'function' ||
          typeof storage.get !== 'function' || typeof storage.list !== 'function') {
        throw new Error('STORAGE_UNAVAILABLE');
      }
      try { storage.set(storageKey, record); }
      catch (error) {
        if (/^INDEX_(BAD_CHAT|INVALID|READBACK_MISMATCH)$/.test(error?.message || '')) throw error;
        throw new Error('WRITE_FAILED');
      }
      let check;
      try { check = storage.get(storageKey); }
      catch (_) { throw new Error('READ_FAILED'); }
      if (!check || check.version !== 1 || check.task_id !== record.task_id ||
          JSON.stringify(check) !== JSON.stringify(record)) {
        throw new Error('READBACK_MISMATCH');
      }
      let names;
      try { names = storage.list(record.conversation_id); }
      catch (error) {
        if (/^INDEX_(BAD_CHAT|INVALID|READBACK_MISMATCH)$/.test(error?.message || '')) throw error;
        throw new Error('LIST_FAILED');
      }
      if (!Array.isArray(names)) throw new Error('LIST_NOT_ARRAY');
      if (!names.includes(storageKey)) throw new Error('LIST_NOT_VISIBLE');
      // A UI re-render problem is NOT a storage failure after verified write.
      try { onChange(); } catch (_) { /* keep successfully saved record */ }
      try { onSaved(); } catch (_) { /* metadata sync cannot break local persistence */ }
      return record;
    }

    function update(id, fields) {
      const record = load(id);
      if (!record) return null;
      return save({ ...record, ...fields });
    }

    function updateSend(id, fields, phase) {
      const item = load(id);
      if (!item) return null;
      return update(id, { ...fields, ...(item.intent_version === 1 ? {
        send_revision: (item.send_revision || 0) + 1,
        send_phase: phase, send_observed_at_client_ms: now()
      } : {}) });
    }

    function acceptIntentSync(taskId, expected, receipt) {
      const item = load(taskId);
      if (!item || item.intent_version !== 1 || receipt?.ok !== true || receipt.version !== 1 ||
          receipt.task_id !== taskId || receipt.conversation_id !== item.conversation_id ||
          receipt.reporting_session_id !== item.reporting_session_id ||
          item.conversation_id !== getConversationId?.()) return false;
      const pair = getPairing?.();
      if (pair?.conversation_id !== item.conversation_id ||
          pair?.reporting_session_id !== item.reporting_session_id ||
          pair?.origin !== item.observatory_origin) return false;
      if (expected === 0) {
        if (receipt.registered !== true || receipt.provenance !== 'notifier_local_save_claim' ||
            !['created', 'existing'].includes(receipt.status) ||
            !Number.isFinite(receipt.registered_at_unix) || receipt.registered_at_unix <= 0) return false;
        try { update(taskId, { intent_registered: true }); return true; } catch (_) { return false; }
      }
      if (!Number.isSafeInteger(expected) || expected <= 0 ||
          receipt.recorded !== true || receipt.revision !== expected ||
          !Number.isSafeInteger(receipt.stored_revision) || receipt.stored_revision < expected ||
          !['created', 'updated', 'existing', 'stale'].includes(receipt.status) ||
          !['send_requested', 'send_unconfirmed', 'send_observed', 'send_not_attempted'].includes(receipt.phase) ||
          receipt.provenance !== 'notifier_send_claim' || expected > item.send_revision) return false;
      try { update(taskId, { intent_send_revision: Math.max(item.intent_send_revision || 0, expected) });
        return true; } catch (_) { return false; }
    }

    function listForChat(chatId = getConversationId?.()) {
      if (!chatId || typeof storage?.list !== 'function') return [];
      try {
        return storage.list(chatId).filter(name => name.startsWith(PREFIX))
          .map(name => load(name.slice(PREFIX.length)))
          .filter(record => record && record.conversation_id === chatId)
          .sort((a, b) => b.created_at - a.created_at);
      } catch (_) { return []; }
    }

    function sendExisting(taskId, { minComposerDwellMs = 0 } = {}) {
      const record = load(taskId);
      if (!record || !['prepared', 'send_failed'].includes(record.send_status)) return false;
      if (record.conversation_id !== getConversationId?.() || queue?.isWaitingToSend?.()) {
        notify('Отправка занята или открыт другой чат; исходник сохранён.');
        return false;
      }
      let itemId = null;
      try {
        itemId = queue.add(record.submitted_text, { persistent: true });
        if (!itemId) throw new Error('Не удалось добавить сообщение в отправитель');
        queueToTask.set(itemId, taskId);
        update(taskId, { send_status: 'send_queued' });
        notify('Сообщение сохранено локально; проверяется штатная отправка.');
        queue.sendNow(itemId, { source: 'manual-persisted', allowWhileGenerating: false,
          minComposerDwellMs });
        return true;
      } catch (_) {
        if (itemId) { queueToTask.delete(itemId); queue.remove(itemId); }
        try { update(taskId, { send_status: 'send_failed' }); } catch (_) {}
        notify('Исходник сохранён, но отправка не подготовлена. Проверьте очередь.');
        return false;
      }
    }

    const DRAFT_MAX_BYTES = 512 * 1024;
    function prepareDraft(originalText, { extraText = '', mode = 'insert',
      fileName = null, nativePrefix = '' } = {}) {
      const original = String(originalText ?? '');
      if (!original.trim() || !['insert', 'file'].includes(mode) ||
          typeof nativePrefix !== 'string' || nativePrefix.length > DRAFT_MAX_BYTES ||
          typeof extraText !== 'string' || extraText.length > 100000 ||
          (mode === 'file' && !/^fortis-prompt-[0-9a-z-]+\.txt$/.test(fileName || ''))) {
        notify('Некорректный черновик или модули; ничего не отправлено.');
        return null;
      }
      if (new TextEncoder().encode(original).length > DRAFT_MAX_BYTES) {
        notify('Черновик превышает архивный предел 512 КиБ. Отправка/архивирование не подготовлены.');
        return null;
      }
      const chatId = getConversationId?.();
      if (!chatId || queue?.isWaitingToSend?.()) {
        notify('Нет текущего чата или занята очередь. Черновик не создан.');
        return null;
      }
      const pair = getPairing?.();
      const validPair = pair?.conversation_id === chatId &&
        (pair?.origin === 'http://127.0.0.1:18754' ||
         pair?.origin === 'http://127.0.0.1:18755') &&
        /^rs_[0-9a-f]{32}$/.test(pair?.reporting_session_id || '');
      const repoContext = validPair
        ? { origin: pair.origin, reporting_session_id: pair.reporting_session_id,
            conversation_id: chatId } : { conversation_id: chatId };
      let prepared;
      try {
        prepared = behavior.prepare(original, repoContext,
          { fileName: mode === 'file' ? fileName : null });
      } catch (_) {
        notify('Не удалось создать task_id и контекст черновика.');
        return null;
      }
      if (!prepared || !/^task_[0-9a-f]{32}$/.test(prepared.task_id)) return null;
      if (mode === 'insert') {
        // TaskIdBehavior trims the source on the ordinary Send route; this
        // insert-only route promises to preserve EVERY original character
        // before adding module/context text, including final spaces/newlines.
        const trimmedPrefix = original.trimEnd();
        if (!prepared.submitted_text.startsWith(trimmedPrefix + '\n\n')) {
          notify('Подготовка изменила исходный текст. Черновик не создан.');
          return null;
        }
        prepared.submitted_text = original +
          prepared.submitted_text.slice(trimmedPrefix.length);
      }
      if (mode === 'file') {
        if (typeof prepared.file_text !== 'string' ||
            !prepared.file_text.startsWith(original + '\n\n') ||
            !prepared.file_text.includes('task_id: ' + prepared.task_id)) {
          notify('Полный файл с Fortis context не подготовлен.');
          return null;
        }
        if (extraText) prepared.file_text += '\n\n' + extraText;
      } else if (extraText) prepared.submitted_text += '\n\n' + extraText;
      if (mode === 'file' && nativePrefix) {
        // The previous native text is explicitly retained, not overwritten.
        // A full read-back of this merged draft is required before manual Send.
        prepared.submitted_text = nativePrefix + '\n\n' + prepared.submitted_text;
      }
      // Protect the native composer: selected modules may be large even when
      // the attached original is carried separately.
      if (new TextEncoder().encode(prepared.submitted_text).length > DRAFT_MAX_BYTES) {
        notify('Текст подготовленного черновика больше 512 КиБ.');
        return null;
      }
      // Do not double-store the full payload in synchronous GM storage.
      // The full original is saved independently in original_text.
      const {file_text: fileText, ...storedPrepared} = prepared;
      const record = {
        version: 1, ...storedPrepared, conversation_id: chatId,
        reporting_session_id: validPair ? pair.reporting_session_id : null,
        observatory_origin: validPair ? pair.origin : null,
        intent_version: 1, send_revision: 0,
        created_at: now(), send_status: 'draft', sent_at: null,
        activity_status: 'pending', first_activity_at: null,
        archive_status: 'pending_activity', draft_mode: mode,
        ...(mode === 'file' ? { file_name: fileName } : {})
      };
      try { save(record); }
      catch (_) {
        notify('Не удалось сохранить точный оригинал и task_id. Черновик отменён.');
        return null;
      }
      try { update(record.task_id, { intent_ready: true }); } catch (_) { /* local original already verified */ }
      notify('Черновик и task_id сохранены локально. Send не нажат.');
      return { task_id: record.task_id, submitted_text: record.submitted_text,
        ...(mode === 'file' ? { file_text: fileText } : {}) };
    }

    function previewPreparedNativeDraft(nativeText, { fileNameVisible = () => false } = {}) {
      const chatId = getConversationId?.();
      if (!chatId || typeof nativeText !== 'string') return null;
      const paired = getPairing?.();
      // Multiple DIFFERENT file hashes may have been attached and their task
      // contexts appended to one composer. Only claim exact, unmodified prefix
      // snapshots in the final native text with the corresponding file cards.
      const matched = listForChat(chatId).filter(item => {
        if (item.send_status !== 'draft' ||
            typeof item.submitted_text !== 'string' ||
            !((item.draft_mode === 'file' && deps.fileContextTextMatches?.(
                nativeText, item.submitted_text)) ||
              item.submitted_text === nativeText ||
              (item.draft_mode === 'file' &&
               nativeText.startsWith(item.submitted_text + '\n\n')))) return false;
        if (item.draft_mode === 'file' && !fileNameVisible(item.file_name)) return false;
        if (item.reporting_session_id &&
            (paired?.conversation_id !== chatId ||
             paired?.reporting_session_id !== item.reporting_session_id ||
             paired?.origin !== item.observatory_origin)) return false;
        return true;
      });
      return matched;
    }

    function recordManualDraftSend(nativeText, { fileNameVisible = () => false } = {}) {
      const matched=previewPreparedNativeDraft(nativeText,{fileNameVisible});
      if(!matched?.length)return null;
      // A failed save must never cause automatic native Send (this function
      // only observes user action), and must never claim an archive receipt.
      const timestamp = now();
      let lastId = null;
      // Shorter native snapshots are earlier append-only prefixes; process
      // them first and return the task_id of the complete final draft.
      matched.sort((a, b) => a.submitted_text.length - b.submitted_text.length);
      for (const item of matched) {
        try {
          updateSend(item.task_id, { send_status: 'send_unconfirmed', sent_at: timestamp }, 'send_unconfirmed');
          lastId = item.task_id;
        } catch (_) {
          notify('Не удалось подтвердить статус ручного Send. Архив не подтверждён.');
        }
      }
      if (lastId)
        notify('Ручной Send обнаружен; точный черновик связан с task_id, ожидаем activity.');
      return lastId;
    }

    function saveAndSend(originalText, { minComposerDwellMs = 0, extraText = '' } = {}) {
      if (!getConversationId?.()) {
        notify('Откройте конкретный чат /c/..., чтобы связать сообщение с task_id.');
        return null;
      }
      if (queue?.isWaitingToSend?.()) {
        notify('Предыдущая отправка ещё выполняется.');
        return null;
      }
      const pairing = getPairing?.();
      const currentChat = getConversationId();
      const repoContext = (pairing?.origin === 'http://127.0.0.1:18754' ||
        pairing?.origin === 'http://127.0.0.1:18755') &&
        pairing?.conversation_id === currentChat &&
        /^rs_[0-9a-f]{32}$/.test(pairing?.reporting_session_id || '')
        ? { origin: pairing.origin, reporting_session_id: pairing.reporting_session_id,
            conversation_id: currentChat }
        : { conversation_id: currentChat };
      let prepared;
      try { prepared = behavior.prepare(originalText, repoContext); }
      catch (_) { notify('Нельзя создать безопасный task_id.'); return null; }
      if (!prepared) return null;
      if (typeof extraText !== 'string' || extraText.length > 100000) {
        notify('Некорректный текст подключённых модулей. Отправка отменена.');
        return null;
      }
      if (extraText) prepared.submitted_text += '\n\n' + extraText;
      const validPair = pairing?.conversation_id === getConversationId() &&
        (pairing?.origin === 'http://127.0.0.1:18753' ||
         pairing?.origin === 'http://127.0.0.1:18754' ||
         pairing?.origin === 'http://127.0.0.1:18755');
      const record = { version: 1, ...prepared, conversation_id: getConversationId(),
        reporting_session_id: validPair ? pairing.reporting_session_id : null,
        // Preserve the origin at creation: a later switch to Docker must never
        // migrate a legacy Windows-bound message, even for the same session ID.
        observatory_origin: validPair ? pairing.origin : null,
        intent_version: 1, send_revision: 0,
        created_at: now(), send_status: 'prepared', sent_at: null,
        activity_status: 'pending', first_activity_at: null,
        archive_status: 'pending_activity' };
      try { save(record); }
      catch (error) {
        const reason = /^[A-Z_]{5,40}$/.test(error?.message || '')
          ? error.message : 'UNKNOWN';
        try { notify('Не удалось сохранить исходник (' + reason + '). Отправка отменена.'); }
        catch (_) { /* never send if UI update itself fails */ }
        return null;
      }
      try { update(record.task_id, { intent_ready: true }); } catch (_) { /* metadata must not block Send */ }
      sendExisting(record.task_id, { minComposerDwellMs });
      return record.task_id;
    }

    function beforeSendClick({ source, itemIds }) {
      if (source !== 'manual-persisted') return true;
      const taskId = queueToTask.get(itemIds?.[0]);
      if (!taskId) return false;
      try { updateSend(taskId, { send_status: 'send_unconfirmed' }, 'send_requested'); return true; }
      catch (_) { notify('Ошибка сохранения перед Send: отправка отменена.'); return false; }
    }

    function handleSendResult({ source, itemIds, status }) {
      if (source !== 'manual-persisted') return;
      for (const itemId of itemIds || []) {
        const taskId = queueToTask.get(itemId);
        queueToTask.delete(itemId);
        if (!taskId) continue;
        try {
          updateSend(taskId, status === 'sent'
            ? { send_status: 'sent', sent_at: now() }
            : { send_status: status === 'unconfirmed' ? 'send_unconfirmed' : 'send_failed' },
            status === 'sent' ? 'send_observed' : status === 'unconfirmed' ? 'send_unconfirmed' : 'send_not_attempted');
        } catch (_) { notify('Не удалось сохранить статус отправки; проверьте историю.'); }
        if (status !== 'sent') queue.remove(itemId);
      }
      notify(status === 'sent' ? 'Отправлено; ожидает активности Observatory.'
        : status === 'unconfirmed'
          ? 'Отправка не подтверждена: не повторяйте её без проверки чата.'
          : 'Не отправлено; исходник сохранён, можно повторить.');
    }

    function acceptActivity(receipt) {
      if (!receipt || receipt.ok !== true || receipt.version !== 1 || receipt.found !== true ||
          !ID_RE.test(receipt.task_id || '') || !Number.isInteger(receipt.sequence) ||
          receipt.sequence < 0 || !Number.isFinite(receipt.accepted_unix) ||
          receipt.accepted_unix <= 0 || receipt.provenance !== 'sender_claim' ||
          !['started', 'progress', 'checkpoint', 'blocked', 'completed', 'failed',
            'user_message', 'assistant_message'].includes(receipt.event)) return false;
      const item = load(receipt.task_id);
      if (!item || item.conversation_id !== getConversationId?.() ||
          !item.reporting_session_id || item.reporting_session_id !== receipt.reporting_session_id ||
          item.conversation_id !== receipt.conversation_id ||
          !['sent', 'send_unconfirmed'].includes(item.send_status) ||
          item.activity_status === 'accepted') return false;
      try {
        update(item.task_id, {
          activity_status: 'accepted', archive_status: 'archive_pending',
          first_activity_at: receipt.accepted_unix * 1000,
          first_activity_event: receipt.event, first_activity_sequence: receipt.sequence
        });
        notify('Observatory принял сигнал по task_id; текст пока только локально.');
        return true;
      } catch (_) {
        notify('Не удалось сохранить подтверждение активности локально.');
        return false;
      }
    }

    function acceptArchive(receipt) {
      if (!receipt || receipt.ok !== true || receipt.version !== 1 ||
          receipt.archived !== true || !ID_RE.test(receipt.task_id || '') ||
          !['created', 'existing'].includes(receipt.status) ||
          !/^[0-9a-f]{64}$/.test(receipt.sha256 || '') ||
          typeof receipt.archived_at !== 'string' ||
          !Number.isFinite(Date.parse(receipt.archived_at))) return false;
      const item = load(receipt.task_id);
      if (!item || item.activity_status !== 'accepted' ||
          item.reporting_session_id !== receipt.reporting_session_id ||
          item.conversation_id !== receipt.conversation_id ||
          item.conversation_id !== getConversationId?.()) return false;
      try {
        update(item.task_id, {
          archive_status: 'archived', archived_at: receipt.archived_at,
          archive_sha256: receipt.sha256
        });
        notify('Исходное сообщение сохранено в архиве Observatory.');
        return true;
      } catch (_) {
        notify('Архив подтвердил запись, но локальный статус не сохранился.');
        return false;
      }
    }

    return { saveAndSend, prepareDraft, recordManualDraftSend, sendExisting,
      beforeSendClick, handleSendResult, acceptIntentSync,
      listForChat, load, previewPreparedNativeDraft, acceptActivity, acceptArchive,
      getLastStatus: () => lastStatus,
      getPairingInfo: () => {
        const pair = getPairing?.();
        return pair ? { reporting_session_id: pair.reporting_session_id,
          conversation_id: pair.conversation_id, origin: pair.origin } : null;
      },
      getStorageHealth: () => {
        try {
          if (!storage?.get || !storage?.set || !storage?.list) return false;
          const keys = storage.list(getConversationId?.());
          return Array.isArray(keys);
        } catch (_) { return false; }
      } };
  }

  return { createTaskIdBehavior, createGMRecordStorage, createPersistentMessageController };
});

