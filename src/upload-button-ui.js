(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./chatgpt-dom.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function createUploadButtonUi({ tabState, uploadController }) {
    let repositionTimer = null;

    function ensureUi() {
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      if (host?.shadowRoot) {
        return {
          host,
          autoButton: host.shadowRoot.querySelector('[data-role="auto-send"]'),
          plusButton: host.shadowRoot.querySelector('[data-role="fallback-plus"]')
        };
      }
      host?.remove();
      host = document.createElement('div');
      host.id = deps.UPLOAD_HOST_ID;
      Object.assign(host.style, {
        position: 'fixed', left: '0px', top: '0px', width: '76px', height: '36px',
        zIndex: '2147483646', pointerEvents: 'none'
      });
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .row { display:flex; gap:6px; align-items:center; pointer-events:none; }
          button {
            width: 34px; height: 34px; padding: 0; border-radius: 999px;
            border: 1px solid rgba(128,128,128,.24); background: rgba(32,32,32,.88);
            color: #fff; font: 16px/1 system-ui,sans-serif; display: inline-flex;
            align-items: center; justify-content: center; cursor: pointer; box-sizing: border-box;
            pointer-events: auto; box-shadow: 0 2px 10px rgba(0,0,0,.24);
          }
          button:hover { filter: brightness(1.12); }
          button[data-active="true"] {
            background: #2563eb; border-color: #2563eb; opacity: 1;
            box-shadow: 0 0 0 2px rgba(37,99,235,.18),0 2px 10px rgba(0,0,0,.24);
          }
          button[data-active="false"] { opacity: .72; }
          [data-role="fallback-plus"] { font-size:24px; font-weight:300; }
        </style>
        <div class="row">
          <button type="button" data-role="fallback-plus" aria-label="Добавить файлы">+</button>
          <button type="button" data-role="auto-send" aria-label="Автоотправить после загрузки файлов">⇧</button>
        </div>`;

      const autoButton = shadow.querySelector('[data-role="auto-send"]');
      const plusButton = shadow.querySelector('[data-role="fallback-plus"]');
      autoButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        uploadController.toggle();
      });
      plusButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const composer = deps.findComposer();
        const nativePlus = deps.findComposerPlusButton(composer);
        if (nativePlus) {
          nativePlus.click();
          return;
        }
        deps.findUploadFileInput(composer)?.click();
      });
      return { host, autoButton, plusButton };
    }

    function render() {
      const composer = deps.findComposer();
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      if (!composer) { if (host) host.style.display = 'none'; return; }
      const box = deps.findComposerBox(composer);
      if (!box) { if (host) host.style.display = 'none'; return; }

      const ui = ensureUi();
      host = ui.host;
      const nativePlus = deps.findComposerPlusButton(composer);
      const active = tabState.isUploadMarked();

      // If ChatGPT still exposes its own +, keep only ⇧ beside it. If the
      // redesign hides/removes +, show our own + as a proxy for upload-files.
      ui.plusButton.style.display = nativePlus ? 'none' : 'inline-flex';
      host.style.width = nativePlus ? '34px' : '76px';

      let left;
      let top;
      if (nativePlus) {
        const r = nativePlus.getBoundingClientRect();
        left = r.left - 34 - 7;
        top = r.top + (r.height - 34) / 2;
      } else {
        left = box.left + 10;
        top = box.bottom - 44;
      }

      left = Math.min(Math.max(6, left), Math.max(6, innerWidth - (nativePlus ? 34 : 76) - 6));
      top = Math.min(Math.max(6, top), Math.max(6, innerHeight - 36 - 6));
      host.style.display = 'block';
      host.style.left = `${Math.round(left)}px`;
      host.style.top = `${Math.round(top)}px`;

      ui.autoButton.dataset.active = String(active);
      ui.autoButton.setAttribute('aria-pressed', String(active));
      ui.autoButton.title = active
        ? 'Жду окончания загрузки файлов и затем автоматически отправлю. Нажать ещё раз — отменить.'
        : 'Когда файлы загружаются: нажать, чтобы после завершения автоматически отправить сообщение';
      ui.plusButton.title = 'Добавить файлы';
    }

    function schedule() {
      if (repositionTimer !== null) return;
      repositionTimer = window.setTimeout(() => {
        repositionTimer = null;
        window.requestAnimationFrame(render);
      }, deps.SETTINGS.uiRepositionDelayMs);
    }

    return { render, schedule };
  }

  return { createUploadButtonUi };
});
