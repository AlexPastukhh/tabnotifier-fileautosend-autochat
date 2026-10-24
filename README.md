# ChatGPT Tab Notifier / File Auto-Send / Prompt Queue

## Текущая версия и связь с Observatory — 25.10.2026

Основной `chatgpt-tab-notifier.user.js` и версионный `chatgpt-tab-notifier-5.7.34.user.js` сейчас содержат 5.7.34 (релизный коммит `12738fd`), SHA-256 `4e3409b92284f451ae5a5e75c72c5218f08ee6059d7c7692d8bf2e2604881319`. Это состояние source/bundle; установленная копия в каждом профиле проверяется отдельно по runtime badge. Ниже сохранена история: утверждение о main 5.7.32 относится к его выпуску и заменено этой сводкой.

В текущих 5.7.33/5.7.34 owner-dispatch `mode=send` проходит через `handleQuickFile` и одну попытку `sendPreparedNative`; это File + Send, включая короткий текстовый указатель рядом с TXT-вложением. В старом Notifier тот же режим мог отправить короткий исходник обычным текстом. Согласование версии/capabilities клиента в протоколе пока отсутствует. Проверять реальную версию нужно в целевой вкладке/профиле, а не только в Repo или заголовке Loader.

В owner-local тесте «Тест связи» пользователь получил connect и ACK `send_initiated`, затем сообщил об отмене текстовой отправки и подтвердил другую версию Notifier. Файловая доставка не подтверждена. Не повторять автоматически старую попытку; сначала проверить обновление и карточку через `Файл` без Send. Источник подробного статуса Observatory/API — `tunnel/observatory/v1/README.md` в соседнем приватном checkout; bearer/launcher/защитный журнал в этот публичный репозиторий не переносить.

Эта актуализация документации не устанавливает userscript в Tampermonkey и не меняет runtime. Проверки выпуска 5.7.34 и инструкция сохранения существующего Loader/GM-данных приведены в следующем разделе.

## 24.10.2026 — Notifier 5.7.34: размер, сворачивание и закрытие уведомления

Исправлен «Нажать Send»: текст помещается в одну строку, три действия
помещаются внутри текстбокса. В левой группе появилась кнопка ‹ / › для
сворачивания и раскрытия. Сворачивание сохраняет текущий текст и подготовку.

Угол ◢ меняет ширину и высоту; на фокусированном углу работают стрелки
(16 px, с Shift — 48 px). Размер и сворачивание сохраняются в отдельной
локальной UI-настройке этого профиля. Узкое окно временно ограничивает
размер, сохраняя предпочтения для возврата к широкому окну. Положение
очереди, настроек и уведомления учитывает фактическую высоту панели.

Уведомление закрывается крестиком или Escape при фокусе внутри него.
Закрытие скрывает только уведомление; новое сообщение снова показывается.
Текст сообщения и журнал операции не очищаются этой кнопкой.

Проверки: 288/288 Node-тестов, build:check и отдельный Chromium-прогон
12 сценариев (включая перезагрузку, drag/keyboard resize, узкий viewport,
закрытие/повтор уведомления и отсутствие действий подготовки/Send).
Поле с черновиком проверено на сохранение при сворачивании.
Реальный Edge/Tampermonkey не обновлялся и live-проверка не выполнена.

Сборка: chatgpt-tab-notifier-5.7.34.user.js.
Обновлять существующую копию Notifier с сохранением @name/@namespace
и GM-данных; если используется Loader, его старый @require не должен
оставаться вторым исполняемым экземпляром при переходе на полную сборку.
После сохранения ценного черновика обновить вкладку и проверить бейдж v5.7.34.

Воспроизводимая браузерная проверка: Node 22+, BROWSER_BINARY с путём к
локальному Chromium, node scripts/verify-floating-layout.mjs. Сеть/ChatGPT
не используются; все действия выполняются на изолированной DOM-фикстуре.

## 22.10.2026 — Notifier 5.7.31: selected Prompt card (SOURCE TESTED)

Owner screenshot confirms a Helper Prompt is now listed and attached; it had
only a plain connected-name line, whereas attached Modules had bordered items.
Selected Prompt now uses the same module-row card styling, with its title and
an inline accessible × detach button. Full stable ID is in the title tooltip.
The separate detach button next to the selector is removed. A missing selected
Prompt remains visible with an unavailable label; switching profiles updates
card visibility and text. Empty profiles show the normal no-prompt message.
Explicit module-row[hidden] CSS prevents the flex rule exposing an empty card.

Presentation-only change in textbox-settings-ui.js, plus version metadata.
Manager, profile storage, Prompt/module resolution and the 5.7.30 mixed-catalog
fix remain byte-identical. Helper 0.40.10, Viewer/backend, Send, queue, original
archive, pairing and running processes are unchanged. No new permission, no
automatic insertion or Send. No installed browser script was modified.
Full Node suite 285/285, no skips; build:check PASS. Existing event-driven DOM
fixture covers attach, prompt card/title/ID, profile restore, unavailable card
and detach without Send. No new tests were added for this reversible UI edit.
Real Edge appearance of 5.7.31 remains NOT_RUN; owner's screenshot is pre-fix.
Main and immutable chatgpt-tab-notifier-5.7.31.user.js SHA-256:
482056d051bb5555cb2eeab47d32c8e08f0ce91974b455b79ce8e03d8d23bbf8
Checkpoint: /workspace/repo/fortis-prompt-card-20261022
Manual: update only EXISTING Notifier Loader @version/@require to 5.7.31;
preserve name/namespace/grants/GM data, save draft then reload ChatGPT. Existing
selected Prompt should immediately appear as a card without re-attaching it.
Helper and Observatory do not need an update or restart for this UI change.


## 22.10.2026 — Notifier 5.7.30: mixed Helper catalog replies + truthful version badge (SOURCE TESTED)

Owner screenshots show Helper UI 0.40.10 and Notifier badge 5.7.28. The 5.7.29
bundle incorrectly retained SCRIPT_VERSION=5.7.28 despite its 5.7.29 header;
the badge therefore did not prove that an old bundle was loaded. Corrected in
5.7.30; build and build:check now reject a package/runtime version mismatch.

A real-publisher regression reproduced another failure: a valid Prompt+Module
catalog could be overwritten by a later module-only reply from a still-open
old Helper tab. After the first validated full catalog, Notifier now ignores
legacy replies for the lifetime of that manager, retaining modules and prompts
as one atomic snapshot. Legacy-only startup remains compatible for modules.
Modern updates and empty/deleted catalogs remain authoritative. Invalid modern
catalogs clear cached bodies and block preparation; a legacy reply cannot
restore them. A valid modern packet recovers normally. No GM profile mutation
occurs on receiving or ignoring catalogs.

This is a reproduced code defect and a plausible explanation of the owner's
missing list; the actual set of running Helper publishers in Edge was not read.
The old diagnostic that always said to update Helper was too specific. It now
says the prompt catalog has not been received and suggests refreshing ChatGPT
tabs. Helper source 0.40.10 is unchanged; no repeated Helper update is required.

Regression tests were RED before the fix (four failures); after the fix the
full Notifier suite passes 285/285 with no skips and build:check PASS, including
real Helper projection, both arrival orders, deletion, malformed catalog,
read-only GM behavior, UI events and build-version mismatch rejection.
No live Edge acceptance or automated browser install was performed. Existing
Windows Viewer, pairing/GM originals, backend services and Send were untouched.
Source main and immutable chatgpt-tab-notifier-5.7.30.user.js SHA-256:
e90df0cbd24dcf76db7eeb916f007ca0eb0db33ecc0627156c3298715f7d4eb1
Old immutable 5.7.28 and 5.7.29 files remain exact for code rollback.
Checkpoint: /workspace/repo/fortis-helper-catalog-race-20261022
Manual: update ONLY the existing Notifier Loader @version/@require to 5.7.30,
keep name/namespace/grants, save valued drafts and refresh ChatGPT tabs. Verify
the badge is 5.7.30 and the prompt count/list appears; select/detach without Send.
If still absent, report the current catalog status line; do not infer success.


## 22.10.2026 — Helper Prompts in Notifier Textbox (SOURCE TESTED, MANUAL INSTALL PENDING)

Notifier 5.7.29 adds an optional per-profile Helper prompt selector with search,
attach/detach and preview. Order: exact user original, selected resolved prompt,
then ordered extra modules. Original archive bytes stay unchanged; selecting a
prompt only saves its ID and never inserts, attaches a file or presses Send.
The existing preparation/File/Send safety path is unchanged.

Helper 0.40.10 adds a separate optional prompts[] field to the existing local
read-only BroadcastChannel catalog. Prompt/module texts stay in Helper's local
snapshot and transient consumer RAM; Notifier GM profiles store references only.
Commands, GitHub credentials and repository metadata are not projected. No
implicit GitHub reads or writes. Current source Helper was 0.40.9, newer than
the supplied 0.39.10 snapshot; it was extended in place, never replaced by ZIP.

Legacy profiles/catalogs remain compatible for modules. A selected prompt with
an old Helper, missing body/dependency, cycle or malformed catalog blocks
preparation rather than silently omitting instructions. Prompt module expansion
uses existing literal [[module:id]] references, depth/length limits, no eval.
Module overrides from Observatory retain the saved selected-profile prompt;
there is no new remote prompt-selection payload or Viewer/backend update.

Checks: Notifier full suite 280/280 (including event-driven DOM fixture),
Helper 230 tests, both build:check. Final logs are in checkpoint below.
No installed Chromium here; real Edge visual/GM/BroadcastChannel QA NOT_RUN.
No running service, Windows installed Viewer, browser Loader, GM originals,
pairing approvals, live Docker state, tasks or Send were changed by this work.

Notifier main + immutable chatgpt-tab-notifier-5.7.29.user.js SHA-256:
291790febbee4de03d5a2915494686080a0a3b9c01550889f1a02940b358c7b7
Helper main + immutable chat-command-palette-0.40.10.user.js SHA-256:
97f9ba6bf7a1bf249f05016fa5c1db5235ff805478db9591abbbb687b13e44cc
Checkpoint: /workspace/repo/fortis-helper-prompts-20261022
Manual: update the EXISTING Notifier Loader version/require to 5.7.29 without
changing name/namespace/grants; update the EXISTING Helper code/require to
0.40.10 without deleting its GM snapshot or GitHub token. Reload ChatGPT only
after saving a valuable draft. Use gear -> Prompt -> Attach; inspect preview,
then detach as smoke test, without File/Send. No Observatory reinstall/restart.


