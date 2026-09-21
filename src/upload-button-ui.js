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
      if (host?.shadowRoot) return { host, button: host.shadowRoot.querySelector('button') };
      host?.remove();
      host = document.createElement('div');
      host.id = deps.UPLOAD_HOST_ID;
      Object.assign(host.style, {
        position: 'fixed', left: '0px', top: '0px', width: '34px', height: '34px',
        zIndex: '2147483646', pointerEvents: 'none'
      });
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
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
        </style>
        <button type="button" aria-label="Автоотправить после загрузки файлов">⇧</button>`;
      const button = shadow.querySelector('button');
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        uploadController.toggle();
      });
      return { host, button };
    }

    function render() {
      const composer = deps.findComposer();
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      if (!composer) { if (host) host.style.display = 'none'; return; }
      const box = deps.findComposerBox(composer);
      if (!box) { if (host) host.style.display = 'none'; return; }

      const ui = ensureUi();
      host = ui.host;
      const position = deps.chooseUploadPosition(box, composer);
      host.style.display = 'block';
      host.style.left = `${Math.round(position.left)}px`;
      host.style.top = `${Math.round(position.top)}px`;
      ui.button.dataset.active = String(tabState.isUploadMarked());
      ui.button.setAttribute('aria-pressed', String(tabState.isUploadMarked()));
      ui.button.title = tabState.isUploadMarked()
        ? 'Жду окончания загрузки файлов и затем автоматически отправлю. Нажать ещё раз — отменить.'
        : 'Когда файлы загружаются: нажать, чтобы после завершения автоматически отправить сообщение';
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
