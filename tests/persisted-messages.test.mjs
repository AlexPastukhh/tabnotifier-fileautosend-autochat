import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createTaskIdBehavior, createGMRecordStorage, createPersistentMessageController } = require('../src/persisted-messages.js');

function fixture({ chat = 'chat-12345678', failWrites = false, queueBusy = false } = {}) {
  const map = new Map();
  const storage = {
    get: key => structuredClone(map.get(key) ?? null),
    set: (key, value) => {
      if (failWrites) throw new Error('quota reached');
      map.set(key, structuredClone(value));
    },
    list: () => [...map.keys()]
  };
  const state = { chat, busy: queueBusy, sends: [] };
  const queue = {
    entries: new Map(), nextId: 1,
    isWaitingToSend: () => state.busy,
    add(text, options) {
      const id = 'q-' + this.nextId++;
      this.entries.set(id, { text, options });
      return id;
    },
    sendNow(id, options) {
      state.sends.push({ id, ...this.entries.get(id), sendOptions: options });
      return true;
    },
    remove(id) { this.entries.delete(id); }
  };
  const make = () => createPersistentMessageController({
    storage, queue, getConversationId: () => state.chat,
    behavior: createTaskIdBehavior(webcrypto), now: () => 123456789
  });
  return { map, storage, state, queue, make };
}

test('Tampermonkey string-only GM storage supports verified original, history and Send', () => {
  const underlying = new Map();
  const gm = createGMRecordStorage({
    getValue: (key, fallback) => underlying.has(key) ? underlying.get(key) : fallback,
    setValue: (key, value) => {
      assert.equal(typeof value, 'string', 'Tampermonkey must receive JSON string');
      underlying.set(key, value);
    },
    listValues: () => [...underlying.keys()]
  });
  const queue = {sends:[], isWaitingToSend:()=>false,
    add(text){this.sends.push(text);return 'q'+this.sends.length;},
    sendNow:()=>true,remove:()=>{}};
  const ctl = createPersistentMessageController({ queue,storage:gm,
    getConversationId:()=> 'chat-12345678',
    behavior:createTaskIdBehavior(webcrypto), now:()=>123456789 });
  const text = '  кириллица 🗂️\n\nстрока два  ';
  const id = ctl.saveAndSend(text);
  assert.match(id,/^task_[0-9a-f]{32}$/);
  assert.equal(queue.sends.length,1);
  assert.equal(gm.get('fortis-local-user-message-v1-'+id).original_text,text);
  assert.equal(ctl.listForChat()[0].original_text,text);
  assert.equal(ctl.load(id).send_status,'send_queued');
  assert.equal(underlying.size,2);
  assert.equal(gm.list('chat-12345678').includes('fortis-local-user-message-v1-'+id),true);
});

test('LIST_FAILED screenshot reproduction: disabled or throwing GM enumeration uses durable chat index', () => {
  for (const listValues of [null, ()=>{throw Error('GM_listValues unavailable');}, ()=>undefined]) {
    const raw=new Map();
    const gm=createGMRecordStorage({
      getValue: (key,other)=>raw.get(key) ?? other,
      setValue: (key,value)=>raw.set(key,value),
      listValues
    });
    const make=()=>createPersistentMessageController({
      storage:gm,getConversationId:()=> 'abcdefff-1234',
      queue: {sent:[],isWaitingToSend:()=>false,add(text){this.sent.push(text);return 'q'+this.sent.length;},
              sendNow:()=>true,remove:()=>{}},
      behavior:createTaskIdBehavior(webcrypto),now:()=>123456789
    });
    const controller=make();
    const id=controller.saveAndSend('тест 🧪\nещё строка');
    assert.match(id,/^task_[0-9a-f]{32}$/);
    assert.equal(controller.getStorageHealth(),true);
    assert.equal(controller.load(id).original_text,'тест 🧪\nещё строка');
    assert.deepEqual(make().listForChat().map(x=>x.task_id),[id]);
    assert.equal(controller.getLastStatus(),'Сообщение сохранено локально; проверяется штатная отправка.');
    assert.equal(raw.size,2);
  }
});