## 21.10.2026 — latest-task v2 активен в Docker/export; Notifier source 5.7.26

Владелец подтвердил все четыре TRUE installer для Viewer SHA
4df003701e5cc993a9914687c9211eba890d56eea6c71dfa030a6238f3744509.
Переключён только процесс Observatory на immutable candidate:
/workspace/repo/fortis-latest-task-20261021/candidate/repo_service.py.
State dir прежний, loopback 18754, PID 12953. Fallback v1 сохранён рядом.
Manifest SHA 74b1b062da2396ceb306f6a5a7bee895921292901b3e79554c729dd2b1c38f4f.
Проверка после запуска: API task_overview v2/basis latest_task, observer
чтение двух уже привязанных сессий OK, owner intents недоступны анонимно
и по observer key (401). Прежние пары/число событий сохранены, ключи
совпали до/после. Текущее число сессий 3. Откат не потребовался.

Проверенные source файлы модели/export/Notifier перенесены из isolated work
в /workspace/repos. Сессия теперь отражает последний пользовательский таск;
исторические счётчики в UI скрыты, карточки старых задач сохраняют статусы.
DOM использует одноцветные часы/галочку; только свежая scoped Observatory
сводка даёт пять статусных цветов. Local upload — одноцветная стрелка.
Node 261/261, Python 162/162, build:check, synthetic Viewer UI PASS в candidate.
Notifier source 5.7.26 SHA:
a11e40c372e46c3bcc33e278dce36595d79a1eb34788eb5bd5779bc38ae8e6b2.

Docker/container/Tunnel не перезапускались. Новых прав, intents, тестовых
событий/оригиналов и Send не создавалось. Windows Viewer установлен по
подтверждению владельца, но запуск и browser live QA v2 ещё не подтверждены.
Notifier Loader/GM storage в Edge не редактировались; версия в браузере
остаётся непроверенной (последняя подтверждённая 5.7.23). Следующий шаг:
запуск установленного Viewer, проверка текущих статусов, затем обновление
одной существующей копии Loader с сохранением name/namespace/GM originals.

## 2026-10-21 — 5.7.25 session favicon, source-only

Reads additive task_overview through the existing observer-status poll and
observer key. Same classifier/palette as Owner Viewer; no new route or grant.
Yellow wait, blue work, purple long silence/unknown, green reported completion,
red explicit reported failure. Draft/blocked use native favicon plus text;
there is no gray state or failure inferred from time. Other pending tasks get
a yellow corner; unread gets an independent white dot. Upload and actual DOM
generation retain priority. Merely arming Send is not proof of AI work.

Summary is memory-only, scoped to chat/session/binding generation and expires
after 20 seconds. Navigation, unpair/rotation, disabled mode, timeout, denial
or old API clear the AI color and expose a fixed title connection label.
Stale callbacks cannot clear newer pending requests. Existing raw completion
state/notifications remain; historical completed never replays a notification.
DOM unread is a green bell; viewed uses the native icon without gray.
No File/Send/archive gates changed; no second userscript or automatic Send.
256 Node tests and build:check PASS. Real Edge 5.7.25 NOT_RUN.
Live remains 5.7.23; no installation, service restart, reset, commit or push.
Build SHA256: 4af2e2021c69a5200bfcaf10b53bae030524bdcfce05506395bd5f086ff037c9

## 21.10.2026 — 5.7.24: task metadata, source-only

New task-intents monitor posts metadata only after verified local original/index
save. New records use intent_version/intent_ready; 5.7.23 history is not migrated.
Requires explicitly owner-granted task_intent_key for the same chat/session/origin.
Offline/reload retry and per-task ACKs never click Send or attach again.
Queue/manual Send observations get separate monotonic revisions; DOM sent is
send_observed, never a platform receipt. Original/activity/archive gates remain.
Owner Viewer has an explicit additional metadata-scope grant for an approved
claimant; old pairing keys never silently gain this permission.
241 Node tests and generated build check PASS. Real Edge 5.7.24 NOT_RUN;
working Edge remains 5.7.23, no services or installed loaders updated.
Colors and primary Viewer task export remain later stages. Do not install now.
Built userscript SHA256: f70b51228bd8b9492837c031b96dc0c651b3c723827dea8314dba279ed4f67ad

## 21.10.2026 — Notifier 5.7.23: безопасная проверка текста файла в ChatGPT

В 5.7.22 реальные вложение и Fortis task context могли попасть
в ChatGPT, но rich-editor innerText создавал другое представление
пустых абзацев. Вставка из File ошибочно заканчивалась
«Вставка не совпала с исходником посимвольно».

Теперь ТОЛЬКО для режима File и только при проверке rich contenteditable
позволяется различие чисто ПУСТЫХ строк между абзацами,
CRLF/LF и NBSP как обычный пробел. При этом каждая содержательная
строка должна полностью совпадать и находиться на той же позиции
среди других содержательных строк. НЕ схлопываются повторные
обычные пробелы, табуляции, символы инструкций, код команд.
Если пропущен task_id, инструкция, название прикреплённого файла
или есть добавленный текст — проверка возвращает отказ.

Обычная кнопка «Вставить» и обычный режим queued-prompt
остаются посимвольно строгими. Данные исходника в прикреплённом
TXT по-прежнему защищены SHA-256 до файла, а факт вложения
подтверждается точным file-card aria-label.

ТАКОЕ ЖЕ правило сравнения применяется к сохранённому
native draft File и ручной «Нажать Send», чтобы не получить
«успешную подготовку» с отказом следующей проверки.
Связка текущего чата, session_id, сохранённого task_id, полного
снимка Fortis-контекста и точного имени подтверждённого
вложения обязательна; отдельный Send остаётся одноразовым,
никогда не включается автоматически. Не утверждается, что
файл принят сервером ChatGPT или содержимое TXT сравнивалось
с серверной копией.

Добавлены тесты с имитацией rich-editor (вставка с лишними
пустыми строками), отказов при повреждённом task_id,
инструкциях, имени файла, пробелах внутри строки,
проверки saved draft перед Send и отсутствия Send
после подготовки. Test results below. Real Edge NOT_RUN.

Full tested output SHA256:
5d6c24978effc46980dd699568c8607a51782ca1d28b5667322cc9e495674c83

Notifier 5.7.23 требует обновить только существующий
Tampermonkey Local Loader; owner_viewer.py и owner_dispatch.py
с прошлой версии 5.7.22 не менялись. Второй Notifier не
включать, Repo Docker/профили/архив не менять.

## 21.10.2026 — Notifier 5.7.22 / Viewer full Notifier diagnostic in Textbox timeline

Confirmed Edge: file card is seen, and the prepared Fortis block can
reach ChatGPT, but strict native-rich-editor byte/character equality
can return false; Notifier displays a detailed local warning, while
Observatory previously showed only attachment_only + context_mismatch.

NEW: terminal File ACK also transports optional exact Notifier toast
text in detail. Detail is populated only by a closed, bounded allowlist
of fixed, known Notifier messages (including native insert-only and
append-only mismatch reasons, upload-unconfirmed, success and SHA
duplicate). Arbitrary prompt content, error stack, filename, user
strings and secret keys NEVER enter the owner journal. The Windows
owner_dispatch.py independently validates all message templates,
length <= 512 characters, mode == file, status permitted, existing
owner-scoped dispatch ID and pairing. It stores only latest 30
event records in memory. owner_viewer.py adds the FULL original
Notifier diagnostic after the status/reason in Textbox event history
using textContent (never innerHTML). The 5s status poll stays READ ONLY.

Example full status now visible both in Notifier and Observatory:
Файл прикреплён, но контекст не добавлен: Вставка не совпала с исходником посимвольно. Исходник сохранён; Send не нажимался. Не отправляй до ручной проверки.

No new task, no second attachment, no synthetic Send, no ChatGPT
receipt assertion and NO weakening of exact native-editor checks.
A visible ChatGPT context does not imply Notifier validated byte equality.
The historical 5.7.21 event is not retrospectively editable (status
history is only owner process memory). An updated Notifier, Viewer and
Dispatch must all be installed for new enriched event logs. Docker
Repo archive unchanged.


## 21.10.2026 — Notifier 5.7.21: точная карточка ChatGPT composer-attachment-surface

Получен настоящий outerHTML прикреплённого в ChatGPT файла:

    <button class="composer-attachment-surface absolute inset-0 cursor-interaction rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset" type="button" aria-label="fortis-prompt-mvh0e4ol.txt"></button>

Предыдущий fileAttachmentVisible() распознавал файл только
через специальный data-testid или aria-label с префиксом
"Attachment ...". Реальная карточка имеет filename непосредственно
в aria-label, а её надежный маркер — CSS класс
composer-attachment-surface на button[type=button].
Добавлена строго ограниченная альтернатива:
button.composer-attachment-surface[type="button"][aria-label]
и ПОЛНОЕ равенство aria-label ожидаемому имени. Проверка
aria-busy/data-state, ограничения на composer scope/его непосредственного
родителя и запрет на source contenteditable/обычный status
сохранены. Ни текстовое упоминание filename, ни другая кнопка,
ни файл с похожим префиксом не считаются вложением.

Проверка была RED до изменения: реальная форма кнопки не
распознавалась. После исправления GREEN, отдельные negative
cases исключают ложное подтверждение. SHA guard duplicate
прежде сообщал только в собственной панели Notifier; теперь
owner dispatch получает reason='duplicate' из того же
предварительного SHA-256 барьера. Никаких повторных attach,
альтернативного upload и auto-Send не добавлено.

Это изменение ТОЛЬКО в Notifier 5.7.21 и source/test/docs.
owner_viewer.py, owner_dispatch.py и Docker Observatory
переустанавливать НЕ НУЖНО. Real Edge live smoke этой версии
NOT_RUN. Проверять с новым уникальным безопасным текстом,
одной попыткой «Файл», БЕЗ Send; сравнить точный aria-label
карточки и наличие Fortis task_id в нативном composer.
Уже прикреплённые файлы не переприкреплять.


## 21.10.2026 — Notifier 5.7.20: не путать прикреплённый .txt с «отказом»

Пользователь реально увидел файл ChatGPT, но в Owner Viewer события
File были queued → claimed → refused (reason unknown), а кнопка
«Нажать Send» отказалась: нет подготовленного task_id.

