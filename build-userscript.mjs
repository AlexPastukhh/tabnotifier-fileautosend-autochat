import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outputPath = path.join(root, 'chatgpt-tab-notifier.user.js');
const check = process.argv.includes('--check');
const sourceFiles = [
  'src/config.js',
  'src/task-favicon.js',
  'src/title-utils.js',
  'src/chatgpt-dom.js',
  'src/tab-state.js',
  'src/notifications.js',
  'src/upload-auto-send.js',
  'src/queued-prompt.js',
  'src/delayed-send.js',
  'src/observatory-endpoints.js',
  'src/persisted-messages.js',
  'src/task-activity.js',
  'src/task-intents.js',
  'src/user-message-archive.js',
  'src/observatory-dispatch.js',
  'src/textbox-behaviors.js',
  'src/textbox-module-profiles.js',
  'src/textbox-settings-ui.js',
  'src/upload-button-ui.js',
  'src/response-monitor.js',
  'src/observatory-completion.js',
  'src/runtime.js'
];

// A stale UI version can make a correctly loaded release look outdated.
// Fail the build instead of publishing a header/runtime mismatch.
const runtimeVersions = [...fs.readFileSync(path.join(root, 'src/config.js'), 'utf8')
  .matchAll(/const SCRIPT_VERSION = '([^']+)';/g)];
if (runtimeVersions.length !== 1 || runtimeVersions[0][1] !== pkg.version)
  throw new Error('Notifier runtime version must match package.json before build.');

const header = `// ==UserScript==\n// @name         ChatGPT — значки вкладок, загрузка файлов и уведомления\n// @namespace    local.chatgpt.tab-notifier\n// @version      ${pkg.version}\n// @description  Статусы вкладки + автоотправка файлов + очередь сообщений + отложенная отправка + перетаскиваемые кнопки\n// @match        https://chatgpt.com/*\n// @match        https://chat.openai.com/*\n// @run-at       document-idle\n// @grant        GM_notification\n// @grant        GM_registerMenuCommand\n// @grant        GM_getValue\n// @grant        GM_setValue\n// @grant        GM_listValues\n// @grant        GM_deleteValue\n// @grant        GM_xmlhttpRequest\n// @connect      127.0.0.1\n// ==/UserScript==\n\n// GENERATED FILE — DO NOT EDIT MANUALLY.\n// Source: src/**\n// Build: npm run build\n\n`;

const modules = sourceFiles
  .map(relative => fs.readFileSync(path.join(root, relative), 'utf8').trimEnd())
  .join('\n\n');

const bootstrap = `\n\n(function () {\n  'use strict';\n  const api = globalThis.ChatGPTTabNotifier;\n  if (!api || typeof api.startTabNotifier !== 'function') throw new Error('ChatGPT Tab Notifier build is incomplete.');\n  api.startTabNotifier();\n})();\n`;

const expected = header + modules + bootstrap;
if (check) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (current !== expected) throw new Error('Generated userscript is stale. Run npm run build.');
  console.log('Generated userscript matches modular sources.');
} else {
  fs.writeFileSync(outputPath, expected, 'utf8');
  console.log(`Built ${path.basename(outputPath)} from ${sourceFiles.length} modules.`);
}