test('index state survives new controller and adds distinct task without losing first', () => {
  const raw=new Map();
  const gm=createGMRecordStorage({
    getValue:(key,fallback)=>raw.get(key) ?? fallback,
    setValue:(key,value)=>raw.set(key,value),
    listValues:null
  });
  const queue={add:()=> 'q1',sendNow:()=>true,isWaitingToSend:()=>false,remove:()=>{}};
  const mk=chat=>createPersistentMessageController({queue,storage:gm,
    getConversationId:()=>chat,behavior:createTaskIdBehavior(webcrypto)});
  const a=mk('chat-alpha01'), b=mk('chat-alpha01');
  const first=a.saveAndSend('Первый'), second=b.saveAndSend('Второй');
  assert.notEqual(first,second);
  const restored=mk('chat-alpha01');
  assert.deepEqual(new Set(restored.listForChat().map(v=>v.task_id)),
    new Set([first,second]));
  assert.equal(mk('chat-beta02').listForChat().length,0);
  assert.equal(restored.getStorageHealth(),true);
});

test('working GM enumeration discovers legacy unindexed objects while keeping new index', () => {
  const raw=new Map();
  const legacyId='task_'+'a'.repeat(32);
  const legacy={version:1,task_id:legacyId,conversation_id:'chat-alpha01',
    original_text:'Legacy record',created_at:100,send_status:'sent'};
  raw.set('fortis-local-user-message-v1-'+legacyId,legacy);
  const gm=createGMRecordStorage({
    getValue:(key,fallback)=>raw.get(key) ?? fallback,
    setValue:(key,value)=>raw.set(key,value),
    listValues:()=>[...raw.keys()]
  });
  const ctl=createPersistentMessageController({queue:{
    add:()=> 'q1',sendNow:()=>true,isWaitingToSend:()=>false,remove:()=>{}},
    storage:gm,getConversationId:()=> 'chat-alpha01',behavior:createTaskIdBehavior(webcrypto)
  });
  const now=ctl.saveAndSend('New record');
  assert.deepEqual(new Set(ctl.listForChat().map(v=>v.task_id)),
    new Set([legacyId,now]));
  assert.deepEqual(gm.get('fortis-local-user-message-v1-'+legacyId),legacy);
});

test('unwritable index or wrong index readback blocks native ChatGPT send', () => {
  for(const scenario of ['index-write-throws','index-readback-not-persisted']){
    const raw=new Map();
    const gm=createGMRecordStorage({
      getValue:(key,other)=>raw.get(key) ?? other,
      setValue:(key,value)=>{
        if(key.startsWith('fortis-local-user-message-index-v1-')){
          if(scenario==='index-write-throws')throw new Error('quota');
          return; // fake write success but no durable index
        }
        raw.set(key,value);
      },
      listValues:()=>{throw new Error('blocked')}
    });
    let calls=0;
    const ctl=createPersistentMessageController({
      storage:gm,getConversationId:()=> 'chat-12345678',
      queue:{isWaitingToSend:()=>false,add:()=>{calls+=1;return 'q1'},
        sendNow:()=>true,remove:()=>{}},
      behavior:createTaskIdBehavior(webcrypto)
    });
    assert.equal(ctl.saveAndSend('must not send'),null,scenario);
    assert.equal(calls,0,scenario);
    assert.equal(raw.size,1,scenario);
    assert.match(ctl.getLastStatus(),scenario==='index-write-throws'
      ? /WRITE_FAILED/ : /INDEX_READBACK_MISMATCH/);
  }
});

test('disabled enumeration still supports queue callback status updates after initial save', () => {
  const raw=new Map();
  const gm=createGMRecordStorage({
    getValue:(key,other)=>raw.get(key) ?? other,
    setValue:(key,value)=>raw.set(key,value),
    listValues:()=>{throw new Error('list failed')}
  });
  const queue={entry:undefined,isWaitingToSend:()=>false,
    add(text){this.entry=text;return 'q1'},sendNow:()=>true,remove:()=>{}};
  const ctl=createPersistentMessageController({queue,storage:gm,
    getConversationId:()=> 'chat-12345678',
    behavior:createTaskIdBehavior(webcrypto),now:()=>123456789});
  const task=ctl.saveAndSend('тест статусов');
  assert.ok(task);
  assert.equal(ctl.beforeSendClick({source:'manual-persisted',itemIds:['q1']}),true);
  assert.equal(ctl.load(task).send_status,'send_unconfirmed');
  ctl.handleSendResult({source:'manual-persisted',itemIds:['q1'],status:'sent'});
  const fresh=createPersistentMessageController({
    storage:gm,queue,getConversationId:()=> 'chat-12345678',
    behavior:createTaskIdBehavior(webcrypto)
  });
  assert.equal(fresh.load(task).send_status,'sent');
  assert.deepEqual(fresh.listForChat().map(record=>record.task_id),[task]);
  assert.equal(fresh.getStorageHealth(),true);
});