Исходная причина: fileAttachmentVisible искал только ограниченный
набор DOM file-card маркеров внутри текущего container и имя файла
в самом элементе карточки. В новых вариантах DOM ChatGPT
имя находится во вложенном title/aria-label или preview располагается
рядом с формой. Тайм-аут ~5 сек приводил к возвращению undefined и
generic refused, хотя file input change уже состоялся и файл мог
оказаться в UI.

Изменения: проверяем также вложенный title/aria-label ТОЛЬКО
у доверенно распознанной карточки и одну оболочку над composer,
не всю историю беседы. Ни сам input.files, ни произвольное
упоминание имени в черновике/статусе не считаются подтверждением.

Теперь существуют ТРИ РАЗНЫХ статуса:
* attachment_unconfirmed: один input/change/drop был инициирован, но
  DOM-карточка не распознана; файл МОЖЕТ быть уже прикреплён,
  повторов и Send НЕТ, task_id не утверждается;
* attachment_only: DOM-карточка подтверждена, но Fortis task_id/
  контекст НЕ были успешно добавлены; Send НЕ нажимать;
* file_attached: и карточка, и подготовленный контекст + task_id
  подтверждены. Самого Send по-прежнему нет.

Owner Viewer показывает статусы + allowlisted причины в правом
журнале, не утверждает без доказательств, что file вообще не
прикрепился. Одно действие — не более одной попытки input/drop,
SHA-256 guard сохраняется и на неопределённом результате.

Исходники и synthetic Node/Python/UI tests PASS. Отсутствует
доступ к DOM конкретной реальной карточки пользователя, поэтому
точное совпадение с установленным Edge NOT_VERIFIED; при повторной
проблеме нужен DOM/скрин конкретной карточки, а НЕ повторная
загрузка и НЕ принудительный Send. Для установки нужен
Notifier 5.7.20 + owner_viewer.py + owner_dispatch.py по текущим
SHA. Repo Docker archive не изменяется.

## 20.10.2026 — Notifier 5.7.18: общие профили Textbox для Observatory

Вместо отдельного набора галочек Observatory видит ТЕ ЖЕ
сохранённые в Tampermonkey GM профили Notifier: ID, названия,
списки module IDs и активный профиль. Ничего не копируется в
постоянное хранилище Observatory. Единственный источник —
getProfiles() менеджера Notifier текущей зарегистрированной беседы.

Scoped POST /api/dispatch/modules отдаёт только метаданные профилей
и каталога id/title (без текстов модулей, JS и ключей). Owner Viewer
показывает профиль-селектор и его модули, обновляет active name
каждые ~5 сек, допускает временный выбор другого профиля для
конкретной адресной команды. При обычном действии передаёт только
profile_id и module_ids:null — Notifier самостоятельно применяет
из сохранённого профиля текстовые модули И behavioral options
(native-send-dwell, focus-after-send, обязательный task_id).
Выбор другого профиля в Viewer НЕ перезаписывает GM активный
профиль. Явные изменения чекбоксов для одной сессии
передаются как валидированный override module_ids для текущего
действия и не изменяют сохранённый профиль.

Профили остаются доступными по ID даже при временно
отсутствующем каталоге Planning Helper, но Notifier по-прежнему
fail closed, если текст указанных модулей недоступен; не шлёт
неполные инструкции. Обратная совместимость: старый local
owner dispatch без profile_id продолжает работать на активном
профиле Notifier. Протокол id/text ограничен, авторизован scope
dispatch_key и точным chat ID. Нет новой реализации Send/Файл
или автоматического Send. STARTUP fix от 5.7.17 сохраняется.

Нужны и новые owner_viewer.py + owner_dispatch.py, и один
Notifier 5.7.18. Проверить actual Windows Local Loader @require
путь и @grant GM_listValues (у пользователя до этого была старее
локальная копия loader). Реальная Windows/Edge проверка ещё NOT_RUN.


## 20.10.2026 — CRITICAL Notifier 5.7.17 startup fix + Local Loader mismatch

Версия 5.7.16 не запускалась целиком после доработки адресного
Observatory Textbox. `dispatchQuickAction` был объявлен внутри
`ensureUi()`, но перечислен в возвращаемом наружном объекте
`createUploadButtonUi()`; браузер бросал
`ReferenceError: dispatchQuickAction is not defined` ещё до
создания плавающих кнопок и Tampermonkey menu commands.

Красный тест (предыдущая версия) воспроизвёл тот же ReferenceError.
В 5.7.17 внешняя функция `dispatchQuickAction` объявлена в правильной
области видимости и остаётся стабильной ссылкой для Runtime;
внутренний обработчик получает значение после `ensureUi()` и
вызывается через внешний wrapper. Предусмотрен fail-closed, если
UI ещё не готов, без автоматического Send. Regression test проверяет
инстанцирование реального createUploadButtonUi + контракт делегирования.

Также user-supplied Local Loader Tampermonkey 1.0.0 использовал
`@require file:///C:/Users/alexa/tabnotifier-fileautosend-autochat/chatgpt-tab-notifier.user.js`
в то время как рабочий Windows checkout заявлен в
`C:\Users\alexa\Repos\tabnotifier-fileautosend-autochat`.
Обязательно проверить реальный путь исходника в Windows, затем обновить
`@require` существующего Local Loader (не создавать вторую активную
копию Notifier) и `@version 1.0.1` для переобновления кэша;
добавить `@grant GM_listValues`, который появился в Notifier core.
Никакие сохранённые GM-данные/профили не очищать.

Real Windows/Edge live Loader smoke ещё НЕ подтверждён, native
ChatGPT Send не выполнять при восстановлении. Это исправление не
требует переустанавливать Viewer или менять Docker archive.

## 20.10.2026 — Notifier 5.7.16: адресный Textbox Observatory — File, Insert, Send, Planning Helper

Owner Viewer Textbox отправляет узкий owner-bearer /api/dispatch только
по реально привязанной открытой сессии и с точным оригиналом.
Три режима: File / Insert / Send. Notifier выполняет их через
ТЕ ЖЕ внутренние handleQuickFile, handleQuickInsert, sendQuickCurrent,
что и собственные кнопки: дублирующих реализаций загрузки НЕТ.
File: одна попытка, SHA-256 consecutive guard per chat,
task_id + Fortis context + модули. Send не вызывается.
Insert: prepareDraft(task_id), без Send. Send: persisted queue,
с проверкой записанного task_id и send-status; ACK не receipt.

Notifier в scoped локальный /api/dispatch/modules сообщает ограниченный
список id/title (максимум 200), без текстов модулей и ключей.
В Viewer есть поиск и чекбоксы. Выбранные module IDs применяются
тем же active Behavior / Planning Helper движком через prepareForModules,
без изменения активного профиля Tampermonkey GM.
Если список ещё недоступен, module_ids=null означает использовать
активный профиль Notifier; [] — осознанно без текстовых модулей.
Ручной выбор Viewer хранится в памяти текущей owner вкладки.

Owner bearer + same-origin; отдельный dispatch key Notifier,
точный Chat ID, живой heartbeat, один in-flight command,
нет автоматических повторов. Не путать file_attached, inserted
и send_initiated с подтверждённым приёмом ChatGPT и Repo receipt.
Исходники / synthetic tests; Edge Windows live smoke NOT_RUN.
Чтобы обновление работало, нужны одновременно новая копия
Windows Owner Viewer и userscript Notifier 5.7.16.


## 20.10.2026 — Notifier 5.7.15: автоматическое обнаружение URL с ручным одобрением владельца

Notifier, уже установленный в Tampermonkey и запущенный во вкладке
https://chatgpt.com/c/<Chat ID>, каждые ~7 секунд отправляет
в локальный Windows Owner Viewer 127.0.0.1:18755 заявку на подключение
(POST /api/notifier/enroll) с Chat ID и собственным случайным
256-bit proof. Proof сохраняется в Tampermonkey GM по Chat ID.
НЕТ автоматической отправки пользовательского сообщения.

Owner Viewer сопоставляет Chat ID с ровно одной зарегистрированной
Repo-сессией и отображает заявку в защищённой owner UI.
Только явное одобрение владельца добавляет hash proof в отдельный
приватный Windows owner-ACL файл approved-notifiers.json. До
одобрения observer/writer/dispatch keys НЕ выдаются. После одобрения
тот же proof получает узкие scoped keys. После перезапуска Viewer,
вкладки, Tampermonkey или Windows proof и owner approval восстанавливаются,
dispatch key заново выдаётся при следующем valid poll. Код в меню
Tampermonkey теперь не нужен для обычного сценария, но резервная
ручная команда остаётся. Если вкладка закрыта, connection heartbeat
неактивен; когда её откроют, Notifier переподключится сам.

Безопасность: URL сам по себе НЕ grants permissions. Неизвестные
Chat ID, неверные URL, неразрешённые proof, чужие Origin и
неодобренные claimant получают отказ/ожидание. Оператор может
отозвать постоянное разрешение в Viewer. Отзыв owner auto-grant
не заменяет полную ротацию старых отдельно выданных Repo
observer/writer keys: эти права имеют отдельную область.
Реальный Windows Edge и reboot smoke пока НЕ ВЫПОЛНЕН;
source/synthetic tests не доказывают факт работы после reboot.
Viewer source/owner auto-login должны быть отдельно установлены.


## 20.10.2026 — Notifier 5.7.14: один клик «Файл» — только одна попытка загрузки (source only)

Во время реального owner Edge smoke для Notifier 5.7.13
пользователь сообщил: одно нажатие «Файл» приводит к двум
последовательным отправкам/прикреплениям. Точный характер
двойного результата (две карточки или два отправленных сообщения)
ещё требуется уточнить в Edge. Подтверждённый source-level баг:
после успешной синтетической передачи native file input скрипт
ожидал DOM-карточку; если ChatGPT создавал её с задержкой, цикл
переходил к резервному upload route (плюс меню или drag/drop),
вызывая ВТОРУЮ попытку того же файла из ОДНОГО клика.

Исправлено fail-closed:
- ТОЛЬКО один путь на клик: direct file input ИЛИ menu file input
  ИЛИ единичный drag/drop. Если был вызван native change, даже
  когда обработчик React бросил исключение или карточка ещё не
  найдена, другое input/drop не вызывается.
