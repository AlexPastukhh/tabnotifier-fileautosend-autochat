(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function createNotificationService(tabState) {
    function showDesktopNotification() {
      if (!deps.SETTINGS.desktopNotificationEnabled || typeof GM_notification !== 'function') return;
      try {
        GM_notification({
          title: 'ChatGPT — ответ готов',
          text: tabState.getNaturalTitle(),
          timeout: 6500,
          silent: false,
          highlight: false
        });
      } catch (error) {
        console.warn('[ChatGPT notifier] Не удалось показать системное уведомление:', error);
      }
    }

    function notifyFinished() {
      const background = document.hidden || !document.hasFocus();
      if (deps.SETTINGS.notifyOnlyInBackground && !background) return;
      showDesktopNotification();
    }

    return { showDesktopNotification, notifyFinished };
  }

  return { createNotificationService };
});