test('invalid or unverifiable chat index blocks send, preserving the original on disk',()=>{
  for(const indexValue of ['{corrupted json',JSON.stringify(['not-a-task'])]){
    const raw=new Map([['fortis-local-user-message-index-v1-chat-12345678',indexValue]]);
    const gm=createGMRecordStorage({
      getValue:(key,other)=>raw.get(key) ?? other,
      setValue:(key,val)=>raw.set(key,val),
      listValues:null
    });
    let calls=0;
    const controller=createPersistentMessageController({
      storage:gm,getConversationId:()=> 'chat-12345678',
      queue:{isWaitingToSend:()=>false,add:()=>{calls++;return 'q';},
        sendNow:()=>true,remove:()=>{}},
      behavior:createTaskIdBehavior(webcrypto)
    });
    assert.equal(controller.saveAndSend('must not send'),null);
    assert.match(controller.getLastStatus(),/INDEX_INVALID/);
    assert.equal(calls,0);
    assert.equal(raw.size,2);
  }
});

test('pre-existing object-format Tampermonkey GM records remain readable', () => {
  const f=fixture();
  const ctl=f.make();
  const id=ctl.saveAndSend('Legacy original');
  const gm=createGMRecordStorage({
    getValue: (key,fallback)=>f.map.get(key) ?? fallback,
    setValue: (key,value)=>f.map.set(key,value),
    listValues:()=>[...f.map.keys()]
  });
  const compatible=createPersistentMessageController({
    queue:f.queue,storage:gm,getConversationId:()=>f.state.chat,
    behavior:createTaskIdBehavior(webcrypto),now:()=>123456789
  });
  assert.equal(compatible.load(id).original_text,'Legacy original');
  assert.equal(compatible.listForChat()[0].task_id,id);
});

test('a thrown UI redraw after verified GM write never masquerades as storage failure',()=>{
  const f=fixture();
  const ctl=createPersistentMessageController({
    queue:f.queue,storage:f.storage,getConversationId:()=>f.state.chat,
    onChange:()=>{throw new Error('UI redraw bug');},
    behavior:createTaskIdBehavior(webcrypto),now:()=>123456789
  });
  const id=ctl.saveAndSend('recoverable');
  assert.ok(id);
  assert.equal(f.map.size,1);
  assert.equal(f.state.sends.length,1);
});

test('local storage failures report non-sensitive stage codes and always block Send',()=>{
  const cases=[
    {code:'WRITE_FAILED', storage:()=>({get:()=>null,set(){throw new Error('private secret text');},list:()=>[]})},
    {code:'READ_FAILED', storage:()=>({get(){throw new Error('private secret text');},set:()=>{},list:()=>[]})},
    {code:'READBACK_MISMATCH', storage:()=>({get:()=>null,set:()=>{},list:()=>[]})},
    {code:'LIST_FAILED', storage:()=>{let saved=null;return {
      get:()=>saved,set:(k,v)=>{saved=v;},list(){throw Error('private');}};} },
    {code:'LIST_NOT_VISIBLE', storage:()=>{
      let saved=null;return {get:()=>saved,set:(k,v)=>{saved=v;},list:()=>[]};}},
    {code:'LIST_NOT_ARRAY', storage:()=>{
      let saved=null;return {get:()=>saved,set:(k,v)=>{saved=v;},list:()=>new Set(['x'])};}}
  ];
  for(const item of cases){
    const queue={sent:0,isWaitingToSend:()=>false,
      add:()=>{queue.sent++;return 'id';},sendNow:()=>true,remove:()=>{}};
    const ctl=createPersistentMessageController({
      queue,storage:item.storage(),getConversationId:()=> 'chat-12345678',
      behavior:createTaskIdBehavior(webcrypto)
    });
    const result=ctl.saveAndSend('private original');
    assert.equal(result,null,item.code);
    assert.equal(queue.sent,0,item.code);
    assert.match(ctl.getLastStatus(),new RegExp(item.code),item.code);
    assert.doesNotMatch(ctl.getLastStatus(),/private (secret|original)/);
  }
});