- Неподтверждённая карточка теперь даёт явный UNKNOWN с сообщением
  «возможно, файл уже добавлен»; никаких тайных повтора и Send.
  SHA-256, записанный до первой попытки, не позволяет дублировать
  этот же файл повторным кликом подряд в одном чате.
- Старые заполненный native composer, уже прикреплённые файлы,
  активные текстовые модули и Fortis context по-прежнему
  поддерживаются. Настоящий native Send НЕ вызывается.
- Выключить переключатель ⇧ автоотправки файлов перед owner smoke.

Добавлены регрессионные тесты delayed/missing attachment card,
selected direct/menu input, отсутствующего input после открытого
плюс-меню, отдельного единственного drop, двух compatible input
и throwing React change handler. Source tests не заменяют owner Edge
проверку; Windows/Tampermonkey не обновлялись инструментом.


## 20.10.2026 — Notifier 5.7.13: SHA-256 вместо запрета по занятому редактору (source only)

После owner Edge feedback файловый режим больше НЕ требует
пустого штатного ChatGPT composer и НЕ отказывается от прикрепления
на основании прежнего значения input.files/существующих карточек.
Повторная выборка native file input передаёт только НОВЫЙ файл
(старые input.files не переотправляются); действующие файловые
карточки ChatGPT не удаляются. Пока включён режим ⇧ upload auto-send
или есть незавершённая очередь, файл не начинает операцию:
это отдельная защита от нежелательного автоматического Send, а не
ограничение из-за предыдущего вложения.

Содержимое точного оригинала перед файловой попыткой хешируется
WebCrypto SHA-256 (байты UTF-8, включая завершающие пробелы/Unicode).
В Tampermonkey GM-get/set хранится только ПОСЛЕДНИЙ hash отдельно
по Chat ID. Второй подряд тот же SHA в том же чате блокируется,
даже если DOM ChatGPT уже очистился, кнопка нажата снова или
перезагружена страница. Другой SHA разрешён. Граница — попытка
прикрепления: после неизвестного результата прежний SHA тоже
блокируется для предотвращения дубля. Нет возможности обхода через
наличие/отсутствие файла в карточках, никаких исходных строк в hash
storage. При отсутствии криптографии или подтверждения сохранения
hash путь отказывает, а не выключает проверку.

Второй и дальнейшие РАЗНЫЕ файлы разрешены в одном native
редакторе. Перед ними сохраняется точный snapshot его текста, затем
добавляется ТОЛЬКО новая короткая инструкция о конкретном файле +
активные модули Planning Helper + Fortis task context. Проверяется
точность read-back; существующий текст не заменяется, большой
оригинал переносится только в .txt. Несколько последовательных
драфтов получают собственные task_id. При РУЧНОМ native Send
сопоставляются точные вложенные префиксы и видимые карточки этих
файлов, после чего выставляется только send_unconfirmed.
Нет автоматического Send, искусственного archive receipt или
автоматического повторения попытки.

Граница достоверности: пройденные тесты — синтетические source
tests, установленный Edge/Tampermonkey не обновлён инструментом.
Реальные DOM вставка контекста к уже занятому редактору и
передача двух файлов требуют отдельного owner Edge smoke.
Потеря контекста при DOM преобразованиях приводит к явному отказу,
но уже выбранный файл может остаться в UI. При появлении предупреждения
не нажимать Send, пока не сверены вложения и текст.
Второй userscript не устанавливать.


## 20.10.2026 — Notifier 5.7.12: «Вставить» и «Файл» с активными модулями (source-only)

Оба режима используют textboxProfileManager.prepare(originalText):
текстовые модули активного профиля Planning Helper и обязательный
Fortis task_id контекст подготавливаются перед ручной отправкой.
Профили, которые не удалось прочитать/разрешить, приводят к
явному отказу, а не к тихой отправке без модулей.
persistentMessageController.prepareDraft сохраняет в Tampermonkey
локальную запись send_status=draft: task_id, точный original_text,
submitted_text с task context и модулями, текущий Chat ID / Repo session.
Создание черновика НЕ нажимает Send, НЕ запускает очередь и НЕ
означает archive receipt.

«Вставить» на коротком промпте заполняет пустой native composer
подготовленным submitted_text (оригинал + Fortis context + модули)
без Send. При запросе >=12000 символов переключается на файловый
режим, чтобы избежать фактически обнаруженного зависания Edge.
«Файл» создаёт UTF-8 .txt из оригинала, ждёт подтверждаемую
карточку, затем заполняет пустой composer только короткой
инструкцией прочитать файл + Fortis context + модулями.
Task ID связывает локальную запись с оригиналом, а не с инструкцией.

Ручное нажатие штатного Send пользователь выполняет сам.
Notifier осторожно отслеживает только доверенный native click/Enter/submit,
точное совпадение черновика с native composer и, для файла, наличие
карточки без upload-busy; ставит статус send_unconfirmed.
Реальные sent и archived receipt не выдумываются. Если пользователь
редактировал подготовленный контекст, автоматическое связывание task_id
не гарантируется. Старые режимы ➤ и очередь не изменены.

Ограничения: max 512 KiB оригинала для локальной task записи;
если текст контекста с модулями >=12000 символов, Notifier
отказывает в текстовой вставке во избежание подвисания.
Занятый native composer не перезаписывается, файл к нему
не добавляется. Уже прикреплённый файл при сбое сохранения
контекста требует ручной проверки. Реальный Edge smoke,
действующий Tampermonkey и Windows Viewer не обновлялись;
синтетические тесты не заменяют browser acceptance.
Второй userscript НЕ устанавливать.


## 20.10.2026 — Notifier 5.7.11: Edge insert-only false-abort correction (source only)

Во время пошагового owner Edge smoke версия 5.7.10 отклонила
«Вставить без Send» на коротком промпте с пробелами, пустой
строкой и Unicode. В богатом editor ChatGPT визуально пустой
contenteditable может иметь innerText как структурный перенос
строки (<p><br></p>). Предыдущий insertOnly проверял точное
равенство с пустой строкой ДО первой вставки и давал
«Редактор изменил часть текста» без попытки insertText.

5.7.11 разрешает структурную пустоту ТОЛЬКО до первого символа,
при этом отдельно проверяет отсутствие значимых текстовых узлов.
Сразу после начала вставки и при завершении остаётся прежняя
строгая посимвольная проверка; не преобразуем произвольно
пробелы, NBSP, пустые строки или Unicode, не запускаем Send и
не создаём task_id. Специальные тесты проверяют rich composer
placeholder, невидимый чужой текст, real insert attempt и
отказ при потере переносов. Исходник Fortis Textbox сохранён.

Не считать Edge smoke завершённым: update существующего
Tampermonkey userscript до 5.7.11 и заново проверить короткий
промпт в реальном native composer без Send. Поведение React/
ProseMirror и длинного текста 68k остаётся не подтверждено
только синтетическими тестами. Observatory Docker/Windows не
менялись; второй userscript не создавать.


## 20.10.2026 — Notifier 5.7.10: проверяемая вставка и карточка файла (source-only)

Исправлены source-level проблемы независимого review F-P-03/F-P-05.
«Вставить без Send» сверяет точное значение, видимое через native
composer read-back, вместо tolerant нормализации whitespace. При
изменении пробелов, пустых строк, табуляции или Unicode — явный отказ,
исходник остаётся в Fortis Textbox, Send не выполняется. Для
contenteditable браузер может преобразовывать представление текста:
при таком несовпадении функция отказывает, а не заявляет точную
доставку. Реальный Edge acceptance нужен, включая 68k+ символов.

Проверка «Файл» принимает только выделенную DOM-карточку
вложения с признаками attachment/file preview и видимым именем;
голое имя в тексте composer или status не считается доказательством.
Состояния loading/uploading/error и обнаруженная общая busy-индикация
блокируют успех; если DOM ChatGPT изменился — возможен безопасный
отказ. Подтверждение карточки не доказывает фактический приём файла
сервером ChatGPT; перед ручным Send проверить карточку и отсутствие
загрузки в реальном Edge. Автоматический Send и task_id у режима
«Файл» не добавлены. Установленный Tampermonkey этим изменением
не обновлялся; не создавать второй userscript.


## 20.10.2026 — Notifier 5.7.9: адресные команды Observatory (source-only)

Новая opt-in функция активируется ТОЛЬКО после повторной явной
привязки Chat ID к Owner Viewer по актуальному коду, включающему
отдельный dispatch_key (не observer_key / writer key).
Notifier периодически опрашивает узкий localhost route
/api/dispatch/poll только в текущей привязанной беседе.
Открытые вкладки (включая фоновые) могут получать уникальные
одноразовые команды «Вставить» или «Отправить». Полученную команду
Notifier проверяет по текущему Chat ID и ключу перед исполнением;
запрос при смене беседы, занятый native composer, генерация и
автоотправка файлов должны отказывать, а не подменять текст.

«Вставить» пользуется уже реализованным insertOnly, не нажимает
Send и не создаёт task_id. «Отправить» использует исходный
persistentMessageController.saveAndSend: новый task_id и точный
оригинал сохраняются локально до постановки в очередь штатного
ChatGPT Send; профиль/Planning Helper применяются тем же Notifier.
Статус send_initiated означает только локальную подготовку/очередь;
это НЕ полученный ChatGPT ответ, НЕ архивный receipt.
Одноразовый dispatch_id выдаётся лишь одной из открытых вкладок.
При отсутствии ack нет автоматического повтора, возможен
неподтверждённый итог; повторное действие — только новый
осознанный запрос владельца.

Очереди для закрытых вкладок, remote file upload с task_id,
гарантированного перехвата manual Send после insert-only нет.
Runtime Installer/Edge ещё не обновлялись, настоящая отправка
в Edge НЕ подтверждена. Docker Observatory сам по себе не становится
удалённым sender — channel остаётся в Windows-owner local Viewer.
Связанные права и endpoint реализации только в Repo sources
tunnel/observatory/v1/owner_dispatch.py + owner_viewer.py.
Не публиковать pairing JSON в чате, Git и event summary.


## 20.10.2026 — Notifier 5.7.8: «Вставить» без Send (source-only)

