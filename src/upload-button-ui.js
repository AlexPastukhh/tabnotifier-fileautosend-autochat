(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./chatgpt-dom.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const UI_WIDTH = 74;
  const UI_HEIGHT = 34;
  const VIEWPORT_MARGIN = 6;
  const DRAG_THRESHOLD_PX = 4;

  function clampFloatingPosition(position, viewportWidth, viewportHeight) {
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - UI_WIDTH - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - UI_HEIGHT - VIEWPORT_MARGIN);
    return {
      left: Math.min(Math.max(VIEWPORT_MARGIN, Number(position?.left) || VIEWPORT_MARGIN), maxLeft),
      top: Math.min(Math.max(VIEWPORT_MARGIN, Number(position?.top) || VIEWPORT_MARGIN), maxTop)
    };
  }

  function createUploadButtonUi({ tabState, uploadController, queuedPromptController }) {
    let repositionTimer = null;
    let suppressClickUntil = 0;
    let dragState = null;
    let draggedItemId = null;

    function viewportSize() {
      return {
        width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
        height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1)
      };
    }

    function loadPosition() {
      try {
        const parsed = JSON.parse(localStorage.getItem(deps.FLOATING_UI_POSITION_KEY) || 'null');
        if (Number.isFinite(parsed?.left) && Number.isFinite(parsed?.top)) return parsed;
      } catch (_) {}
      return null;
    }

    function savePosition(position) {
      try { localStorage.setItem(deps.FLOATING_UI_POSITION_KEY, JSON.stringify(position)); }
      catch (_) {}
    }

    function setHostPosition(host, position, { persist = false } = {}) {
      const viewport = viewportSize();
      const next = clampFloatingPosition(position, viewport.width, viewport.height);
      host.style.left = `${Math.round(next.left)}px`;
      host.style.top = `${Math.round(next.top)}px`;
      if (persist) savePosition(next);
      return next;
    }

    function chooseInitialPosition() {
      const composer = deps.findComposer();
      const box = composer ? deps.findComposerBox(composer) : null;
      const viewport = viewportSize();
      if (box) {
        return clampFloatingPosition({ left: box.left + 10, top: box.bottom - 44 }, viewport.width, viewport.height);
      }
      return clampFloatingPosition({ left: 16, top: viewport.height - UI_HEIGHT - 72 }, viewport.width, viewport.height);
    }

    function clickWasDrag(event) {
      if (Date.now() >= suppressClickUntil) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    function positionPanel(host, panel) {
      if (!panel || panel.hidden) return;
      const viewport = viewportSize();
      const hostRect = host.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = Math.min(panelRect.width || 430, Math.max(240, viewport.width - 24));
      const panelHeight = panelRect.height || 330;

      let left = 0;
      if (hostRect.left + panelWidth > viewport.width - 12) {
        left = viewport.width - 12 - hostRect.left - panelWidth;
      }
      left = Math.max(12 - hostRect.left, left);
      panel.style.left = `${Math.round(left)}px`;

      if (hostRect.top >= panelHeight + 12) {
        panel.style.top = 'auto';
        panel.style.bottom = '44px';
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = '44px';
      }
    }

    function renderQueueList(ui) {
      const controller = queuedPromptController;
      if (!controller) return;

      const items = controller.getItems();
      const pendingIds = new Set(controller.getPendingIds());
      const sending = controller.isWaitingToSend();
      ui.list.replaceChildren();

      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'queue-item';
        row.dataset.pending = String(pendingIds.has(item.id));

        const drag = document.createElement('span');
        drag.className = 'drag-handle';
        drag.textContent = '☰';
        drag.title = 'Перетащить сообщение';
        drag.draggable = !sending;

        const number = document.createElement('span');
        number.className = 'number';
        number.textContent = String(index + 1);

        const text = document.createElement('span');
        text.className = 'queue-text';
        text.textContent = item.text;
        text.title = item.text;

        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'item-action';
        up.textContent = '↑';
        up.title = 'Переместить выше';
        up.disabled = sending || index === 0;
        up.addEventListener('click', () => queuedPromptController.move(item.id, -1));

        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'item-action';
        down.textContent = '↓';
        down.title = 'Переместить ниже';
        down.disabled = sending || index === items.length - 1;
        down.addEventListener('click', () => queuedPromptController.move(item.id, 1));

        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'item-action send-one';
        send.textContent = pendingIds.has(item.id) ? '…' : '▶';
        send.title = 'Отправить это сообщение сейчас через обычное поле ChatGPT';
        send.disabled = sending;
        send.addEventListener('click', () => queuedPromptController.sendNow(item.id));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'item-action remove';
        remove.textContent = '×';
        remove.title = 'Удалить из очереди';
        remove.disabled = pendingIds.has(item.id);
        remove.addEventListener('click', () => queuedPromptController.remove(item.id));

        drag.addEventListener('dragstart', event => {
          if (sending) { event.preventDefault(); return; }
          draggedItemId = item.id;
          row.dataset.dragging = 'true';
          try { event.dataTransfer.effectAllowed = 'move'; } catch (_) {}
        });
        drag.addEventListener('dragend', () => {
          draggedItemId = null;
          row.dataset.dragging = 'false';
          for (const element of ui.list.querySelectorAll('.queue-item')) delete element.dataset.drop;
        });
        row.addEventListener('dragover', event => {
          if (!draggedItemId || draggedItemId === item.id || sending) return;
          event.preventDefault();
          const rect = row.getBoundingClientRect();
          row.dataset.drop = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
          try { event.dataTransfer.dropEffect = 'move'; } catch (_) {}
        });
        row.addEventListener('dragleave', event => {
          if (!row.contains(event.relatedTarget)) delete row.dataset.drop;
        });
        row.addEventListener('drop', event => {
          if (!draggedItemId || draggedItemId === item.id || sending) return;
          event.preventDefault();
          const placeAfter = row.dataset.drop === 'after';
          queuedPromptController.moveRelative(draggedItemId, item.id, placeAfter);
          draggedItemId = null;
        });

        row.append(drag, number, text, up, down, send, remove);
        ui.list.appendChild(row);
      });

      ui.empty.style.display = items.length ? 'none' : 'block';
      ui.sendAll.style.display = items.length ? 'block' : 'none';
      ui.sendAll.disabled = sending;
      ui.add.disabled = sending;
      ui.fromChat.disabled = sending;
      ui.sendAll.textContent = items.length > 1
        ? `Отправить всё одним сообщением (${items.length})`
        : 'Отправить всё одним сообщением';

      const status = controller.getLastStatus();
      ui.status.textContent = status;
      ui.status.style.display = status ? 'block' : 'none';

      const count = controller.getCount();
      ui.badge.textContent = String(count);
      ui.badge.style.display = count ? 'flex' : 'none';
      ui.queueButton.dataset.active = String(count > 0);
      ui.queueButton.dataset.sending = String(sending);
      ui.queueButton.title = sending
        ? `ChatGPT notifier v${deps.SCRIPT_VERSION} · Очередь: ${count}. Сейчас выполняется отправка.`
        : count
          ? `ChatGPT notifier v${deps.SCRIPT_VERSION} · Очередь сообщений: ${count}`
          : `ChatGPT notifier v${deps.SCRIPT_VERSION} · Открыть очередь сообщений`;
    }

    function ensureUi() {
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      if (host?.shadowRoot) {
        return {
          host,
          row: host.shadowRoot.querySelector('.row'),
          queueButton: host.shadowRoot.querySelector('[data-role="queue"]'),
          autoButton: host.shadowRoot.querySelector('[data-role="auto-send"]'),
          badge: host.shadowRoot.querySelector('.badge'),
          panel: host.shadowRoot.querySelector('.panel'),
          list: host.shadowRoot.querySelector('.queue-list'),
          empty: host.shadowRoot.querySelector('.empty'),
          status: host.shadowRoot.querySelector('.status'),
          sendAll: host.shadowRoot.querySelector('.send-all'),
          textarea: host.shadowRoot.querySelector('textarea'),
          add: host.shadowRoot.querySelector('.add'),
          fromChat: host.shadowRoot.querySelector('.from-chat'),
          versionChip: host.shadowRoot.querySelector('.version-chip'),
          panelVersion: host.shadowRoot.querySelector('.panel-version')
        };
      }

      host?.remove();
      host = document.createElement('div');
      host.id = deps.UPLOAD_HOST_ID;
      Object.assign(host.style, {
        position: 'fixed', left: '16px', top: '16px', width: `${UI_WIDTH}px`, height: `${UI_HEIGHT}px`,
        zIndex: '2147483646', pointerEvents: 'auto', display: 'block', overflow: 'visible'
      });
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .row {
            display:flex; gap:6px; align-items:center; width:${UI_WIDTH}px; height:${UI_HEIGHT}px;
            pointer-events:auto; touch-action:none; user-select:none; cursor:grab; position:relative;
          }
          .row[data-dragging="true"] { cursor:grabbing; }
          .control {
            width:34px; height:34px; padding:0; border-radius:999px;
            border:1px solid rgba(128,128,128,.24); background:rgba(32,32,32,.88);
            color:#fff; font:16px/1 system-ui,sans-serif; display:inline-flex;
            align-items:center; justify-content:center; cursor:inherit;
            pointer-events:auto; box-shadow:0 2px 10px rgba(0,0,0,.24);
            -webkit-user-select:none; user-select:none;
          }
          .control:hover { filter:brightness(1.12); }
          .control[data-active="true"] { opacity:1; }
          [data-role="auto-send"][data-active="true"] {
            background:#2563eb; border-color:#2563eb;
            box-shadow:0 0 0 2px rgba(37,99,235,.18),0 2px 10px rgba(0,0,0,.24);
          }
          [data-role="auto-send"][data-active="false"] { opacity:.72; }
          [data-role="queue"] { font-size:24px; font-weight:300; position:relative; }
          [data-role="queue"][data-active="true"] { background:#383838; border-color:rgba(255,255,255,.25); }
          [data-role="queue"][data-sending="true"] { animation:pulse .8s ease-in-out infinite alternate; }
          @keyframes pulse { from { opacity:.62; } to { opacity:1; } }
          .badge {
            position:absolute; left:24px; top:-7px; min-width:17px; height:17px; padding:0 4px;
            display:none; align-items:center; justify-content:center; border-radius:10px;
            background:#6d5dfc; color:#fff; font:600 10px/1 system-ui,sans-serif;
            pointer-events:none; box-shadow:0 1px 4px rgba(0,0,0,.35);
          }
          .version-chip {
            position:absolute; left:0; top:-22px; height:17px; padding:0 6px;
            display:inline-flex; align-items:center; justify-content:center; white-space:nowrap;
            border:1px solid rgba(128,128,128,.24); border-radius:999px;
            background:rgba(32,32,32,.88); color:rgba(255,255,255,.62);
            font:600 9px/1 system-ui,sans-serif; pointer-events:none;
            box-shadow:0 2px 8px rgba(0,0,0,.18);
          }
          .panel {
            position:absolute; left:0; bottom:44px; width:min(430px, calc(100vw - 24px));
            pointer-events:auto; font:13px/1.35 system-ui,sans-serif; color:#fff;
          }
          .panel[hidden] { display:none; }
          .panel-header {
            display:flex; align-items:center; justify-content:space-between; gap:8px;
            margin:0 0 7px; padding:7px 9px; border:1px solid rgba(128,128,128,.24);
            border-radius:10px; background:rgba(40,40,40,.98);
            color:rgba(255,255,255,.78); font:600 11px/1.2 system-ui,sans-serif;
          }
          .panel-version { color:rgba(255,255,255,.48); font-weight:700; }
          .queue-list { max-height:220px; overflow-y:auto; margin-bottom:7px; scrollbar-width:thin; }
          .queue-item {
            display:flex; align-items:center; gap:7px; min-height:42px;
            padding:7px 8px 7px 9px; margin-bottom:5px;
            border:1px solid rgba(128,128,128,.28); border-radius:11px;
            background:rgba(48,48,48,.98); box-shadow:0 4px 14px rgba(0,0,0,.22);
          }
          .queue-item[data-pending="true"] { border-color:rgba(109,93,252,.72); }
          .queue-item[data-drop="before"] { box-shadow:inset 0 2px 0 #6d5dfc,0 4px 14px rgba(0,0,0,.22); }
          .queue-item[data-drop="after"] { box-shadow:inset 0 -2px 0 #6d5dfc,0 4px 14px rgba(0,0,0,.22); }
          .queue-item[data-dragging="true"] { opacity:.42; }
          .drag-handle { width:18px; flex:0 0 18px; color:rgba(255,255,255,.34); cursor:grab; user-select:none; font:13px/1 system-ui,sans-serif; text-align:center; }
          .drag-handle:active { cursor:grabbing; }
          .number { width:18px; flex:0 0 18px; opacity:.46; font:11px/1 system-ui,sans-serif; text-align:center; }
          .queue-text { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font:13px/1.35 system-ui,sans-serif; }
          .item-action {
            width:27px; height:27px; flex:0 0 27px; padding:0; border:0; border-radius:7px;
            background:transparent; color:#aaa; font:14px/1 system-ui,sans-serif; cursor:pointer;
          }
          .item-action:hover:not(:disabled) { background:rgba(255,255,255,.10); color:#fff; }
          .item-action.send-one:hover:not(:disabled) { background:rgba(109,93,252,.52); }
          .item-action.remove:hover:not(:disabled) { background:rgba(127,45,45,.58); }
          .item-action:disabled { opacity:.45; cursor:default; }
          .empty { display:none; margin-bottom:7px; padding:9px; border:1px dashed rgba(128,128,128,.22); border-radius:10px; color:rgba(255,255,255,.38); text-align:center; }
          .send-all {
            display:none; width:100%; margin:0 0 7px; padding:8px 10px;
            border:1px solid rgba(128,128,128,.28); border-radius:10px;
            background:rgba(48,48,48,.98); color:#ddd; font:12px/1.2 system-ui,sans-serif;
            cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.16);
          }
          .send-all:hover:not(:disabled) { background:rgba(58,58,58,.98); color:#fff; }
          .send-all:disabled { opacity:.5; cursor:default; }
          .composer { padding:9px; border:1px solid rgba(128,128,128,.28); border-radius:14px; background:rgba(30,30,30,.98); box-shadow:0 12px 34px rgba(0,0,0,.34); }
          textarea { display:block; width:100%; min-height:66px; max-height:190px; resize:vertical; padding:4px 4px 7px; border:0; outline:none; background:transparent; color:#fff; font:13px/1.42 system-ui,sans-serif; }
          textarea::placeholder { color:rgba(255,255,255,.36); }
          .composer-bottom { display:flex; align-items:center; gap:7px; }
          .actions-left { display:flex; align-items:center; gap:7px; min-width:0; }
          .hint { margin-left:auto; color:rgba(255,255,255,.32); font:10px/1 system-ui,sans-serif; white-space:nowrap; }
          .add,.from-chat {
            border:1px solid rgba(128,128,128,.28); border-radius:8px; padding:7px 11px; cursor:pointer;
            background:rgba(48,48,48,.98); color:#eee; font:600 12px/1 system-ui,sans-serif; white-space:nowrap;
          }
          .add:hover,.from-chat:hover { background:rgba(64,64,64,.98); color:#fff; }
          .from-chat { background:rgba(53,51,74,.98); border-color:rgba(109,93,252,.38); }
          .from-chat:hover { background:rgba(72,68,101,.98); }
          .add:disabled,.from-chat:disabled { opacity:.48; cursor:default; }
          .status { display:none; margin:0 0 7px; padding:7px 9px; border-radius:9px; background:rgba(127,45,45,.38); color:#ffd7d7; font:11px/1.35 system-ui,sans-serif; }
        </style>

        <div class="panel" hidden>
          <div class="panel-header"><span>Очередь сообщений</span><span class="panel-version"></span></div>
          <div class="status"></div>
          <div class="empty">Очередь пуста</div>
          <div class="queue-list"></div>
          <button type="button" class="send-all">Отправить всё одним сообщением</button>
          <div class="composer">
            <textarea placeholder="Добавить следующее сообщение..."></textarea>
            <div class="composer-bottom">
              <div class="actions-left">
                <button type="button" class="add">В очередь</button>
                <button type="button" class="from-chat" title="Перенести весь текст из обычного поля ChatGPT в очередь">Из чата → очередь</button>
              </div>
              <span class="hint">Ctrl/⌘ + Enter</span>
            </div>
          </div>
        </div>

        <div class="row" aria-label="ChatGPT notifier controls">
          <span class="version-chip"></span>
          <button type="button" class="control" data-role="queue" aria-label="Очередь сообщений">+</button>
          <button type="button" class="control" data-role="auto-send" aria-label="Автоотправить после загрузки файлов">⇧</button>
          <span class="badge"></span>
        </div>`;

      const ui = {
        host,
        row: shadow.querySelector('.row'),
        queueButton: shadow.querySelector('[data-role="queue"]'),
        autoButton: shadow.querySelector('[data-role="auto-send"]'),
        badge: shadow.querySelector('.badge'),
        panel: shadow.querySelector('.panel'),
        list: shadow.querySelector('.queue-list'),
        empty: shadow.querySelector('.empty'),
        status: shadow.querySelector('.status'),
        sendAll: shadow.querySelector('.send-all'),
        textarea: shadow.querySelector('textarea'),
        add: shadow.querySelector('.add'),
        fromChat: shadow.querySelector('.from-chat'),
        versionChip: shadow.querySelector('.version-chip'),
        panelVersion: shadow.querySelector('.panel-version')
      };

      ui.versionChip.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.panelVersion.textContent = `v${deps.SCRIPT_VERSION}`;

      function addCurrent() {
        if (!queuedPromptController) return;
        const id = queuedPromptController.add(ui.textarea.value);
        if (!id) return;
        ui.textarea.value = '';
        render();
        setTimeout(() => ui.textarea.focus(), 0);
      }

      ui.row.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        const rect = host.getBoundingClientRect();
        dragState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          moved: false
        };
      });

      ui.row.addEventListener('pointermove', event => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragState.moved = true;
        ui.row.dataset.dragging = 'true';
        ui.row.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        setHostPosition(host, { left: dragState.startLeft + dx, top: dragState.startTop + dy });
        positionPanel(host, ui.panel);
      });

      function finishDrag(event) {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const moved = dragState.moved;
        dragState = null;
        ui.row.dataset.dragging = 'false';
        try { ui.row.releasePointerCapture?.(event.pointerId); } catch (_) {}
        if (!moved) return;
        event.preventDefault();
        suppressClickUntil = Date.now() + 350;
        const rect = host.getBoundingClientRect();
        setHostPosition(host, { left: rect.left, top: rect.top }, { persist: true });
        positionPanel(host, ui.panel);
      }

      ui.row.addEventListener('pointerup', finishDrag);
      ui.row.addEventListener('pointercancel', finishDrag);

      ui.queueButton.addEventListener('click', event => {
        if (clickWasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        ui.panel.hidden = !ui.panel.hidden;
        render();
        if (!ui.panel.hidden) {
          setTimeout(() => {
            positionPanel(host, ui.panel);
            ui.textarea.focus();
          }, 0);
        }
      });

      ui.autoButton.addEventListener('click', event => {
        if (clickWasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        uploadController.toggle();
      });

      ui.add.addEventListener('click', addCurrent);
      ui.fromChat.addEventListener('click', () => queuedPromptController?.addFromComposer());
      ui.sendAll.addEventListener('click', () => queuedPromptController?.sendAllNow());
      ui.textarea.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          ui.panel.hidden = true;
          return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          addCurrent();
        }
      });

      return ui;
    }

    function render() {
      const ui = ensureUi();
      const host = ui.host;
      host.style.display = 'block';

      let position = loadPosition();
      if (!position) {
        position = chooseInitialPosition();
        savePosition(position);
      }
      setHostPosition(host, position, { persist: true });

      const active = tabState.isUploadMarked();
      ui.autoButton.dataset.active = String(active);
      ui.autoButton.setAttribute('aria-pressed', String(active));
      ui.autoButton.title = active
        ? 'Жду окончания загрузки файлов и затем автоматически отправлю. Нажать ещё раз — отменить.'
        : 'Когда файлы загружаются: нажать, чтобы после завершения автоматически отправить сообщение';

      ui.versionChip.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.panelVersion.textContent = `v${deps.SCRIPT_VERSION}`;
      renderQueueList(ui);
      positionPanel(host, ui.panel);
    }

    function schedule() {
      if (repositionTimer !== null) return;
      repositionTimer = window.setTimeout(() => {
        repositionTimer = null;
        window.requestAnimationFrame(render);
      }, deps.SETTINGS.uiRepositionDelayMs);
    }

    function closeQueuePanel() {
      const host = document.getElementById(deps.UPLOAD_HOST_ID);
      const panel = host?.shadowRoot?.querySelector('.panel');
      if (panel) panel.hidden = true;
    }

    return { render, schedule, closeQueuePanel };
  }

  return { clampFloatingPosition, createUploadButtonUi };
});