test('TaskIdBehavior generates secure, distinct per-message IDs and preserves raw original', () => {
  const behavior = createTaskIdBehavior(webcrypto);
  const first = behavior.prepare('  Привет\nмир  ');
  const second = behavior.prepare('  Привет\nмир  ');
  assert.match(first.task_id, /^task_[0-9a-f]{32}$/);
  assert.notEqual(first.task_id, second.task_id);
  assert.equal(first.original_text, '  Привет\nмир  ');
  assert.ok(first.submitted_text.includes('task_id: ' + first.task_id));
  assert.match(first.submitted_text, /НЕ переноси ID предыдущего запроса/);
  assert.equal(behavior.prepare('   '), null);
});
test('TaskIdBehavior fails closed without crypto', () => {
  assert.throws(() => createTaskIdBehavior({}).prepare('message'), /криптографически/);
});
test('save-before-send retains exact text and keeps private queue item separate', () => {
  const f = fixture();
  const controller = f.make();
  const id = controller.saveAndSend('Тест\n  оригинал  ');
  const record = controller.load(id);
  assert.equal(record.original_text, 'Тест\n  оригинал  ');
  assert.equal(record.send_status, 'send_queued');
  assert.equal(record.archive_status, 'pending_activity');
  assert.equal(record.sent_at, null);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.sends[0].options.persistent, true);
  assert.equal(f.state.sends[0].sendOptions.source, 'manual-persisted');
  assert.match(f.state.sends[0].text, new RegExp(id));
  assert.equal(f.make().load(id).original_text, record.original_text);
});
test('two messages with equal text generate distinct recoverable records', () => {
  const f = fixture();
  const controller = f.make();
  const one = controller.saveAndSend('hello');
  const two = controller.saveAndSend('hello');
  assert.notEqual(one, two);
  assert.deepEqual(f.make().listForChat().map(item => item.task_id).sort(), [one, two].sort());
});
test('failure to persist stops send, without losing existing record', () => {
  const f = fixture({ failWrites: true });
  assert.equal(f.make().saveAndSend('Привет'), null);
  assert.equal(f.state.sends.length, 0);
  assert.equal(f.map.size, 0);
});
test('unknown chat fails closed before task generation or Send', () => {
  const f = fixture({ chat: '' });
  assert.equal(f.make().saveAndSend('hello'), null);
  assert.equal(f.state.sends.length, 0);
});
test('busy queue fails without making another task record', () => {
  const f = fixture({ queueBusy: true });
  assert.equal(f.make().saveAndSend('hello'), null);
  assert.equal(f.map.size, 0);
});
test('pre-click record is durable and uncertain result is not automatically resent', () => {
  const f = fixture();
  const ctl = f.make();
  const id = ctl.saveAndSend('Привет');
  const queueId = f.state.sends[0].id;
  assert.equal(ctl.beforeSendClick({ source: 'manual-persisted', itemIds: [queueId] }), true);
  assert.equal(f.make().load(id).send_status, 'send_unconfirmed');
  ctl.handleSendResult({ source: 'manual-persisted', itemIds: [queueId], status: 'unconfirmed' });
  assert.equal(ctl.sendExisting(id), false);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.make().load(id).send_status, 'send_unconfirmed');
});
test('confirmed Send keeps local record indefinitely awaiting activity', () => {
  const f = fixture();
  const ctl = f.make();
  const id = ctl.saveAndSend('Привет');
  const queueId = f.state.sends[0].id;
  ctl.beforeSendClick({ source: 'manual-persisted', itemIds: [queueId] });
  ctl.handleSendResult({ source: 'manual-persisted', itemIds: [queueId], status: 'sent' });
  const restored = f.make().load(id);
  assert.equal(restored.send_status, 'sent');
  assert.equal(restored.sent_at, 123456789);
  assert.equal(restored.archive_status, 'pending_activity');
  assert.equal(restored.original_text, 'Привет');
  assert.equal(f.state.sends.length, 1);
});
test('pre-click failure allows explicit resend using SAME task_id and outgoing text', () => {
  const f = fixture();
  const ctl = f.make();
  const id = ctl.saveAndSend('Original');
  const queueId = f.state.sends[0].id;
  ctl.handleSendResult({ source: 'manual-persisted', itemIds: [queueId], status: 'failed' });
  assert.equal(f.make().load(id).send_status, 'send_failed');
  assert.equal(ctl.sendExisting(id), true);
  assert.equal(f.state.sends.length, 2);
  assert.equal(f.state.sends[0].text, f.state.sends[1].text);
  assert.equal(f.make().listForChat().length, 1);
});
test('wrong chat cannot resend or show a record from another conversation', () => {
  const f = fixture();
  const ctl = f.make();
  const id = ctl.saveAndSend('Original');
  const queueId = f.state.sends[0].id;
  ctl.handleSendResult({ source: 'manual-persisted', itemIds: [queueId], status: 'failed' });
  f.state.chat = 'another-87654321';
  assert.equal(ctl.sendExisting(id), false);
  assert.deepEqual(ctl.listForChat(), []);
  assert.equal(f.make().load(id).original_text, 'Original');
});
test('sending already persisted items requires successful pre-click storage write', () => {
  const f = fixture();
  const ctl = f.make();
  ctl.saveAndSend('Original');
  const queueId = f.state.sends[0].id;
  f.storage.set = () => { throw new Error('storage failure'); };
  assert.equal(ctl.beforeSendClick({ source: 'manual-persisted', itemIds: [queueId] }), false);
  assert.equal(ctl.beforeSendClick({ source: 'manual-item', itemIds: [queueId] }), true);
  assert.equal(f.state.sends.length, 1);
});