В правой вертикальной полосе Fortis Textbox добавлена отдельная
кнопка **«Вставить»** между «Файл» и ➤. Она переносит исходный
текст в штатный composer ChatGPT, не создаёт task_id, не вызывает
persistent saveAndSend, очередь или Send. Чужой непустой composer
не затирается. Текущий точный исходник остаётся в Fortis Textbox
после вставки. Большой текст переносится ограниченными порциями
с добровольными уступками главному потоку браузера, а неполный
перенос считается отказом. Кнопка ➤ сохраняет прежнее поведение.
Для прямой ручной отправки native ChatGPT Send после «Вставить»
гарантия task_id/автоархивации НЕ добавлена — это отдельный
pending выбор. Режим «Файл» остаётся best-effort и требует
реальной проверки ChatGPT/Edge. Не устанавливать второй userscript;
обновить существующую Tampermonkey-копию только после согласования
и теста владельца.  Эта source-правка не обновляет активный Edge.


## Notifier 5.7.7 — «Файл» прикрепляет к ChatGPT напрямую (source only)

По скриншоту владельца режим 5.7.6 лишь скачивал .txt, потому что
не находил подходящий стандартный input ChatGPT. В режиме 5.7.7
кнопка «Файл» (над ➤) создаёт UTF-8 .txt из полного RAM-помещённого
оригинала и **пробует прикрепить сразу к выбранному открытому чату**:
сначала через нативный файловый input, затем поиск динамического input
при открытии меню +, затем синтетический drag/drop на реальный composer.
В отличие от 5.7.6, больше нет автоматического скачивания.
Проверка результата требует видимой карточки с именем файла в
composer ChatGPT: ввод в input.files / успешный dispatch сам по себе
не доказывает прикрепление. Если карточка не появилась, сообщается
ошибка, текст остаётся в Fortis Textbox. Если сайт занят реальной
загрузкой, повторная попытка блокируется во избежание дублей.

Это best-effort код в Tampermonkey. Невозможно гарантировать, что
текущая версия ChatGPT принимает синтетические File/drop события:
необходим реальный Edge smoke. Пользователь нажимает Send вручную,
после визуального подтверждения прикреплённого .txt и загрузки.
Автоматической отправки и ложных receipt для этого файлового режима
нет, task_id/original архивирование этого режима пока не реализовано.
Observatory и службы Windows/Docker не менялись.


## Notifier 5.7.6 — резервная передача большого промпта через .txt (source only)

Новый явный файловый маршрут **не** вставляет десятки тысяч
символов в родной contenteditable ChatGPT. Кнопка **Файл** расположена
над стандартной ➤ справа от Fortis Textbox. Она берёт полный
текст (в том числе RAM-текст после быстрой вставки), без обрезания,
создаёт fortis-prompt-*.txt в UTF-8, максимальный размер файла
4 МиБ. Сначала пробует штатный input[type=file] текущего
ChatGPT composer через File + DataTransfer + change. Это только
выбор файла, **не** гарантия завершённого upload/приёма платформой.
Нужно проверить карточку вложения и дождаться загрузки.
Если подходящего input нет или браузер отверг выбор, создаётся
локальный download .txt: приложите его вручную через плюс ChatGPT.
Повторное «Файл» после выбора файла (при сохранённом состоянии input)
тоже скачивает .txt для ручной загрузки.

Файловый режим намеренно **не нажимает Send**, не запускает очередь,
не добавляет автоматически task_id и не сообщает ложный статус
архивации. Ручной Send после прикрепления не проходит через обычный
persistentMessageController: полный исходник остаётся в textbox,
но автоматическая точная user-original архивация по task_id для
этого отдельного маршрута пока **не реализована**. Для этого нужен
следующий этап file-aware task transport с доказательством загрузки
до автоматической отправки. Обязательно вручную проверить файл
в Edge после обновления существующего userscript.

Режим блокируется, если включена ⇧ автоотправка файлов или активна
другая отправка. Фото-only input, уже выбранный файл и неверный
контекст не перезаписываются. Другие функции Notifier и Observatory
не менялись. Не устанавливайте второй userscript.


## Notifier 5.7.5 — длинные промпты с точным оригиналом (source ready)

Ограничение 64 КиБ из версии 5.7.4 снято на всем пути Notifier →
защищённый Windows Viewer → узкий Docker relay → Repo archive.
Новый единый лимит составляет 512 КиБ UTF-8 на исходный пользовательский
текст. Для русскоязычного промпта число символов может быть меньше,
чем 524 288. Нельзя обещать, что сам ChatGPT примет промпт такой длины.

Для вставок от 12 000 символов весь оригинал удерживается в памяти,
показывается короткий preview. Кнопка ↗ раскрывает и позволяет изменить
весь текст в textarea, ⧉ копирует точную исходную строку, × очищает.
➤ переносит текст целиком в штатное поле ChatGPT порциями до 4096 UTF-16
единиц с уступкой управления браузеру между порциями. Кнопка Send
нажимается только после проверенного завершения переноса и штатной
паузы. При редактировании/смене редактора отправка отменяется.
Существующие small prompts/очереди/профили не меняют маршрута.
Сохранение оригинала остаётся до передачи штатному editor.

ВАЖНО: исходники Docker сервера и Windows bridge/viewer изменены, но
запущенная служба может оставаться старой версии с лимитом 64 КиБ.
Для полного сквозного режима требуется контролируемый рестарт
существующего Repo Docker Observatory, повторная защищённая установка
Windows Viewer с обновлённым SHA из tunnel/observatory/v1/
OWNER_VIEWER_MANUAL_SETUP.md и затем обновление ТОЛЬКО существующего
userscript Notifier 5.7.5. Без развёртывания нельзя утверждать,
что более 64 КиБ архивируется в работающей системе.
Browser Edge end-to-end smoke пока не выполнен.


## Notifier 5.7.4 — защита от зависаний при большой вставке (source ready)

Причина зависания конкретного Edge пока не подтверждена профилированием.
Ранее каждая обычная UI-перерисовка читала всю локальную историю
включая длинные оригиналы через синхронное GM-хранилище, даже когда
панель + закрыта. Теперь списки очереди, отложенных и оригиналов
перерисовываются только при открытой панели +.

Для правого Fortis Textbox добавлен быстрый приём вставок от 12 000
символов: полный точный текст остаётся в оперативной памяти вкладки,
а textarea показывает только короткий предпросмотр. Текст не отправляется
автоматически. ➤ использует полный оригинал, создаёт task_id через
существующий persistentMessageController и продолжает исходный
путь отправки без изменений. Пока большой текст в памяти, поле только
для чтения, кнопка ⧉ копирует полный текст, × очищает его.
При закрытии/перезагрузке вкладки **несохранённый** большой черновик
исчезает; это не долговременное хранилище.

Быстрая кнопка ➤ не отправляет текст больше 64 КиБ UTF-8, поскольку
текущий путь оригиналов Notifier→Owner Viewer ограничен 65536 байтами:
отказ происходит до создания task_id, текст остаётся доступным для
копирования. Для более крупного исходника нужен отдельный согласованный
путь без нарушения exact-original архивации. Остальные кнопки и
режимы очередей не изменены. Модульные тесты не заменяют реального
Edge/Tampermonkey smoke. Пользователь вручную обновляет существующий
userscript на версию 5.7.4; отдельный второй скрипт не устанавливать.


## Notifier 5.7.2 — identity from each message, never a remembered prompt

The mandatory code-only TaskIdBehavior now puts the NEW request's
task_id and, when bound, exact current reporting_session_id and
conversation_id into Fortis task context. It supplies the complete
Repo task-sender command lines with these current IDs. The new
Repo sender derives session_task_id from the Docker archive,
not from the previously generated long chat prompt. No bearer,
observer_key, writer_key, or session enrollment secret is
embedded into conversation text.

The id-free startup bootstrap is available now from
python3 /workspace/repos/tunnel/observatory/v1/repo_service.py bootstrap.
Running Observatory HTTP still serves the older long prompt until
controlled owner restart. Update ONLY the existing Tampermonkey
Notifier userscript to 5.7.2 to activate new per-message context.
No GM wipe or extra pairing is needed; actual Edge behavior has
not yet been verified.

## 19.10.2026 — Notifier v5.7.1: AI-assisted attach of existing TextModules

The ONLY editor, library authority and GitHub persistence for
TextModules remains Planning Helper. In Notifier ⚙ the user can now
paste one or more module IDs / references into the new
«Подключить по ID» field, e.g. [[module:fortis.observatory-telemetry]].
One click attaches up to 20 EXISTING modules to the current profile.
The browser validates ALL IDs against the current read-only Helper
catalog, plus the entire nested-reference graph, BEFORE saving
the profile. Unknown IDs, missing nested dependencies or cycles
reject the entire batch; no partial activation and no JS execution.
The original user's raw text remains unchanged for Observatory.

AI working through Fortis Repo can list repository source module IDs:
python3 /workspace/repos/obs-planning-docs/planning/helper-library/tools/notifier_module_refs.py --list
and prepare pasteable references:
python3 /workspace/repos/obs-planning-docs/planning/helper-library/tools/notifier_module_refs.py --ids fortis.observatory-telemetry
This tool is READ-ONLY and checks canonical source files, not the
private Planning Helper GM state. Browser-local-only modules may be
unknown to Repo; Notifier still validates against current local
Helper catalog before attaching. AI cannot silently change browser
profiles: user confirms by clicking in Notifier settings.

NEW ordinary TextModule source:
obs-planning-docs/planning/helper-library/modules/fortis.observatory-telemetry.module.md.
It reminds AI to use the current task_id, get enrollment from the
Observatory generated session prompt, call Repo emit.py for metadata
and repo_message_sender.py for full AI text using UTF-8 stdin,
and avoid false STAGED_ONLY assertions. No session keys or fixed IDs.

Important: a new Repo file is NOT automatically present in private
browser Tampermonkey GM storage. To make it visible, use the
already-existing Planning Helper UI: Prompts → Modules → Import.
Paste the full PLANNING_HELPER_LIBRARY_ITEM marker block from the
source file and confirm import. Use its existing Save GitHub action
on this module to publish, then Sync missing on other installations.
Notifier has no editor for text modules, as requested.
Real owner Edge acceptance pending after manually updating Notifier.

## 19.10.2026 — Notifier 5.7.0 × Planning Helper 0.40.9: profiles + shared TextModules

Implemented fourth floating button (⚙ under ⇧) for profile creation,
selection and deletion; attach-only searchable module picker for
existing Planning Helper text modules, per-profile ordering,
removal and code-only behavior-module toggles. Original ◷ / + / ⇧,
queue, checkpoint, upload-after-file, pre-Send delay, immutable
exact user originals and Fortis Repo path preserved.

