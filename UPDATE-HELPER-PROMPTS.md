# Обновление Helper + Notifier: выбор промпта

Source ready: Notifier 5.7.31, Helper 0.40.10. Observatory/Viewer/Docker
обновлять или перезапускать для этого не нужно. Браузерная установка
остаётся ручной. Сохраните ценный черновик перед обновлением вкладки.

## Уже установлен Helper 0.40.10

Для исправления 5.7.31 обновите только существующий Notifier Loader по шагам
1–2 ниже; повторная замена Helper не требуется. Сохраните черновики и обновите
вкладки ChatGPT. Старые Helper вкладки больше не смогут стереть полученный
полный каталог. Значок Notifier теперь должен показывать 5.7.31; в 5.7.29 он
ошибочно показывал 5.7.28. Если список всё ещё пуст, нужна текущая строка
состояния каталога, а не очередная переустановка. Шаг 3 ниже нужен только
при первичном обновлении Helper, который ещё не достиг 0.40.10.

## 1. Проверить файлы в PowerShell

```powershell
$fortisN = Join-Path $env:USERPROFILE 'Repos\tabnotifier-fileautosend-autochat\chatgpt-tab-notifier-5.7.31.user.js'
$fortisH = Join-Path $env:USERPROFILE 'Repos\obs-planning-docs\planning\documentation\tools\tampermonkey\chat-command-palette-0.40.10.user.js'
if ((Get-FileHash -LiteralPath $fortisN -Algorithm SHA256).Hash -ne '482056d051bb5555cb2eeab47d32c8e08f0ce91974b455b79ce8e03d8d23bbf8') { throw 'Notifier SHA mismatch' }
if ((Get-FileHash -LiteralPath $fortisH -Algorithm SHA256).Hash -ne '97f9ba6bf7a1bf249f05016fa5c1db5235ff805478db9591abbbb687b13e44cc') { throw 'Helper SHA mismatch' }
'HASHES_OK=True'
```

## 2. Существующий Notifier Local Loader

В Tampermonkey откройте именно существующий Notifier Local Loader.
Замените только прежние строки @version и @require:

```javascript
// @version      5.7.31
// @require      file:///C:/Users/alexa/Repos/tabnotifier-fileautosend-autochat/chatgpt-tab-notifier-5.7.31.user.js
```

Не создавайте вторую копию и сохраните прежние @name, @namespace,
все grants, включая GM_listValues. Сохраните скрипт.

## 3. Существующий Helper

Если он установлен через Local Loader, замените только @version и @require:

```javascript
// @version      0.40.10
// @require      file:///C:/Users/alexa/Repos/obs-planning-docs/planning/documentation/tools/tampermonkey/chat-command-palette-0.40.10.user.js
```

Сохраните прежние @name, @namespace, grants и GitHub connect.
Если Helper установлен полным userscript, скопируйте новый код:

```powershell
Get-Content -LiteralPath $fortisH -Raw -Encoding UTF8 | Set-Clipboard
```

Вставьте в редактор СУЩЕСТВУЮЩЕГО полного Helper, проверьте, что @name и
@namespace совпадают с прежними, затем сохраните. Не применяйте полную
замену к Loader с другим именем/namespace: для Loader используйте две
строки выше. Локальную библиотеку, GM snapshot и GitHub token не удаляйте;
Hard Reload GitHub/Sync для обновления скрипта не требуются.

## 4. Проверка без отправки

После сохранения двух скриптов обновите одну вкладку ChatGPT с сохранённым
черновиком. Notifier Textbox -> шестерёнка -> «Промпт профиля» -> поиск ->
«Подключить промпт». Посмотрите предпросмотр раскрытых модулей. Переключите
профиль и вернитесь: выбор должен сохраниться. «Отключить» удаляет только
ссылку из профиля. Эти действия не нажимают File/Send.

Порядок дополнений: текст пользователя, выбранный промпт, отдельные модули
в порядке профиля. Original архивируется без добавлений. Нет локального
Helper/промпта/модуля или есть цикл -> подготовка блокируется с причиной.
Выбор профиля из Observatory применяет тот же сохранённый promptId;
нового отдельного выбора промпта в Viewer в этом изменении нет.

Проверки: Notifier 285/285, Helper 230/230, build:check обеих сборок PASS,
DOM event fixture PASS. Live Edge визуальная/GM проверка пока NOT_RUN.
Версия Notifier 5.7.28 сохранена отдельным неизменным файлом. Для code rollback
предыдущий Helper/Notifier сохранён в checkpoint before; не восстанавливайте
старые GM/approval файлы и не удаляйте новые локальные originals.