test('persisted queue entries are hidden from the legacy auto/bulk sender', () => {
  const { createQueuedPromptController } = require('../src/queued-prompt.js');
  const queue = createQueuedPromptController();
  const persistedId = queue.add('Private prompt', { persistent: true });
  assert.equal(queue.getCount(), 0);
  assert.equal(queue.hasQueued(), false);
  assert.deepEqual(queue.getItems(), []);
  assert.equal(queue.sendAllNow(), false);
  assert.equal(queue.handleResponseFinished(), false);
  assert.equal(queue.sendNow(persistedId), false);
  const regularId = queue.add('Old queue prompt');
  assert.equal(queue.getCount(), 1);
  assert.equal(queue.hasQueued(), true);
  assert.equal(queue.sendNow(regularId, { source: 'manual-persisted' }), false);
});

test('persisted history UI offers the dedicated action without changing old queue actions', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../src/upload-button-ui.js'), 'utf8');
  assert.match(source, /class="persist-send"[^>]*>Сохранить и отправить</);
  assert.match(source, /class="add"[^>]*>В очередь</);
  assert.match(source, /persistentMessageController\?\.saveAndSend\(ui\.textarea\.value\)/);
  assert.match(source, /renderPersistedList\(ui\)/);
});
test('real queue path uses saved task_id before native click and confirms sent afterward', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  class TextArea {
    constructor() { this._value = ''; this.isConnected = true; }
    get value() { return this._value; }
    set value(next) { this._value = next; }
    dispatchEvent() { return true; }
  }
  const composer = new TextArea();
  let clicked = 0;
  const sendButton = { click() { clicked += 1; composer.value = ''; } };
  const deps = {
    findComposerContext: () => ({ composer, container: {}, sendButton }),
    isSendButtonReady: () => true, isGenerating: () => false
  };
  const sandbox = {
    ChatGPTTabNotifier: deps, HTMLTextAreaElement: TextArea,
    Event: class {}, setTimeout, clearTimeout,
    console: { info() {}, warn() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/queued-prompt.js'), 'utf8'), sandbox);
  const f = fixture();
  let persistent;
  const queue = sandbox.ChatGPTTabNotifier.createQueuedPromptController({
    beforeSendClick: info => persistent?.beforeSendClick(info) ?? true,
    onSendResult: info => persistent?.handleSendResult(info)
  });
  persistent = createPersistentMessageController({
    queue, storage: f.storage, getConversationId: () => f.state.chat,
    behavior: createTaskIdBehavior(webcrypto), now: () => 123456789
  });
  const id = persistent.saveAndSend('Интеграционный тест');
  assert.equal(queue.getCount(), 0);
  assert.match(composer.value, new RegExp(id));
  assert.equal(persistent.load(id).send_status, 'send_queued');
  queue.attemptSend();
  assert.equal(clicked, 1);
  assert.equal(persistent.load(id).send_status, 'send_unconfirmed');
  queue.attemptSend();
  assert.equal(persistent.load(id).send_status, 'sent');
  assert.equal(persistent.load(id).archive_status, 'pending_activity');
  assert.equal(f.map.size, 1);
});


test('insert draft prepares Fortis context and exact original without automatic Send', () => {
  const f=fixture();
  const ctl=f.make();
  const original='Проверка  A  B\n\nUnicode 🌍  ';
  const draft=ctl.prepareDraft(original,{mode:'insert',
    extraText:'Модуль Planning Helper: строгий контроль'});
  assert.match(draft.task_id,/^task_[0-9a-f]{32}$/);
  assert.equal(f.state.sends.length,0);
  assert.equal(ctl.load(draft.task_id).send_status,'draft');
  assert.equal(ctl.load(draft.task_id).original_text,original);
  assert.ok(draft.submitted_text.startsWith(original+'\n\n'),
    'preserve trailing spaces before task context as exact inserted user text');
  assert.match(draft.submitted_text,/Модуль Planning Helper: строгий контроль/);
  assert.match(draft.submitted_text,new RegExp(draft.task_id));
  assert.equal(ctl.recordManualDraftSend('Edited unrelated text'),null);
  assert.equal(ctl.load(draft.task_id).send_status,'draft');
  assert.equal(ctl.recordManualDraftSend(draft.submitted_text),draft.task_id);
  assert.equal(ctl.load(draft.task_id).send_status,'send_unconfirmed');
  assert.equal(f.state.sends.length,0);
  assert.equal(ctl.recordManualDraftSend(draft.submitted_text),null);
});

test('File contains exact original, all Fortis guidance and modules; native is a short pointer',()=>{
  const f=fixture();
  const ctl=f.make();
  const original='Большой 🌍 запрос\n'.repeat(4500);
  const draft=ctl.prepareDraft(original,{mode:'file',
    fileName:'fortis-prompt-unit-test.txt',
    extraText:'Модуль профиля Helper'});
  assert.match(draft.task_id,/^task_[0-9a-f]{32}$/);
  assert.equal(ctl.load(draft.task_id).original_text,original);
  assert.equal(ctl.load(draft.task_id).file_name,'fortis-prompt-unit-test.txt');
  assert.ok(draft.submitted_text.length < 5000);
  assert.match(draft.submitted_text,/fortis-prompt-unit-test\.txt/);
  assert.doesNotMatch(draft.submitted_text,/Модуль профиля Helper/);
  assert.match(draft.submitted_text,new RegExp(draft.task_id));
  assert.ok(draft.file_text.startsWith(original+'\n\n'),
    'attachment must begin with the exact untouched original, even with trailing whitespace');
  assert.match(draft.file_text,/\[Fortis task context\]/);
  assert.match(draft.file_text,/Модуль профиля Helper/);
  assert.match(draft.file_text,new RegExp(draft.task_id));
  assert.ok(!('file_text' in ctl.load(draft.task_id)),
    'large generated payload must not be duplicated inside synchronous GM storage');
  assert.equal(ctl.load(draft.task_id).original_text,original);
  assert.equal(f.state.sends.length,0);
  assert.equal(ctl.recordManualDraftSend(draft.submitted_text),null);
  assert.equal(ctl.recordManualDraftSend(draft.submitted_text,
    {fileNameVisible:name=>name==='fortis-prompt-unit-test.txt'}),draft.task_id);
  assert.equal(ctl.load(draft.task_id).send_status,'send_unconfirmed');
});

test('draft refuses invalid profile, filename and source above archive size',()=>{
  const f=fixture();
  const ctl=f.make();
  assert.equal(ctl.prepareDraft('текст',{mode:'file',fileName:'unsafe.pdf'}),null);
  assert.equal(ctl.prepareDraft('текст',{mode:'insert',extraText:12}),null);
  assert.equal(ctl.prepareDraft('🌍'.repeat(140000),{mode:'file',
    fileName:'fortis-prompt-too-big.txt'}),null);
  assert.equal(ctl.listForChat().length,0);
  assert.equal(f.state.sends.length,0);
});

test('draft manual Send refuses changed chat, edited context or wrong attachment',()=>{
  const f=fixture();
  const ctl=f.make();
  const draft=ctl.prepareDraft('Уникальный текст',{mode:'insert'});
  f.state.chat='another-chat-1234';
  assert.equal(ctl.recordManualDraftSend(draft.submitted_text),null);
  f.state.chat='chat-12345678';
  assert.equal(ctl.recordManualDraftSend(draft.submitted_text+' EDIT'),null);
  assert.equal(ctl.load(draft.task_id).send_status,'draft');
});

test('draft-only task context is bound to current Repo pairing, never old task ID',()=>{
  const f=fixture();
  const pair={
    origin:'http://127.0.0.1:18755',
    conversation_id:f.state.chat,
    reporting_session_id:'rs_'+'b'.repeat(32)
  };
  const ctl=createPersistentMessageController({
    storage:f.storage,queue:f.queue,
    getConversationId:()=>f.state.chat,getPairing:()=>pair,
    behavior:createTaskIdBehavior(webcrypto),now:()=>123456789
  });
  const first=ctl.prepareDraft('Только первый',{mode:'insert',extraText:'Planning Helper A'});
  const second=ctl.prepareDraft('Только второй',{mode:'file',
    fileName:'fortis-prompt-task-test.txt',extraText:'Planning Helper B'});
  assert.notEqual(first.task_id,second.task_id);
  for(const d of [first,second]){
    assert.match(d.submitted_text,new RegExp('task_id: '+d.task_id));
    assert.match(d.submitted_text,new RegExp('reporting_session_id: '+pair.reporting_session_id));
    assert.match(d.submitted_text,/route: repo/);
    assert.equal(ctl.load(d.task_id).reporting_session_id,pair.reporting_session_id);
    assert.equal(ctl.load(d.task_id).send_status,'draft');
  }
  assert.doesNotMatch(second.submitted_text,new RegExp(first.task_id));
  assert.equal(f.state.sends.length,0);
});

test('insert-draft includes all trailing blank lines before modules without stripping',()=>{
  const f=fixture(), ctl=f.make();
  const source='Проверка  A  B\n\nКонец 🌍  \n\n';
  const draft=ctl.prepareDraft(source,{
    mode:'insert',extraText:'Planning Helper module BODY'
  });
  assert.ok(draft.submitted_text.startsWith(source+'\n\n[Fortis task context]'));
  assert.equal(ctl.load(draft.task_id).original_text,source);
  assert.equal(f.state.sends.length,0);
});

test('two different file drafts append to an already-occupied native composer',()=>{
  const f=fixture();
  const ctl=f.make();
  const prior='Уже есть произвольный ручной черновик.';
  const one=ctl.prepareDraft('Первый файл 🌍',{mode:'file',
    fileName:'fortis-prompt-uniq-a.txt',extraText:'Модуль A',nativePrefix:prior});
  assert.ok(one.submitted_text.startsWith(prior+'\n\n'));
  assert.equal(ctl.load(one.task_id).original_text,'Первый файл 🌍');
  const two=ctl.prepareDraft('Второй файл',{mode:'file',
    fileName:'fortis-prompt-uniq-b.txt',extraText:'Модуль B',
    nativePrefix:one.submitted_text});
  assert.ok(two.submitted_text.startsWith(one.submitted_text+'\n\n'));
  assert.equal(f.state.sends.length,0);
  assert.equal(ctl.recordManualDraftSend(two.submitted_text),null,
    'no file evidence, no manual Send transition');
  const recognized=ctl.recordManualDraftSend(two.submitted_text,
    {fileNameVisible:name=>new Set(['fortis-prompt-uniq-a.txt',
      'fortis-prompt-uniq-b.txt']).has(name)});
  assert.equal(recognized,two.task_id);
  assert.equal(ctl.load(one.task_id).send_status,'send_unconfirmed');
  assert.equal(ctl.load(two.task_id).send_status,'send_unconfirmed');
  assert.equal(f.state.sends.length,0);
});

test('owner prepared File task is previewed read-only only with exact snapshot and confirmed file',()=>{
 const f=fixture({chat:'12345678-aaaa-aaaa-bbbb-abcdefabcdef'});
 const sid='rs_'+'e'.repeat(32);
 const pairing={reporting_session_id:sid,
   conversation_id:f.state.chat,origin:'http://127.0.0.1:18755'};
 const controller=createPersistentMessageController({
   storage:f.storage,queue:f.queue,
   getConversationId:()=>f.state.chat,getPairing:()=>pairing,
   behavior:createTaskIdBehavior(webcrypto),now:()=>456
 });
 const ready=controller.prepareDraft('Точный текст файла 🗂️',{
   mode:'file',fileName:'fortis-prompt-unique.txt',extraText:'Модуль Repo'});
 assert.match(ready.task_id,/^task_[0-9a-f]{32}$/);
 const accepted=()=>true, missing=()=>false;
 assert.deepEqual(controller.previewPreparedNativeDraft(ready.submitted_text,
   {fileNameVisible:missing}),[]);
 assert.deepEqual(controller.previewPreparedNativeDraft('Один файл без контекста',
   {fileNameVisible:accepted}),[]);
 assert.deepEqual(controller.previewPreparedNativeDraft(ready.submitted_text+'\n\nИзменили текст',
   {fileNameVisible:missing}),[]);
 const matched=controller.previewPreparedNativeDraft(ready.submitted_text,
   {fileNameVisible:accepted});
 assert.deepEqual(matched.map(x=>x.task_id),[ready.task_id]);
 assert.equal(controller.load(ready.task_id).send_status,'draft',
   'preview never marks as sent and never clicks Send');
 assert.equal(f.state.sends.length,0);
 const sentId=controller.recordManualDraftSend(ready.submitted_text,
   {fileNameVisible:accepted});
 assert.equal(sentId,ready.task_id);
 assert.equal(controller.load(ready.task_id).send_status,'send_unconfirmed');
 assert.equal(controller.previewPreparedNativeDraft(ready.submitted_text,
   {fileNameVisible:accepted}).length,0,'never allow second Send of the same task');
});

test('File prepared draft allows only paragraph-rendering differences, never missing context',()=>{
 const f=fixture();
 const sid='rs_'+'e'.repeat(32);
 const ctl=createPersistentMessageController({
  storage:f.storage,queue:f.queue,getConversationId:()=>f.state.chat,
  getPairing:()=>({reporting_session_id:sid,conversation_id:f.state.chat,
                   origin:'http://127.0.0.1:18755'}),
  behavior:createTaskIdBehavior(webcrypto),now:()=>100
 });
 const draft=ctl.prepareDraft('Файл содержит точный оригинал',{
  mode:'file',fileName:'fortis-prompt-fortest.txt',
  extraText:'Модуль с двумя  пробелами\nЕщё правило'
 });
 const rich=draft.submitted_text.replace(/\n\n/g,'\n')
  .replace(/\n/g,'\r\n');
 const opts={fileNameVisible:name=>name==='fortis-prompt-fortest.txt'};
 const candidate=ctl.previewPreparedNativeDraft(rich,opts);
 assert.deepEqual(candidate?.map(x=>x.task_id),[draft.task_id]);
 assert.equal(ctl.previewPreparedNativeDraft(rich.replace(draft.task_id,
  'task_'+'f'.repeat(32)),opts).length,0,'wrong task ID not accepted');
 assert.match(draft.file_text,/Модуль с двумя  пробелами/);
 assert.doesNotMatch(draft.submitted_text,/Модуль с двумя  пробелами/);
 assert.equal(ctl.previewPreparedNativeDraft(rich.replace('Fortis task context',
  'Fortis task contexx'),opts).length,0,'native file pointer changes are rejected');
 assert.equal(ctl.previewPreparedNativeDraft(rich,
  {fileNameVisible:()=>false}).length,0,'file card still required');
 assert.equal(ctl.recordManualDraftSend(rich,opts),draft.task_id,
   'on native Send, same paragraph rules approve one saved file task');
 assert.equal(ctl.recordManualDraftSend(rich,opts),null,'no second Send');
 const inserted=ctl.prepareDraft('Обчный Insert',{mode:'insert'});
 assert.equal(ctl.previewPreparedNativeDraft(inserted.submitted_text.replace(/\n\n/g,'\n'),opts).length,0,
   'normal Insert must remain strict');
});

test('unpaired current chat stages locally without borrowing previous session IDs',()=>{
  const f=fixture(), ctl=f.make();
  for(const draft of [
    ctl.prepareDraft('Unpaired insert',{mode:'insert'}),
    ctl.prepareDraft('Unpaired file',{mode:'file',fileName:'fortis-prompt-offline.txt'})
  ]){
    assert.match(draft.submitted_text,new RegExp('conversation_id: '+f.state.chat));
    const full=draft.file_text||draft.submitted_text;
    assert.match(full,/локальную очередь без --session/);
    assert.match(full,/каждый полный interim\/final/);
    assert.doesNotMatch(draft.submitted_text,/--session rs_|reporting_session_id:/);
    assert.equal(ctl.load(draft.task_id).reporting_session_id,null);
    assert.equal(ctl.load(draft.task_id).archive_status,'pending_activity');
  }
  assert.equal(f.state.sends.length,0);
});
test('unpaired Send context uses current chat without changing the archive binding',()=>{
  const f=fixture(), ctl=f.make();
  const id=ctl.saveAndSend('Unpaired send');
  const record=ctl.load(id);
  assert.match(record.submitted_text,new RegExp('conversation_id: '+f.state.chat));
  assert.match(record.submitted_text,/локальную очередь без --session/);
  assert.equal(record.reporting_session_id,null);
  assert.equal(record.archive_status,'pending_activity');
});
test('paired context explicitly requires local writes without HTTP readiness',()=>{
  const text=createTaskIdBehavior(webcrypto).prepare('Synthetic',{
    origin:'http://127.0.0.1:18755',conversation_id:'current-chat-1234',
    reporting_session_id:'rs_'+'c'.repeat(32)
  }).submitted_text;
  assert.match(text,/Не проверяй HTTP, pairing или receipt перед записью/);
  assert.match(text,/--session rs_/);
});