Planning Helper remains the ONE editor and source for TextModules
in its existing GM local snapshot (obsPlanningHelper:v2:localSnapshot).
Helper publishes an ephemeral read-only catalog (id/title/text)
over same-site BroadcastChannel (fortis-shared-helper-text-modules-v1)
on initialization and after confirmed snapshot writes, including
Save GitHub / Sync missing / Hard Reload GitHub. Notifier stores
ONLY IDs in profiles, never a second durable text copy. Its UI has
NO module editing/creation/GitHub actions. A missing Helper catalog,
missing module or circular module reference blocks sends using that
module rather than silently injecting old text. Empty profiles
still send normally. Added module text affects submitted_text only;
original_text remains exact and separately archived.

Behavior modules are code-only plugins in src/textbox-behaviors.js:
id, title, description, defaultEnabled and apply(context). Settings
creates toggles automatically. Task-id/original behavior mandatory,
other defaults are native 1s wait and textbox focus return. No
JavaScript editor/eval anywhere in Notifier.

Manual owner Edge update of the TWO EXISTING Tampermonkey scripts:
- Planning Helper 0.40.9-repository-command-registry at:
  C:\Users\alexa\Repos\obs-planning-docs\planning\documentation\tools\tampermonkey\chat-command-palette.user.js
- Notifier 5.7.0 at:
  C:\Users\alexa\Repos\tabnotifier-fileautosend-autochat\chatgpt-tab-notifier.user.js

Do not install duplicate userscripts; save, reload ChatGPT. Create
and edit TextModules only in Planning Helper. In Notifier press ⚙,
select a profile and attach a local module. Verify changes made in
Helper or loaded using its GitHub tools immediately appear in
Notifier without copying module contents.
Browser/E2E acceptance pending: Node integration simulates
BroadcastChannel, not actual owner Edge/Tampermonkey behavior.

## v5.6.6 — chronological Observatory tasks and exact browser originals

The owner-launched Observatory Viewer displays tasks chronologically with an accepted timestamp and a snippet only from an actually archived exact original; missing originals show a clear placeholder. A new owner-only «Создать код привязки Notifier» action returns per-session observer and writer capabilities. Paste the code only into the Tampermonkey «Fortis: привязать текущий чат» command for the same chat. Do not paste it into ChatGPT.

The pinned local owner Viewer origin `http://127.0.0.1:18755` now supports narrow activity/status reads and conditional exact-original uploads after accepted task activity. Notifier verifies the server's SHA-256 receipt. AI full answers still go directly via Fortis Repo. Previously unpaired or other-origin tasks are never silently migrated. Installation requires manually updating BOTH the owner Viewer (including `owner_notifier_bridge.py`) and existing Tampermonkey userscript; details and pinned hashes are in `../tunnel/observatory/v1/OWNER_VIEWER_MANUAL_SETUP.md`. Browser end-to-end acceptance remains pending.

## 19.10.2026 — Notifier 5.6.5: Enter → штатный ChatGPT и Send через 1 секунду

**Изменено только поведение НОВОГО правого Fortis Textbox.**
Enter (также Ctrl/⌘+Enter) в правом текстбоксе сохраняет exact
original + task_id в Tampermonkey, переносит подготовленный prompt
в *штатное* поле ввода ChatGPT и **только спустя минимум 1000 ms
после фактической вставки** нажимает обычную кнопку Send.
Обычный Shift+Enter/Alt+Enter — перенос строки; ввод IME,
повтор удерживаемой клавиши и другие клавиши не отправляют.
Кнопка ➤ проходит точно тот же новый путь.
Новая задержка 1000 ms не применяется к старому
«Сохранить и отправить» в панели +, обычной очереди,
чекпоинтам или автоотправке файлов.

Проверка присвоения task_id и GM save-before-Send не ослаблена.
Перед нативным кликом текст в ChatGPT проверяется повторно;
если пользователь изменил его во время ожидания, автоматическая
отправка отменяется (без перезаписи пользовательского текста).
Повторный click/send при pending не разрешён; при неподтверждённом
Send нет слепого повтора. Таймаут нового пути увеличен до 6.5 s,
чтобы включить секунду ожидания.

**Версия userscript 5.6.5; 129/129 JS тестов PASS,**
build/check PASS. Изменения пока только в checkout Fortis Repo
и сгенерированном userscript. Для real Edge-проверки владелец
сам обновляет ранее установленный **один** скрипт Tampermonkey,
перезагружает ChatGPT и отправляет безвредный тест через Enter.
Никакого изменения Docker Observatory/сети/Windows GUI не было.

## 19.10.2026 — Fortis Textbox v5.6.4 fixes observed LIST_FAILED

Owner Edge screenshot on v5.6.3 showed the exact error
**LIST_FAILED** on textbox send, while the input stayed intact.
The adapter's GM_getValue/GM_setValue steps could run but the
GM_listValues enumeration could not be confirmed (missing, throws,
or returned invalid shape). The browser-side underlying reason
for this method's failure is not yet isolated, but it must not
be a prerequisite for a durable record.

v5.6.4 introduces a **per-chat persistent index** containing only
task storage keys. It uses the same GM_getValue/GM_setValue methods
and verifies that BOTH original record and index round-trip before
native Send. The record body remains in a separate immutable-task
key; listForChat merges native enumerated legacy entries when
available, and uses the index whenever enumeration fails. Legacy
object-format records remain readable. Existing unindexed records
are never wiped; when native enumeration is unavailable, they
cannot be rediscovered in UI until it is restored because their
task keys are unknown. No destructive cleanup/migration.

All pre-click statuses (prepared, send_queued, send_unconfirmed,
sent) remain guarded by verified updates. Index write/readback
failure still aborts Send; no blind retry on uncertain result.
UI, three original buttons, delayed-send and upload-auto-send
handlers unchanged. **122/122 JS tests PASS**, built userscript
v5.6.4, source diff check PASS.

**To test on owner's Edge:** replace the active existing
Tampermonkey userscript contents with
chatgpt-tab-notifier.user.js v5.6.4, save, reload current ChatGPT
tab (do NOT install a second active script). Then try a harmless
short message through the new right-hand textbox. If it still
fails, share only the error code displayed in the toast, not
message body or GM data. No owner browser changes performed via
Fortis Repo; real acceptance PENDING.

## 19.10.2026 — Fortis Textbox v5.6.3: GM storage compatibility / failed save guard

Real owner Edge screenshot after installing v5.6.2 showed
«Не удалось сохранить исходник. Отправка отменена.» while the
right-hand textbox retained the unsent text. This means the
persistent user-message record did not pass the local save checks;
without a stage-specific error, the exact cause is not known.

**Source fix:** plain JSON strings are now used for GM records.
Read-back accepts both string and legacy object-format records,
without deleting existing history. Every save still requires exact
read-back and GM key-list discoverability BEFORE native ChatGPT
Send; failure blocks Send. A UI render exception is no longer
misclassified as a failed write. Diagnostic codes do not include
message text or keys: WRITE_FAILED, READ_FAILED, READBACK_MISMATCH,
LIST_FAILED, LIST_NOT_VISIBLE, LIST_NOT_ARRAY, STORAGE_UNAVAILABLE.

**v5.6.3:** generated userscript, tests 116/116 PASS,
build:check PASS. Original three buttons and new right textbox
unchanged in appearance and behavior. No owner Edge/Tampermonkey
installation was performed via Fortis Repo.

**Manual test:** replace the existing installed Tampermonkey
userscript with v5.6.3 generated chatgpt-tab-notifier.user.js,
save and reload ChatGPT. Do not create a second active copy.
No GM storage cleanup/reset needed. Try a non-sensitive test
message. If failure repeats, share only the diagnostic error code,
not original text or GM storage values.

## 19.10.2026 — Fortis Textbox v5.6.2: плавающий ввод справа от трёх кнопок

**SOURCE READY — Edge/Tampermonkey ещё не обновлялся инструментами этого чата.**
В том же Shadow DOM floating-host справа от исходных кнопок
◷ (отложенный чекпоинт), + (очередь/отложенные сообщения),
⇧ (отправка после завершения загрузки файлов) добавлено
**постоянно видимое поле Fortis Textbox с кнопкой ➤**.
Оно движется вместе с тремя кнопками при перетаскивании за
старые кнопки или новую рукоятку ⠿ слева от поля.
Выделение текста, курсор и прокрутка в самом поле не
начинают drag; расположение всего блока сохраняется по
прежнему ключу floating UI position, с ограничением шириной
экрана. На узких окнах поле сжимается, но кнопки сохраняют
размер 34px.

**Значения старых кнопок и их обработчики не менялись**:
◷ всё ещё включает/отключает чекпоинт, + открывает прежнюю
панель очереди с delayed-send/ручным временем и всеми её
командами, ⇧ включает/отключает автоотправку после загрузки
файлов. Новая кнопка ➤ вызывает ровно тот же
persistentMessageController.saveAndSend(original) как
«Сохранить и отправить» в старой панели +:
локально сохраняет исходник и новый task_id, затем запускает
существующий native ChatGPT Send controller. Не очищает
поле при ошибке сохранения. Обычный Enter создаёт новую
строку, Ctrl/⌘ + Enter вызывает ➤. Никакого нового
прямого канала в Docker/Observatory здесь нет.

Файл для установки в Tampermonkey: chatgpt-tab-notifier.user.js
(сгенерирован из 16 модулей, @version **5.6.2**).
Для появления UI нужна **ручная замена/обновление** установленного
userscript в профиле Edge и перезагрузка ChatGPT.
Не заводи второй экземпляр скрипта одновременно;
проверь резервное копирование Tampermonkey GM storage и
существующие настройки перед заменой. Скрипт не установлен
через Fortis Repo MCP и не проверен в реальном owner Edge.

Проверено: node --test полный набор **112/112 PASS**,
npm run build:check PASS и git diff --check PASS.
Автоматическое архивирование точного оригинала из браузера в
единый Docker volume остаётся отдельным невыполненным
транспортным шагом; запись полного ответа AI через Fortis Repo
не изменялась.

## 19.10.2026 — AI uses Fortis Repo directly (current user direction)

The **primary AI transport** for work events and full assistant
interim/final messages is **Fortis Repo tool → Repo Docker local senders**.
No G2, owner HOST, Windows browser relay or Windows Observatory is
required for this AI-to-Observatory path. The Repo source directory
named `tunnel` is just a legacy folder label, **not a required tunnel**.

