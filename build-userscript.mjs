import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outputPath = path.join(root, 'chatgpt-tab-notifier.user.js');
const check = process.argv.includes('--check');
const sourceFiles = [
  'src/config.js',
  'src/title-utils.js',
  'src/chatgpt-dom.js',
  'src/tab-state.js',
  'src/notifications.js',
  'src/upload-auto-send.js',
  'src/queued-prompt.js',
  'src/delayed-send.js',
  'src/upload-button-ui.js',
  'src/response-monitor.js',
  'src/runtime.js'
];

const header = `// ==UserScript==\n// @name         ChatGPT — значки вкладок, загрузка файлов и уведомления\n// @namespace    local.chatgpt.tab-notifier\n// @version      ${pkg.version}\n// @description  Статусы вкладки + автоотправка файлов + очередь сообщений + отложенная отправка + перетаскиваемые кнопки\n// @match        https://chatgpt.com/*\n// @match        https://chat.openai.com/*\n// @run-at       document-idle\n// @grant        GM_notification\n// @grant        GM_registerMenuCommand\n// ==/UserScript==\n\n// GENERATED FILE — DO NOT EDIT MANUALLY.\n// Source: src/**\n// Build: npm run build\n\n`;

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
