import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { clampFloatingPosition, floatingWidth, canStartFloatingDrag,
  shouldSendQuickTextboxKey, createLargePasteDraft, LARGE_PASTE_THRESHOLD,
  MAX_QUICK_SEND_BYTES, MAX_FILE_PROMPT_BYTES,
  createPromptTextFile, attachPromptTextFile,
  dropPromptTextFile, fileAttachmentVisible, safeNotifierFileDetail,
  createConsecutiveFileHashGuard, attemptPromptFileOnce,
  tryPromptFileInputOnce, createUploadButtonUi } = require('../src/upload-button-ui.js');

function source() {
  return fs.readFileSync(fileURLToPath(new URL('../src/upload-button-ui.js', import.meta.url)), 'utf8');
}

test('Notifier startup constructs upload UI with addressable dispatcher without ReferenceError', async () => {
  const ui = createUploadButtonUi({
    tabState:{}, uploadController:{}, queuedPromptController:{},
    delayedSendController:{}, persistentMessageController:{},
    taskActivityMonitor:{}, textboxProfileManager:null
  });
  assert.equal(typeof ui.render,'function');
  assert.equal(typeof ui.dispatchQuickAction,'function');
  assert.deepEqual(await ui.dispatchQuickAction('invalid','','not-array'),{ok:false});
  const implementation = source();
  assert.match(implementation,/async function dispatchQuickAction\(mode,text,moduleIds=null,profileId=null,delayMs=1000\)/);
  assert.match(implementation,/dispatchQuickAction[\s\S]*?ensureUi\(\);[\s\S]*?return handleQuickDispatch\(mode,text,moduleIds,profileId,delayMs\)/,
    'public method must call the populated UI dispatcher, not retain an old noop');
  assert.match(implementation,/handleQuickDispatch = async function executeQuickDispatch\(/,
    'File, Insert and Send handlers must actually populate exported dispatcher');
});

test('floating controls stay inside viewport bounds', () => {
  assert.deepEqual(clampFloatingPosition({ left: -100, top: -50 }, 1000, 800), { left: 6, top: 6 });
  assert.deepEqual(clampFloatingPosition({ left: 9999, top: 9999 }, 1000, 800), { left: 572, top: 706 });
});

test('all controls and right textbox remain inside a narrow viewport', () => {
  assert.equal(floatingWidth(1000), 422);
  assert.equal(floatingWidth(260), 248);
  assert.deepEqual(clampFloatingPosition({ left: 500, top: 700 }, 260, 300), {
    left: 6, top: 206
  });
});

test('only the original buttons and textbox grip start a group drag', () => {
  for (const selector of ['.control', '.quick-grip']) {
    assert.equal(canStartFloatingDrag({
      closest: expression => expression.includes(selector) ? {} : null
    }), true);
  }
  for (const selector of ['.quick-input', '.quick-send', '.panel']) {
    assert.equal(canStartFloatingDrag({
      closest: expression => expression.includes(selector) ? {} : null
    }), false);
  }
  assert.equal(canStartFloatingDrag(null), false);
});

test('right-hand textbox is always visible and does not replace the old three buttons', () => {
  const text = source();
  for (const role of ['delay-send', 'queue', 'auto-send']) {
    assert.match(text, new RegExp('class="control" data-role="' + role + '"'));
  }
  assert.match(text, /class="quick-compose" role="group"/);
  assert.match(text, /class="quick-grip"/);
  assert.match(text, /class="quick-input" rows="2"/);
  assert.match(text, /class="quick-send"/);
  const oldButtons = text.indexOf('data-role="auto-send" aria-label=');
  const newTextbox = text.indexOf('class="quick-compose" role="group"');
  assert.ok(newTextbox > oldButtons, 'textbox must be to the right of three buttons');
  assert.match(text, /class="panel" hidden/);
  assert.match(text, /class="queue-input"/);
  assert.match(text, /!canStartFloatingDrag\(event\.target\)/);
});

test('quick textbox uses explicit prepared Send; old queue and delayed buttons keep handlers', () => {
  const text = source();
  assert.match(text, /function sendQuickCurrent\(originalOverride = null, moduleIds = null, profileId = null\)[\s\S]*?persistentMessageController\?\.saveAndSend\(originalText,options\)/);
  assert.match(text, /originalOverride === null[\s\S]*?largePaste\.text\(ui\.quickInput\.value\)/);
  assert.match(text, /ui\.quickSend\.addEventListener\('click',\(\)=>\{/);
  assert.match(text, /const result=sendPreparedNative\(\)/);
  assert.doesNotMatch(text, /ui\.quickInput\.addEventListener\('keydown',[\s\S]*?sendQuickCurrent\(\)/);
  assert.match(text, /if \(!id\) return \{ok:false\};[\s\S]*?ui\.quickInput\.value = ''/);
  assert.match(text, /ui\.queueButton\.addEventListener\('click'/);
  assert.match(text, /ui\.delayButton\.addEventListener\('click'/);
  assert.match(text, /ui\.autoButton\.addEventListener\('click'/);
  assert.match(text, /delayedSendController\?\.toggleCheckpoint\?\.\(\)/);
  assert.match(text, /uploadController\.toggle\(\)/);
  assert.match(text, /ui\.add\.addEventListener\('click', addCurrent\)/);
  assert.match(text, /ui\.scheduleLater\.addEventListener\('click', scheduleCurrent\)/);
});

test('Enter sends right textbox; Shift+Enter writes a line; IME repeats never send', () => {
  assert.equal(shouldSendQuickTextboxKey({ key: 'Enter' }), true);
  assert.equal(shouldSendQuickTextboxKey({ key: 'Enter', ctrlKey: true }), true);
  assert.equal(shouldSendQuickTextboxKey({ key: 'Enter', metaKey: true }), true);
  assert.equal(shouldSendQuickTextboxKey({ key: 'Enter', shiftKey: true }), false);
  assert.equal(shouldSendQuickTextboxKey({ key: 'Enter', altKey: true }), false);
  assert.equal(shouldSendQuickTextboxKey({ key: 'Enter', isComposing: true }), false);
  assert.equal(shouldSendQuickTextboxKey({ key: 'Enter', keyCode: 229 }), false);
  assert.equal(shouldSendQuickTextboxKey({ key: 'Enter', repeat: true }), false);
  assert.equal(shouldSendQuickTextboxKey({ key: 'A' }), false);
  assert.equal(shouldSendQuickTextboxKey(null), false);
});

test('floating controls preserve valid user position', () => {
  assert.deepEqual(clampFloatingPosition({ left: 123, top: 456 }, 1000, 800), { left: 123, top: 456 });
});

test('queue UI keeps open Shadow DOM for ChatGPT focus compatibility', () => {
  const text = source();
  assert.match(text, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.doesNotMatch(text, /attachShadow\(\{ mode: 'closed' \}\)/);
});

test('floating UI keeps checkpoint clock and compact timer chip', () => {
  const text = source();
  assert.match(text, /data-role="delay-send"/);
  assert.match(text, /class="meta-chip timer-chip"/);
  assert.match(text, /Чекпоинт по таймеру/);
  assert.match(text, /toggleCheckpoint/);
});

test('checkpoint has a dedicated text field separate from the normal plus-panel composer', () => {
  const text = source();
  assert.match(text, /class="checkpoint-input"/);
  assert.match(text, /Фиксированный текст чекпоинта/);
  assert.match(text, /class="queue-input"/);
  assert.match(text, /setCheckpointText/);
});

test('plus-panel composer can add text to a distinct delayed-message list', () => {
  const text = source();
  assert.match(text, /class="schedule-later"[^>]*>Отправить позже</);
  assert.match(text, /class="delayed-list"/);
  assert.match(text, /Отправятся позже/);
  assert.match(text, /addScheduled\?\.\(ui\.textarea\.value\)/);
  assert.match(text, /removeScheduled/);
});

test('delayed-send settings include manual minute entry shared by checkpoint and delayed list', () => {
  const text = source();
  assert.match(text, /class="delay-minutes"/);
  assert.match(text, /Свои минуты/);
  assert.match(text, /setDelayMinutes/);
  assert.match(text, /и для чекпоинта ◷, и для кнопки «Отправить позже»/);
});

test('checkpoint button renders active state immediately after toggle', () => {
  const text = source();
  assert.match(
    text,
    /ui\.delayButton\.addEventListener\('click',[\s\S]*?delayedSendController\?\.toggleCheckpoint\?\.\(\);[\s\S]*?render\(\);/
  );
});

test('large prompt paste is held whole outside the visible textarea', () => {
  const draft = createLargePasteDraft();
  const content = 'Подробный промпт 📝\\n'.repeat(15000);
  assert.equal(draft.active(), false);
  assert.equal(draft.capture(content, '', 0, 0), true);
  assert.equal(draft.active(), true);
  assert.equal(draft.text('wrong preview'), content, 'must return EXACT original');
  assert.equal(draft.preview().length < 700, true, 'preview must be bounded');
  assert.equal(draft.preview().includes('15000'), false, 'preview is NOT the full text');
  assert.equal(draft.capture('ignored overwrite', '', 0, 0), false);
  assert.equal(draft.text(''), content);
  draft.clear();
  assert.equal(draft.active(), false);
  assert.equal(draft.text('regular input'), 'regular input');
});

test('long prompt pasted in the middle preserves prefix, suffix, selection and Unicode', () => {
  const draft = createLargePasteDraft();
  const large = '🪐\\r\\n'.repeat(6000);
  assert.equal(draft.capture(large, 'до  после', 3, 3), true);
  assert.equal(draft.text(''), 'до ' + large + ' после');
});

test('normal short paste is left to the browser without interception', () => {
  const draft = createLargePasteDraft();
  assert.equal(draft.capture('обычное сообщение', '', 0, 0), false);
  assert.equal(draft.active(), false);
  assert.equal(draft.capture('txt'.repeat(3000), '', 0, 0), false);
  assert.equal(draft.capture('large'.repeat(4000), '', 0, 0), true);
  assert.equal(LARGE_PASTE_THRESHOLD, 12000);
  assert.equal(MAX_QUICK_SEND_BYTES, 512 * 1024);
});

test('closed local-history panel skips costly full GM record reads', () => {
  const src=source();
  assert.match(src, /function renderPersistedList\(ui\) \{[\s\S]*?if \(ui\.panel\.hidden \|\| !ui\.persistedList \|\| !ui\.persistedStatus\) return;/);
  assert.match(src, /function renderQueueList\(ui\) \{\s*if \(ui\.panel\.hidden\) return;/);
  assert.match(src, /function renderDelayedList\(ui\) \{\s*if \(ui\.panel\.hidden\) return;/);
  assert.match(src, /quickInput\.addEventListener\('paste',[\s\S]*?event\.preventDefault\(\);/);
  assert.match(src, /quickCopy\.addEventListener\('click'/);
  assert.match(src, /quickExpand\.addEventListener\('click'/);
  assert.match(src, /quickInput\.readOnly = true/);
  assert.match(src, /MAX_QUICK_SEND_BYTES/);
  assert.match(src, /function resetLargePasteDraft\(\)/);
});

test('client-side navigation resets a large prompt instead of sending it into a different chat', () => {
  const source=fs.readFileSync(fileURLToPath(new URL('../src/runtime.js', import.meta.url)), 'utf8');
  assert.match(source, /resetForNavigation\(\)[\s\S]*?uploadUi\.resetLargePasteDraft\?\.\(\)/);
});

test('file transfer preserves the exact long Unicode prompt including whitespace', () => {
  class FakeFile {
    constructor(chunks,name,options){
      this.content=chunks.join('');this.name=name;this.type=options.type;
      this.size=Buffer.byteLength(this.content,'utf8');
    }
  }
  const original='\\n  Большой текст 🪐\\n' + 'длинный блок ✨\\n'.repeat(6000) + '  конец\\n';
  assert.ok(Buffer.byteLength(original,'utf8')>65536);
  const file=createPromptTextFile(original,'fortis-prompt-test.txt',FakeFile);
  assert.equal(file.name,'fortis-prompt-test.txt');
  assert.equal(file.type,'text/plain;charset=utf-8');
  assert.equal(file.content,original,'text must not be trimmed, compressed or rewritten');
  assert.equal(file.size,Buffer.byteLength(original,'utf8'));
});

test('file transfer refuses empty prompts, size overflow and invalid names', () => {
  class FakeFile {
    constructor(chunks,name){this.content=chunks.join('');this.name=name;
      this.size=Buffer.byteLength(this.content,'utf8')}
  }
  assert.throws(()=>createPromptTextFile('  ',undefined,FakeFile));
  assert.throws(()=>createPromptTextFile('x'.repeat(MAX_FILE_PROMPT_BYTES+1),undefined,FakeFile));
  assert.equal(createPromptTextFile('hello','../../unsafe.js',FakeFile).name,'fortis-prompt.txt');
  assert.equal(MAX_FILE_PROMPT_BYTES,4*1024*1024);
});

test('synthetic native file-input selection dispatches change but never clicks Send', () => {
  class FakeDataTransfer {
    constructor(){this.files=[];this.items={add:file=>{this.files.push(file)}}}
  }
  class FakeEvent {
    constructor(type,opts){this.type=type;this.bubbles=opts.bubbles}
  }
  const file={name:'fortis-prompt-test.txt',size:89000};
  const calls=[];
  const input={
    type:'file',accept:'.txt,application/pdf',files:[],disabled:false,isConnected:true,
    dispatchEvent(event){calls.push(event);return true}
  };
  assert.equal(attachPromptTextFile(input,file,{
    DataTransferClass:FakeDataTransfer,EventClass:FakeEvent
  }),true);
  assert.equal(input.files[0],file);
  assert.deepEqual(calls.map(x=>x.type),['change']);
  assert.equal(calls[0].bubbles,true);
  assert.equal(attachPromptTextFile(input,file,{
    DataTransferClass:FakeDataTransfer,EventClass:FakeEvent
  }),true,'repeated picker selection must not be blocked by previous files');
  assert.equal(input.files.length,1,'old files are never silently resubmitted');
});

test('file mode refuses photo-only inputs, disabled picker, and unknown DataTransfer', () => {
  class FakeDataTransfer {
    constructor(){this.files=[];this.items={add:file=>this.files.push(file)}}
  }
  class FakeEvent { constructor(type){this.type=type} }
  const file={name:'fortis-prompt.txt',size:5};
  const mk=(accept)=>({
    type:'file',accept,disabled:false,isConnected:true,files:[],
    dispatchEvent(){throw Error('should never be called')}
  });
  for(const accept of ['image/*','.png,.jpg','image/jpeg']){
    assert.equal(attachPromptTextFile(mk(accept),file,{
      DataTransferClass:FakeDataTransfer,EventClass:FakeEvent
    }),false);
  }
  const disabled=mk('.txt'); disabled.disabled=true;
  assert.equal(attachPromptTextFile(disabled,file,{
    DataTransferClass:FakeDataTransfer,EventClass:FakeEvent
  }),false);
  assert.equal(attachPromptTextFile(mk('.txt'),file,{
    DataTransferClass:null,EventClass:FakeEvent
  }),false);
});

test('file button is above regular ➤ and attempts direct attachment without download or Send',()=>{
  const text=source();
  assert.match(text,/class="quick-actions"/);
  const toolbar=text.match(/<div class="quick-actions">([\s\S]*?)<\/div>/);
  assert.ok(toolbar);
  assert.ok(toolbar[1].indexOf('class="quick-file"')<toolbar[1].indexOf('class="quick-send"'));
  const fileAction=text.match(/async function handleQuickFile\([\s\S]*?(?=\n      async function handleQuickInsert)/);
  assert.ok(fileAction);
  assert.match(fileAction[0],/tryFileInputs\(/);
  assert.match(fileAction[0],/dropPromptTextFile\(/);
  assert.match(fileAction[0],/waitForFileCard\(/);
  assert.doesNotMatch(fileAction[0],/downloadPromptFile|createObjectURL|\.download|saveAndSend|sendNow|clickCurrentSend/);
  assert.match(fileAction[0],/isArmed\?\.\(\)/);
  assert.match(text,/cancelFileTransfer\(\)/);
});

test('a drag/drop attempt carries only the original file and never a Send click',()=>{
  class FakeTransfer {
    constructor(){this.files=[];this.items={add:file=>this.files.push(file)}}
  }
  class FakeDragEvent {
    constructor(type,options){
      this.type=type;this.bubbles=options.bubbles;
      this.dataTransfer=options.dataTransfer;this.cancelable=options.cancelable
    }
  }
  const file={name:'fortis-prompt-001.txt',size:72000,contents:'🌐'};
  const events=[];
  const composer={isConnected:true,dispatchEvent(event){events.push(event);return true}};
  assert.equal(dropPromptTextFile(composer,file,{
    DataTransferClass:FakeTransfer,DragEventClass:FakeDragEvent
  }),true);
  assert.deepEqual(events.map(e=>e.type),['dragenter','dragover','drop']);
  assert.ok(events.every(e=>e.dataTransfer.files[0]===file));
  assert.ok(events.every(e=>e.bubbles));
});

test('a synthetic input assignment is not evidence that ChatGPT attached the file',()=>{
  const filename='fortis-prompt-test.txt';
  const fileInput={
    matches(selector){return selector==='input[type="file"]'},
    textContent:filename,
    getAttribute(){return null}
  };
  const container={
    textContent:'Текст вопроса без карточки',
    querySelectorAll(){return [fileInput]},
    getAttribute(){return null},
    matches(){return false}
  };
  assert.equal(fileAttachmentVisible(container,filename),false);
  const card={
    textContent:filename,
    getAttribute(key){return key==='data-testid'?'composer-file-attachment':null},
    matches(){return false}
  };
  container.querySelectorAll=()=>[fileInput,card];
  assert.equal(fileAttachmentVisible(container,filename),true);
});

test('Fortis Textbox insert-only button is above Send and never calls the send controller',()=>{
  const js=source();
  const toolbar=js.match(/<div class="quick-actions">([\s\S]*?)<\/div>/);
  assert.ok(toolbar);
  assert.ok(toolbar[1].indexOf('class="quick-insert"')<toolbar[1].indexOf('class="quick-send"'));
  const action=js.match(/async function handleQuickInsert\([\s\S]*?(?=\n      function sendQuickCurrent)/);
  assert.ok(action);
  assert.match(action[0],/prepareActiveModules\(original,moduleIds,profileId\)/);
  assert.match(action[0],/persistentMessageController\.prepareDraft\(original/);
  assert.match(action[0],/queuedPromptController\.insertOnly\(record\.submitted_text\)/);
  assert.doesNotMatch(action[0],/saveAndSend|\.sendNow\(|\.sendButton\.click\(|clickCurrentSend/);
  assert.match(action[0],/return handleQuickFile\(original,moduleIds,profileId\)/,
    'large insert may click only file-preparation action, never native Send');
});

test('filename in typed composer text or generic status is not an attachment',()=>{
  const filename='fortis-prompt-209.txt';
  const typed={textContent:'Please inspect '+filename,
    getAttribute(){return null},matches(){return false}};
  const status={textContent:filename,
    getAttribute(key){return key==='data-testid'?'status-label':null},
    matches(){return false}};
  const plain={textContent:typed.textContent,querySelectorAll(){return []}};
  assert.equal(fileAttachmentVisible(plain,filename),false);
  plain.querySelectorAll=()=>[typed,status];
  assert.equal(fileAttachmentVisible(plain,filename),false);
  assert.equal(fileAttachmentVisible({textContent:filename,querySelectorAll(){return []}},filename),false);
});

test('file card marker is required, and busy/failed card never confirms upload',()=>{
  const filename='fortis-prompt-test.txt';
  function node(testid,state,body=filename) {
    return {textContent:body,matches(){return false},
      getAttribute(key){return key==='data-testid'?testid:
        key==='data-state'?state:null}};
  }
  let children=[];
  const parent={querySelectorAll(){return children}};
  children=[node('composer-file-attachment','uploading')];
  assert.equal(fileAttachmentVisible(parent,filename),false);
  children=[node('composer-file-attachment','error')];
  assert.equal(fileAttachmentVisible(parent,filename),false);
  children=[node('composer-file-attachment','ready','other.txt')];
  assert.equal(fileAttachmentVisible(parent,filename),false);
  children=[node('composer-file-attachment','ready')];
  assert.equal(fileAttachmentVisible(parent,filename),true);
});

test('attachment wrapper containing native text editor is not a file preview',()=>{
  const filename='fortis-prompt-demo.txt';
  const wrapper={textContent:'My user prompt mentioning '+filename,
    getAttribute(key){return key==='data-testid'?'composer-attachment-list':null},
    matches(){return false},
    querySelector(selector){return selector.includes('contenteditable')?{}:null}};
  const container={querySelectorAll(){return [wrapper]}};
  assert.equal(fileAttachmentVisible(container,filename),false);
});

test('both manual draft paths use current profile and never trigger Send',()=>{
  const js=source();
  assert.match(js,/function prepareActiveModules\(originalText, moduleIds = null, profileId = null\)/);
  assert.match(js,/textboxProfileManager\.prepare\(originalText\)/);
  assert.match(js,/mode:'file',fileName,extraText:profile\.extraText,nativePrefix:nativeBefore/);
  assert.match(js,/createPromptTextFile\(record\.file_text,fileName\)/);
  assert.match(js,/await completeFileDraft\(record, file, chatId, epoch, nativeBefore\)/);
  assert.match(js,/mode: 'insert', extraText: profile\.extraText/);
  assert.match(js,/await queuedPromptController\.insertOnly\(record\.submitted_text\)/);
  const block=js.slice(js.indexOf('async function completeFileDraft('),
    js.indexOf('function sendQuickCurrent(originalOverride'));
  assert.doesNotMatch(block,/\.saveAndSend\(|\.sendNow\(|clickCurrentSend/);
  assert.match(block,/original\.length >= LARGE_PASTE_THRESHOLD/);
});

test('file SHA-256 guard blocks consecutive identical originals per chat, even after reload',async()=>{
  const {webcrypto}=await import('node:crypto');
  const db=new Map();
  const getValue=(k,def)=>db.get(k)??def, setValue=(k,v)=>db.set(k,v);
  const guard=createConsecutiveFileHashGuard({getValue,setValue,cryptoSource:webcrypto});
  const text='Проверка  A  B\n\nСтрока 🌍 ';
  const chatA='aaaa-12345678', chatB='bbbb-12345678';
  const one=await guard.reserve(chatA,text);
  assert.equal(one.ok,true);
  assert.match(one.sha256,/^[0-9a-f]{64}$/);
  const clone=createConsecutiveFileHashGuard({getValue,setValue,cryptoSource:webcrypto});
  const repeat=await clone.reserve(chatA,text);
  assert.equal(repeat.ok,false);
  assert.equal(repeat.duplicate,true);
  assert.equal((await clone.reserve(chatB,text)).ok,true,'same hash in distinct chat permitted');
  assert.equal((await clone.reserve(chatA,text+'x')).ok,true,'changed source permitted');
  assert.equal((await clone.reserve(chatA,text)).ok,true,
    'original after a different hash is no longer a consecutive repeat');
  assert.equal((await clone.reserve(chatA,text)).duplicate,true);
  assert.equal(db.size,2,'only one last digest is stored per chat');
  const stored=JSON.stringify([...db.values()]);
  assert.doesNotMatch(stored,/Проверка|Строка|🌍/);
  assert.match(stored,/sha256/);
});

test('hash guard preserves whitespace, rejects corrupt storage and fails closed without crypto',async()=>{
  const {webcrypto}=await import('node:crypto');
  const db=new Map(),chat='hash-12345678';
  const mk=storage=>createConsecutiveFileHashGuard({
    getValue:(k,def)=>storage.get(k)??def,setValue:(k,v)=>storage.set(k,v),
    cryptoSource:webcrypto
  });
  assert.equal((await mk(db).reserve(chat,'A  B')).ok,true);
  assert.equal((await mk(db).reserve(chat,'A B')).ok,true,
    'SHA covers byte-exact whitespace and must differ');
  assert.equal((await mk(db).reserve(chat,'A B')).duplicate,true);
  db.set('fortis-file-last-sha256-v1-'+chat,'CORRUPTED');
  assert.equal((await mk(db).reserve(chat,'new')).ok,false,'invalid digest cannot be ignored');
  assert.equal((await createConsecutiveFileHashGuard({
    getValue:()=>null,setValue:()=>{},cryptoSource:null
  }).reserve(chat,'new')).ok,false);
  const store=new Map();
  assert.equal((await createConsecutiveFileHashGuard({
    getValue:()=>null,setValue:(k,v)=>store.set(k,v),cryptoSource:webcrypto
  }).reserve(chat,'sample')).ok,false,'write not persisted: refuse to attach');
});

test('file UI does not gate on occupied composer or existing input selection',()=>{
  const js=source();
  const block=js.slice(js.indexOf('async function handleQuickFile('),
    js.indexOf('async function handleQuickInsert('));
  assert.doesNotMatch(block,/canInsertOnly\?\.\(\)/);
  assert.match(block,/fileHashGuard\.reserve\(chatId, originalText\)/);
  assert.match(js,/queuedPromptController\.appendOnly\(addition, nativeBefore,[\s\S]*?\{fileContext:true\}\)/);
  const fn=js.slice(js.indexOf('function attachPromptTextFile('),
    js.indexOf('function dropPromptTextFile('));
  assert.doesNotMatch(fn, /\(input\.files\?\.length \|\| 0\) !== 0/);
});

test('one File click never triggers drop after input change when card is delayed',async()=>{
  const calls=[];
  const result=await attemptPromptFileOnce({
    tryDirectInput:()=>{calls.push('change');return true;},
    findPlus:()=>{calls.push('findPlus');return {click(){calls.push('plus')}};},
    tryMenuInput:()=>{calls.push('menu-change');return true;},
    tryDrop:()=>{calls.push('drop');return true;},
    waitForCard:async()=>{calls.push('check');return false;}
  });
  assert.deepEqual(calls,['change','check']);
  assert.deepEqual(result,{attempted:true,confirmed:false,path:'input'});
});

test('one File click never triggers drop after menu-input accepted file without card',async()=>{
  const calls=[];
  const result=await attemptPromptFileOnce({
    tryDirectInput:()=>{calls.push('no direct');return false;},
    findPlus:()=>({click(){calls.push('plus')}}),
    afterPlus:async()=>calls.push('wait'),
    tryMenuInput:()=>{calls.push('menu-change');return true;},
    tryDrop:()=>{calls.push('drop');return true;},
    waitForCard:async()=>{calls.push('check');return false;}
  });
  assert.deepEqual(calls,['no direct','plus','wait','menu-change','check']);
  assert.equal(result.attempted,true);
  assert.equal(result.path,'menu-input');
  assert.equal(result.confirmed,false);
});

test('opening plus without a file input never falls back to drop',async()=>{
  const calls=[];
  const result=await attemptPromptFileOnce({
    tryDirectInput:()=>false,
    findPlus:()=>({click(){calls.push('plus')}}),
    tryMenuInput:()=>{calls.push('no menu input');return false;},
    tryDrop:()=>{calls.push('drop');return true;},
    waitForCard:async()=>{calls.push('wait');return true;}
  });
  assert.deepEqual(calls,['plus','no menu input']);
  assert.equal(result.attempted,false);
  assert.equal(result.reason,'menu-no-input');
});

test('when no file input/menu exists, drop triggers once, without any retries',async()=>{
  const calls=[];
  const result=await attemptPromptFileOnce({
    tryDirectInput:()=>false,
    findPlus:()=>null,
    tryDrop:()=>{calls.push('drop');return true;},
    waitForCard:async()=>{calls.push('check');return false;}
  });
  assert.deepEqual(calls,['drop','check']);
  assert.equal(result.attempted,true);
  assert.equal(result.confirmed,false);
});

test('confirmed first file-input selection does not select or drop a second time',async()=>{
  const calls=[];
  const result=await attemptPromptFileOnce({
    tryDirectInput:()=>{calls.push('change');return true;},
    findPlus:()=>({click(){calls.push('plus');}}),
    tryMenuInput:()=>{calls.push('menu-change');return true;},
    tryDrop:()=>{calls.push('drop');return true;},
    waitForCard:async()=>{calls.push('check');return true;}
  });
  assert.deepEqual(calls,['change','check']);
  assert.equal(result.confirmed,true);
  assert.equal(result.path,'input');
});

test('File handler uses single attempt orchestrator, no second fallback on uncertain card',()=>{
  const js=source();
  const action=js.slice(js.indexOf('async function handleQuickFile('),
    js.indexOf('async function handleQuickInsert('));
  assert.match(action,/await attemptPromptFileOnce\(/);
  assert.match(action,/if \(transfer\.attempted\)/);
  assert.match(action,/Возможно, файл уже добавлен/);
  assert.doesNotMatch(action,/const selected = tryFileInputs\(/);
  assert.doesNotMatch(action,/const attempted = dropPromptTextFile\(/);
  assert.doesNotMatch(action,/\.sendNow\(|\.saveAndSend\(|clickCurrentSend/);
});

test('two eligible native file inputs: exactly one change even if React handler throws',()=>{
  const primary={type:'file',accept:'.txt',disabled:false,isConnected:true,id:'first'};
  const next={type:'file',accept:'.txt',disabled:false,isConnected:true,id:'second'};
  const touched=[];
  const attempted=tryPromptFileInputOnce({name:'fortis-prompt-a.txt'},[primary,next],
    candidate=>{touched.push(candidate.id);throw Error('React reacted after change')});
  assert.equal(attempted,true,'one input may already have consumed event');
  assert.deepEqual(touched,['first'],'second compatible file input must not receive an upload');
});

test('file selection skips photo-only input and chooses first compatible input once',()=>{
  const photo={type:'file',accept:'image/*',disabled:false,isConnected:true,id:'photo'};
  const compatible={type:'file',accept:'.txt',disabled:false,isConnected:true,id:'text'};
  const extra={type:'file',accept:'.txt',disabled:false,isConnected:true,id:'extra'};
  const touched=[];
  assert.equal(tryPromptFileInputOnce({name:'fortis-prompt-b.txt'},
    [photo,compatible,extra],input=>touched.push(input.id)),true);
  assert.deepEqual(touched,['text']);
  assert.equal(tryPromptFileInputOnce({name:'fortis-prompt-b.txt'},
    [photo],()=>touched.push('UNSAFE')),false);
  assert.deepEqual(touched,['text']);
});

test('file card can hold exact filename only in nested aria-label/title, never in composer text',()=>{
 const name='fortis-prompt-unique_209.txt';
 const previewChild={getAttribute:key=>key==='title'?name:null,
   matches(){return false},closest(){return null}};
 const preview={textContent:'Файл готов',getAttribute:key=>
   key==='data-testid'?'composer-file-attachment':key==='data-state'?'ready':null,
   matches(){return false},querySelector(){return null},
   querySelectorAll(){return [previewChild]}};
 const wrapper={querySelectorAll(){return [preview]}};
 assert.equal(fileAttachmentVisible(wrapper,name),true,
   'filename in nested title of recognized file-preview card counts as confirmed');
 const nonCard={...preview,getAttribute:key=>key==='data-testid'?'composer-status':null};
 assert.equal(fileAttachmentVisible({querySelectorAll(){return [nonCard]}},name),false,
   'same title on a generic status message is NOT attachment evidence');
 const childInEditor={...previewChild,
   closest:()=>({isConnected:true})};
 assert.equal(fileAttachmentVisible({querySelectorAll(){return [{...preview,
   querySelectorAll(){return [childInEditor]}}]}},name),false,
   'file name inside native contenteditable must never confirm upload');
});

test('one attempt with no confirmed file preview is explicitly ambiguous, never retry',async()=>{
 const calls=[];
 const state=await attemptPromptFileOnce({
  tryDirectInput:()=>{calls.push('file-input-change');return true},
  findPlus:()=>{calls.push('plus');return {}},
  tryMenuInput:()=>{calls.push('menu');return true},
  tryDrop:()=>{calls.push('drop');return true},
  waitForCard:async()=>{calls.push('inspect-card');return false}
 });
 assert.deepEqual(calls,['file-input-change','inspect-card']);
 assert.equal(state.attempted,true);
 assert.equal(state.confirmed,false);
 assert.match(source(),/attachmentAttempted:true,attachmentConfirmed:false/,
   'Notifer must report attempted-but-unverified file without claiming failure');
});

test('an exception inspecting a possibly attached file is still one ambiguous attempt',async()=>{
 const touched=[];
 const result=await attemptPromptFileOnce({
  tryDirectInput:()=>{touched.push('upload-change');return true},
  findPlus:()=>{touched.push('plus');return null},
  tryDrop:()=>{touched.push('drop');return true},
  waitForCard:async()=>{touched.push('inspect');throw Error('React re-rendered')}
 });
 assert.deepEqual(touched,['upload-change','inspect']);
 assert.deepEqual(result,{attempted:true,confirmed:false,path:'input'});
 const src=source();
 assert.match(src,/catch \(_\) \{confirmed=false\}/);
 assert.match(src,/completed=\{ok:false,reason:'context_mismatch'\}/);
});

test('duplicate File SHA-256 reason is forwarded to owner instead of unknown refusal',()=>{
  const handler=source().slice(source().indexOf('async function handleQuickFile('),
    source().indexOf('async function handleQuickInsert('));
  assert.match(handler,/return \{ok:false,reason:reservation\.duplicate\?'duplicate':'not_confirmed',\s*detail:safeNotifierFileDetail\(lastFileStatus\)\}/);
  assert.match(handler,/if \(!reservation\.ok\)/);
  assert.ok(handler.indexOf('if (!reservation.ok)')<handler.indexOf('await attemptPromptFileOnce('),
    'blocked SHA means no upload was started');
});

test('ChatGPT composer-attachment-surface button confirms exact attached filename from aria-label',()=>{
  // Real Edge element supplied by owner:
  // <button class="composer-attachment-surface absolute inset-0 ..."
  //   type="button" aria-label="fortis-prompt-mvh0e4ol.txt"></button>
  const filename='fortis-prompt-mvh0e4ol.txt';
  function card({label=filename,css='composer-attachment-surface absolute inset-0',
    type='button',busy=null,inComposer=false}={}){
    return {
      textContent:'', className:css, tagName:'BUTTON',
      getAttribute:key=>({
        'aria-label':label,'type':type,'aria-busy':busy
      })[key]??null,
      matches:selector=>
        selector==='button.composer-attachment-surface[type="button"][aria-label]'
          ?type==='button'&&css.split(/\s+/).includes('composer-attachment-surface')
          :false,
      closest:()=>inComposer?{nodeName:'DIV',isContentEditable:true}:null,
      querySelector:()=>null,querySelectorAll:()=>[]
    };
  }
  const container=element=>({querySelectorAll:()=>[element]});
  assert.equal(fileAttachmentVisible(container(card()),filename),true,
    'exact surface button must be recognised, although it has no data-testid');
  assert.equal(fileAttachmentVisible(container(card({label:'fortis-prompt-other.txt'})),filename),false,
    'another attachment cannot confirm this attempt');
  assert.equal(fileAttachmentVisible(container(card({label:filename+'.bak'})),filename),false,
    'filename matching on this new surface must be exact, not substring');
  assert.equal(fileAttachmentVisible(container(card({css:'status-button'})),filename),false,
    'unrelated button with matching aria-label must not count');
  assert.equal(fileAttachmentVisible(container(card({type:'submit'})),filename),false,
    'non-file button must not count');
  assert.equal(fileAttachmentVisible(container(card({busy:'true'})),filename),false,
    'upload still in progress is not confirmed');
  assert.equal(fileAttachmentVisible(container(card({inComposer:true})),filename),false,
    'text inside contenteditable is not attachment evidence');
});

test('full Notifier file mismatch is carried exactly, never from user source',()=>{
 const full='Файл прикреплён, но контекст не добавлен: '+
   'Вставка не совпала с исходником посимвольно. '+
   'Исходник сохранён; Send не нажимался. Не отправляй до ручной проверки.';
 assert.equal(safeNotifierFileDetail(full),full);
 assert.equal(safeNotifierFileDetail(
   'Файл прикреплён, но контекст не добавлен: '+
   'После добавления черновик отличается посимвольно. Send не нажимался. '+
   'Не отправляй до ручной проверки.').startsWith('Файл прикреплён'),true);
 assert.equal(safeNotifierFileDetail('секрет из редактора'),null);
 assert.equal(safeNotifierFileDetail(full+'\nПриватный запрос'),null);
 assert.equal(safeNotifierFileDetail(full+'x'),null);
 assert.equal(safeNotifierFileDetail('<script>secret</script>'),null);
 assert.equal(safeNotifierFileDetail(full.repeat(10)),null);
 assert.equal(safeNotifierFileDetail(
   'Одна попытка прикрепления (input) выполнена, но ChatGPT не подтвердил карточку. '+
   'Возможно, файл уже добавлен. Второй попытки НЕ делаю; '+
   'проверь вложения вручную. Send не нажат.'
 ),'Одна попытка прикрепления (input) выполнена, но ChatGPT не подтвердил карточку. '+
   'Возможно, файл уже добавлен. Второй попытки НЕ делаю; '+
   'проверь вложения вручную. Send не нажат.');
 const fileHandler=source().slice(source().indexOf('async function handleQuickFile('),
                                   source().indexOf('async function handleQuickInsert('));
 assert.match(fileHandler,/detail:safeNotifierFileDetail\(lastFileStatus\)/);
 assert.match(source(),/lastFileStatus = String\(message \|\| ''\)/);
});