`TaskIdBehavior` now includes instructions to use Fortis Repo rather
than an unspecified Observatory tool. When the browser has a validated
Docker pairing for the **same Chat ID**, its augmented prompt also
contains only the nonsecret reporting session and conversation IDs;
AI can retrieve enrollment ID via Repo `repo_service.py instructions`.
Observer/write capability tokens are never added to the augmented
prompt. On a missing or mismatched pairing no Repo session is invented.
Native Send and exact original local GM record are unchanged.

**Separate concern:** the browser's locally saved *exact user original*
has not been automatically transferred into Docker. No previously
proposed Windows relay is mandatory for sending AI messages via Repo;
it remains optional source-only until separately approved. Browser
installed userscript/pairing still needs real acceptance. Reply text
claiming it was sent does not constitute a tool call.

## 19.10.2026 — Owner-local Docker bridge source prepared, NOT installed

The Fortis tunnel workspace now includes `observatory/v1/owner_browser_relay.py`,
`browser_relay_dispatch.py` and `repo_browser_pair.py`, plus source tests
and `BROWSER_RELAY_OWNER_INSTALL.md`. They implement a **narrow Windows
127.0.0.1:18754 → Docker exec → the existing single Docker Observatory**
route for read-only observer status, read-only per-task activity and
conditional original-text write. They do not create a Windows
Observatory archive or publish any Docker port.

**Browser Notifier source can already accept the exact Docker origin**,
but the owner's actual Windows relay is neither deployed nor accepted
by owner-positive/guest-negative tests; installed Edge/Tampermonkey
cannot be claimed connected. Pairing code with per-session writer
capability is designed for the **owner's local console only**, never
for a chat message or MCP tool output. Until real pairing and safe
network access exist, exact user original remains in local GM storage
with pending status and native ChatGPT Send should not be retried
automatically. Previous saved messages remain bound to their original
Observatory endpoint.

## 19.10.2026 — Docker origin support: SOURCE READY, network bridge NOT EXPOSED

Notifier can now accept either of **two exact local pairing origins**:
`http://127.0.0.1:18753` (historical Windows Observatory) or
`http://127.0.0.1:18754` (candidate Docker Observatory behind an
approved **Windows-local** bridge). These are the entire allowlist;
hostnames, host aliases, URLs with path/query, wildcard endpoints,
remote origins and changed protocols are rejected. A pasted pairing
code **does not** give permission to arbitrary hosts.

New messages store immutable `observatory_origin` in local GM storage.
A changed pairing origin, even with the *same* reporting session/key,
cannot redirect a previously sent original or a pending activity check
to another server. Old persisted messages that predate this field are
treated as bound to legacy `18753`, never silently migrated to Docker.
Native Send and offline queue behavior are unchanged. The Tab Notifier
does not obtain or expose the local Docker HTTP bearer.

**Important:** Docker `127.0.0.1:18754` is not Windows
`127.0.0.1:18754`. No port binding, proxy, tunnel or owner/guest
privilege change was made. From the restricted Windows check,
container port 18754 was not reachable. Therefore no browser→Docker
end-to-end acceptance is claimed. The new pairing source support is
**dormant** until an explicitly reviewed local adapter/port bridge is
installed and verified in the actual Edge/Tampermonkey environment.

`npm run verify` now passes **104/104 tests**, including six new
origin isolation checks and the existing 98 tests. Userscript regenerated
from 16 source modules. No installed browser userscript was modified.

## 19.10.2026 — CURRENT target: single Docker Observatory, original still local

The user's active architecture (Fortis Candidate v8) is **one Observatory in
Fortis Repo Docker** and **one Docker volume archive** for event metadata,
original user messages and AI interim/final bodies. Repo source now supports
these queues and history. Previous Stage1B/1C notes referring to an
owner-Windows archive are **historical source stages**, not a requirement to
run a separate Windows Observatory.

**Notifier current code has NOT been bridged to the container.** It still
uses the previously paired browser-local Observatory endpoint for accepted
activity and the per-session writer; Docker's loopback
`127.0.0.1:18754` is **inside Docker**, not automatically accessible as
a Windows Edge endpoint. Original messages remain in Tampermonkey GM storage
until a real matching Docker activity receipt AND an authorized write/read-back
succeed. Do not mark `archived` simply because Repo's AI body importer works.
Never resend a native ChatGPT prompt solely because the Docker writer is
unreachable. Don't copy original user text into the Repo metadata event inbox.

**Next required browser integration:** select and review a secure
Windows-browser-to-Docker channel with origin checks and narrow pairing
capabilities, test owner/guest access boundaries for that actual channel,
then connect per-task receipt and exact original write to the **same**
Docker volume. This is outstanding; live Tampermonkey/Edge acceptance is
not yet claimed. Current Repo AI message sender is separate and reads stdin,
not the browser DOM; it cannot prove full DOM equivalence.

Tampermonkey userscript for ChatGPT. Version 5.4.0 merges the message queue back into the newer floating/draggable control UI.

## What changed in 5.4.0

- The floating `+` is again the **custom message queue** button. It no longer proxies ChatGPT's native file-attachment `+`.
- The `+` and `⇧` controls keep the newer **drag-to-any-position** behavior; their saved position is restored from localStorage.
- The queue panel moves together with the draggable controls because it is hosted by the same floating UI.
- Restored queue features:
  - multiple queued prompts;
  - automatic send of the first queued prompt after the current ChatGPT answer finishes;
  - `▶` manual send of any queued item without pressing Stop;
  - `Отправить всё одним сообщением`;
  - `В очередь`;
  - `Из чата → очередь` (moves all text from the normal ChatGPT composer into the queue, then clears the normal composer);
  - reorder with `↑` / `↓` and drag-and-drop by `☰`;
  - delete queued items with `×`.
- The native ChatGPT attachment button remains native and can still be used for file selection. `⇧` only controls the existing file auto-send logic.
- Version `v5.4.0` is visible above the floating controls and in the queue panel.

## Install

Install `chatgpt-tab-notifier.user.js` in Tampermonkey.

## Development

```bash
npm test
npm run build
npm run verify
```

The installable userscript is generated from `src/**` by `build-userscript.mjs`.

## Fortis Textbox — Stage 1A (source implementation)

The existing plus-panel textarea now has **«Сохранить и отправить»** alongside the legacy queue buttons. This path generates a distinct per-user-message `task_<32 hex>` via the built-in `TaskIdBehavior`, stores **the original text separately** from the augmented ChatGPT prompt, and sends through the existing native composer/Send controller. It does not replace the old queue or delayed-send behavior.

Records are stored in **Tampermonkey GM storage** under independent `fortis-local-user-message-v1-<task_id>` keys and include conversation ID, original/submitted text, send state, and `archive_status: pending_activity`. The history initially shows 20 newest records for the current `/c/...` chat and offers «Показать ещё 20» to inspect every older record without deleting it. A separate count shows entries still awaiting the owner archive. Records remain in GM storage without automatic expiry. A stable chat ID is required; this button does not create a record for the New Chat landing page.

The native-send status is kept separate from the Observatory archive state. If sending was attempted but could not be reliably confirmed, the local record stays `send_unconfirmed` and is **never retried automatically**. A confirmed native Send produces `send_status: sent`, not `archived`. If GM storage cannot save/read back a new record, the new send is refused. Browser profile deletion, storage limits, or device failure can still remove local records; this is not an encrypted external backup.

**Not implemented in 1A:** accepted per-task Observatory activity receipts, owner-private message archive, 10–15-second inactivity notifications, full AI message persistence, and task-type/module selection UI. These are subsequent Stage 1B/1C, Stage 2 and Stage 3 tasks. Source verification does not imply Windows/Tampermonkey deployment. Review privacy and user permissions before applying an updated userscript.

## Fortis Textbox — Stage 1B (source implementation, not installed)

The paired Notifier now records the `reporting_session_id` in **new** locally
saved user messages, at the moment the user presses «Сохранить и отправить».
After a confirmed/uncertain native Send it checks the **read-only**, per-task
`/api/task-activity` Observatory route using its existing per-session observer
key. It never sends the original user text in this GET request. A response
is accepted only when the message's `task_id`, `conversation_id`, session ID,
source and accepted timestamp match. It can recover a previously accepted
signal after browser reload or Observatory reconnection. The HTTP API is
source-only; the installed Windows owner server must be separately upgraded
and authorized before this can work in a real browser.

A successful receipt updates `activity_status: accepted`, `first_activity_at`
and `first_activity_event`; the visible label is **«Сигнал принят; ожидает
архивирования»**. The message remains locally stored with
`archive_status: pending_activity` until a *later* authorized Stage 1C
owner-private writer confirms archive read-back. `started` is not required;
work events and message markers can both be the first accepted signal.
This is sender-claimed telemetry, not proof the AI actually read or performed
work. A record created without a pairing session stays locally unbound and
is not silently attached to a session paired later. No text is written to
Repo inbox or to the owner archive by Stage 1B, and no owner bearer token is
exposed to Tampermonkey. A soft ~15s inactivity warning and AI text capture
are subsequent work, not features of Stage 1B.

## Fortis Textbox — Stage 1C (owner-private archive, source-only)

An independently scoped `message_writer_key` is required in the paired
Observatory session. The owner explicitly chooses **«Код с правом записи
сообщений»** in the private Observatory panel, then re-pairs that code in the
Notifier menu; the existing read-only pairing does **not** grant writes.
No owner bearer is stored in Tampermonkey or sent with chat prompts.

After the Stage 1B accepted-signal receipt, the Notifier sends the **original**
text (not augmented prompt) to the owner server's `/api/user-messages` via
GM_xmlhttpRequest. Only task ID, conversation/session IDs and original text
are in that POST; no event inbox, Git repository, or URL query transports the
body. The server verifies the first **accepted** signal and writes one
immutable JSON-escaped Markdown user-message record in its owner-private
archive. Retries with identical text return the existing receipt. The Notifier
validates owner receipt identifiers and SHA-256 of the original before marking
`archive_status: archived`; until then it remains pending and retries after
reconnection. Maximum original text is 64 KiB UTF-8; larger messages stay
local with archive pending. Old messages created without a session pairing
are NOT silently registered later.

**Deployment status:** Notifier and Observatory changes remain in source
workspaces. Windows owner V1 and actual Tampermonkey profile were not changed
or browser-tested. Owner ACL/guest negative security testing, owner deployment
and capability handling are separate acceptance gates. The 10–15 second
warning, AI-origin full reply archive, and task-profile selection are not part
of this stage.

## Fortis Textbox — Stage 1 UX: мягкое ожидание активности (source only)

При отправке через «Сохранить и отправить» локальная история показывает
состояние **конкретного сообщения**, не делает вывод о выполнении модели.
Если native Send подтверждён, прошло не менее 15 секунд и read-only
`/api/task-activity` недавно подтвердил доступность Observatory **без
принятого сигнала по task_id**, строка получает мягкий текст:
«Пока нет подтверждения активности Observatory (более 15 секунд)».
Это **inline-индикация**, не desktop notification, не таймер ограничения AI
и не свидетельство того, что ChatGPT не получил пользовательский запрос.
При `activity_status=accepted` предупреждение прекращается; при offline,
отвергнутой/отсутствующей pairing или непроверенном соединении сообщается
**состояние связи**, а не ошибочное «AI не работает». Черновик, неотправленное
и `send_unconfirmed` не получают 15-секундную тревогу. Перерисовка UI
происходит по обычному циклу и может задерживаться в фоновой вкладке.
История текущего чата показывает сначала 20 сообщений и счётчик всех записей
и ещё не архивированных; кнопка «Показать ещё 20» открывает старые записи.
При ошибке перечисления локального хранилища UI не притворяется, что
записей нет; сообщения не удаляются автоматически по сроку. Важно: GM storage не резервное копирование,
при ручной очистке профиля, quota failure или потере диска текст может исчезнуть.

Синтетический CLI test 19.10.2026 подтвердил `emit.py` STAGED_ONLY →
owner `poll()` accepted → `task_activity` found → owner archive read-back
в изолированном временном каталоге. **Настоящая возможность ChatGPT вызвать
этот sender и работающая owner Windows установка не проверялись.**
Серверная предварительная регистрация ожидаемого Notifier task_id ещё не
реализована и остаётся архитектурной развилкой v5. Не подменять этот факт
словом «сервер доказал получение запроса».


## Fortis Textbox — Stage 1UX: full local history pagination (source-only)

Local history is no longer truncated to five records in the UI. The panel
shows the **first 20** records for this Chat ID and a count of all local
records / records not yet confirmed archived. «Показать ещё 20» exposes the
rest incrementally, without deleting or syncing them. A failed GM storage
enumeration is shown as a storage access error, **not** as a healthy empty
history. No automatic TTL or removal was added. This does not prevent loss
through browser profile deletion, storage quota or disk failure, and the
Windows/real-browser deployment and actual AI-emitter route are not validated.

The pending Task ID trust decision (pre-register ID without user text vs
sender_claim-only acknowledgement) remains **CANDIDATE**. No new owner writer
permission or registration API is added as part of this UI work.


## 21.10.2026 — Offline current-chat outbox, source 5.7.27

Prepared in /workspace/repo/fortis-offline-outbox-20261021/work.
Notifier always supplies current conversation_id + new task_id on prepared
insert/file/Send routes, even without browser pairing. With pairing the exact
registered session check remains mandatory; an explicitly wrong session does
not downgrade to the unbound queue. No IDs from earlier requests are reused.

repo_task.py without --session durably stages events and full assistant
interim/final separately under the private Repo volume inbox/pending-context.
HTTP Observatory, Windows Viewer, observer/writer keys and browser pairing
are not prerequisites for staging. Normal bound offline sender is retained.
STAGED_ONLY proves queue staging, never acceptance, DOM display or delivery.

The new collector forwards after exactly one locally registered Repo session
matches the supplied current conversation_id; no registration is created.
Ambiguous/absent registrations wait with payload preserved, no automatic
failed. Binding is pinned before forwarding and never changes on retries.
Stable event/message IDs use the existing archive duplicate checks.
Corrupt/oversized/linked entries are retained/refused without body logs.
Bounds: 512 records per action, 350 KiB serialized envelope; original body
limit 256 KiB, event detail 8 KiB; safe metadata checks remain in force.

No user originals are reconstructed or migrated. Browser originals, archive
activity gate, approval scopes, owner/observer access and manual Send are
unchanged. Existing unpaired browser records stay unpaired. Without a valid
current chat/task or accessible Repo, instructions require continuing the
user task without inventing IDs or claiming data was saved.

Deployment and browser installation are recorded separately in CURRENT_STATE.


## 22.10.2026 — Названия вкладок в найденных и подключённых сессиях (SOURCE READY)

Notifier source 5.7.28 передаёт ограниченное очищенное natural title
только после supports_tab_titles=true от Windows Viewer. Старый Viewer
получает прежний chat/proof запрос; при downgrade и отказе optional поля
Notifier возвращается к прежнему payload на очередном heartbeat.
Служебные favicon/title значки и Observatory connection prefixes удаляются
существующим cleanTitle. Контрольные/bidi символы и unpaired surrogates
исключаются, предел 128 Unicode codepoints / 512 UTF-8 bytes.
Ни body сообщений, ни DOM беседы, ни task/original тексты не читаются.

Windows enrollment принимает необязательный title в том же localhost
endpoint (body <=1024), legacy payload поддержан. Названия живут только
в owner RAM с TTL 180 сек, не записываются в approved-notifiers.json,
Docker archive, event summaries или shared файлы. В discovered список
название передаётся owner bearer API; connected session_titles доступны
только для точно одобренного chat+proof. Чужой proof не переименовывает
подключённую сессию. При неоднозначных claimant с разными названиями
название не выбирается случайно. Права и identity всегда определяются ID.

В карточках найденных чатов название — основная ссылка, Chat ID — мелкая
подпись. В списке подключённых сессий и адресате текстбокса используется
свежее название из этой же одобренной вкладки; fallback — архивное
название/ID. Rename приходит с очередным heartbeat/poll. Старые архивные
названия не переписываются. Выбранные task/session и ручной Send сохранены.

Изолированная копия: /workspace/repo/fortis-tab-titles-20261022/work.
Viewer SHA-256: 34558e098d27139dcec95333bb4f8b51907e03820a902207e47b07d2e87aead6
Enrollment SHA-256: 51ce3eb96fd3da285c591c063cb71642863b825d5fef63bc6c5060a814ca03e3
Notifier 5.7.28 SHA-256: d506f6d7824ac1fcf868290da44f9f2e991acd42514fac31bdb6060fbedc99c5
Требуется ручное обновление Viewer и одной существующей копии Notifier.
Рекомендуемый порядок: Viewer, затем Notifier и reload вкладок.
Старые команды с SHA предыдущего Viewer/Enrollment к новой source не подходят.
Windows установленную копию, pairing/GM originals и live backend PID 15984
не изменяли/не перезапускали. Новый Edge live QA ещё не выполнен.



## 22.10.2026 — versioned Local Loader target 5.7.28

Prepared byte-identical chatgpt-tab-notifier-5.7.28.user.js alongside the
current generated bundle. SHA-256:
d506f6d7824ac1fcf868290da44f9f2e991acd42514fac31bdb6060fbedc99c5
Use the EXISTING Local Loader, preserve @name/@namespace/GM storage,
change its @version to 5.7.28 and @require to:
file:///C:/Users/alexa/Repos/tabnotifier-fileautosend-autochat/chatgpt-tab-notifier-5.7.28.user.js
Keep GM_listValues grant. A fresh require URL selects the exact reviewed
bundle. No second enabled Notifier, no GM cleanup, no runtime restart by
this preparation. Actual browser installation/version remains unverified.

## 24.10.2026 — Notifier 5.7.32: полный файл для Fortis Textbox и Observatory

Пользователь попросил поддерживать актуальный **основной локальный файл**,
загружаемый Tampermonkey Local Loader. Source + bundle обновлены в
`C:\Users\alexa\Repos\tabnotifier-fileautosend-autochat`:

- `chatgpt-tab-notifier.user.js` = 5.7.32 (основной стабильный путь);
- `chatgpt-tab-notifier-5.7.32.user.js` = побайтовая копия основной сборки;
- `chatgpt-tab-notifier-5.7.31.user.js` не изменён, SHA-256
  `482056d051bb5555cb2eeab47d32c8e08f0ce91974b455b79ce8e03d8d23bbf8`.
- 287/287 JS tests PASS, `npm run build:check` PASS на основной рабочей папке.

В режиме File точный исходник, полный Fortis task context с единственным task_id
и весь выбранный Prompt + Modules от Planning Helper находятся в TXT. В native
ChatGPT composer помещается только короткий task-bound указатель на файл.
Viewer «Файл» готовит файл без Send; Viewer «Отправить» после подтверждения
карточки и точного task_id выполняет только одну попытку штатного Send.
Старые оригиналы/GM storage и рабочий Docker/Viewer не менялись.

**Важно про фактический Local Loader.** В документации от 22.10 Loader использует
`@require .../chatgpt-tab-notifier-5.7.31.user.js`; менять immutable файл
старой версии ради обновления нельзя. Если действующий Loader всё ещё указывает
на 5.7.31, один раз поменяйте в **существующем** Tampermonkey скрипте только:

```javascript
// @version      5.7.32
// @require      file:///C:/Users/alexa/Repos/tabnotifier-fileautosend-autochat/chatgpt-tab-notifier.user.js
```

Сохраните прежние `@name`, `@namespace`, `@match`, все `@grant`, `@connect`,
GM-хранилище и настройки. **Не устанавливайте второй Loader.** Дайте расширению
доступ к `file://`, сохраните, затем обновите конкретную вкладку ChatGPT.
Если текущий Loader уже указывает на `chatgpt-tab-notifier.user.js`, не меняйте
его: достаточно обновить страницу/внешний ресурс по механизму Tampermonkey.
В последующих релизах этот стабильный путь позволит менять сам локальный файл,
не переписывая `@require` на каждую новую версию.

Сама фактическая конфигурация текущего Tampermonkey Loader и реальный Edge
smoke пока НЕ ПРОВЕРЕНЫ (Loader находится в базе расширения, а не в Repo).
Полная схема и проверка: `candidates/full-file-5.7.32/README.md`.
Source backup до изменения: `/workspace/repo/fortis-notifier-pre-full-file-5.7.32-20261024`.
Основной и версионный SHA-256: `a4626ae6d53570a0c6a14d8c058a3ceee233a76159804bfce97d65058331f718`.
