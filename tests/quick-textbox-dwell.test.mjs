import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createTaskIdBehavior, createPersistentMessageController } =
  require('../src/persisted-messages.js');

function setup(clockStart = 1000, callbacks = {}) {
  let clock = clockStart;
  let clicked = 0;
  let clickAt = null;
  let clickBody = null;
  let insertingAt = null;
  let insertionBody = null;
  let seq = 1;
  const pending = new Map();

  class FakeTextarea {
    constructor() { this._value = ''; this.isConnected = true; }
    get value() { return this._value; }
    set value(value) {
      this._value = callbacks.transformNativeValue?.(value) ?? value;
      if (value && insertingAt === null) {
        insertingAt = clock;
        insertionBody = value;
      }
    }
    dispatchEvent() { return true; }
  }
  const composer = new FakeTextarea();
  const sendButton = { click() {
    clicked += 1;
    clickAt = clock;
    clickBody = composer.value;
    composer.value = '';
  }};
  const dep = {
    findComposerContext: () => ({ composer, container: {}, sendButton }),
    isSendButtonReady: () => true,
    isGenerating: () => false
  };
  const sandbox = {
    ChatGPTTabNotifier: dep,
    HTMLTextAreaElement: FakeTextarea,
    Event: class {},
    Date: { now: () => clock },
    setTimeout(callback, wait) {
      const id = seq++;
      if (wait === 16) { queueMicrotask(callback); return id; }
      pending.set(id, { callback, due: clock + wait });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    console: { info() {}, warn() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(require.resolve('../src/queued-prompt.js'), 'utf8'),
    sandbox
  );

  return {
    queue: sandbox.ChatGPTTabNotifier.createQueuedPromptController(callbacks),
    composer,
    sendButton,
    now: () => clock,
    tick(ms) { clock += ms; },
    get clicked() { return clicked; },
    get clickAt() { return clickAt; },
    get clickBody() { return clickBody; },
    get insertingAt() { return insertingAt; },
    get insertionBody() { return insertionBody; },
    pending
  };
}

test('quick textbox transfers immediately and clicks the real Send no sooner than one second', () => {
  const f = setup();
  const nativeText = 'Тест \n [Fortis task context]';
  const queueId = f.queue.add(nativeText, { persistent: true });
  assert.ok(queueId);
  // The queue returns a pre-click staging status while the native composer
  // is already filled, and it must not click native Send on initial attempt.
  assert.equal(f.queue.sendNow(queueId, {
    source: 'manual-persisted', allowWhileGenerating: false,
    minComposerDwellMs: 1000
  }), false);
  assert.equal(f.composer.value, nativeText);
  assert.equal(f.insertingAt, 1000);
  assert.equal(f.clicked, 0);

  f.tick(999);
  assert.equal(f.queue.attemptSend(), false);
  assert.equal(f.clicked, 0);
  assert.equal(f.composer.value, nativeText);

  f.tick(1);
  assert.equal(f.queue.attemptSend(), true);
  assert.equal(f.clicked, 1);
  assert.equal(f.clickAt - f.insertingAt, 1000);
  assert.equal(f.clickBody, nativeText);
  // Extra polls must not click twice.
  f.queue.attemptSend();
  f.queue.attemptSend();
  assert.equal(f.clicked, 1);
});

test('pre-send durable status transition is not triggered before 1000ms dwell', () => {
  let statusWrites=0;
  const f=setup(1000,{beforeSendClick:()=>{
    statusWrites += 1;return true;
  }});
  const id=f.queue.add('Stored body',{persistent:true});
  f.queue.sendNow(id,{source:'manual-persisted',minComposerDwellMs:1000});
  assert.equal(statusWrites,0);
  f.tick(999);
  f.queue.attemptSend();
  assert.equal(statusWrites,0);
  assert.equal(f.clicked,0);
  f.tick(1);
  f.queue.attemptSend();
  assert.equal(statusWrites,1);
  assert.equal(f.clicked,1);
  f.queue.attemptSend();
  assert.equal(statusWrites,1);
});

test('native composer edited during one-second waiting window aborts instead of sending', () => {
  const f=setup();
  const id=f.queue.add('My exact text', { persistent: true });
  f.queue.sendNow(id,{source:'manual-persisted', minComposerDwellMs:1000});
  assert.equal(f.composer.value,'My exact text');
  f.tick(500);
  f.composer.value='User edited native text';
  f.tick(500);
  assert.equal(f.queue.attemptSend(),false);
  assert.equal(f.clicked,0);
  assert.equal(f.composer.value,'User edited native text');
});

test('old manual queue still uses prior near-immediate native send, without one-second hold', () => {
  const f=setup();
  const id=f.queue.add('Legacy queue text');
  f.queue.sendNow(id,{source:'manual-item'});
  assert.equal(f.composer.value,'Legacy queue text');
  f.queue.attemptSend();
  assert.equal(f.clicked,1);
  assert.equal(f.clickAt-f.insertingAt,0);
});

test('persistent original saved before native insertion, quick dwell passes through unchanged', () => {
  const f=setup();
  const map=new Map();
  const storage={
    get:key=>structuredClone(map.get(key)||null),
    set:(key,value)=>map.set(key,structuredClone(value)),
    list:()=>[...map.keys()]
  };
  let persistent;
  const rawQueue=f.queue;
  // Verify the exact save pipeline and options without recreating queue DOM.
  const intercepted={
    isWaitingToSend:()=>rawQueue.isWaitingToSend(),
    add:(text,opts)=>rawQueue.add(text,opts),
    sendNow:(id,opts)=>{
      const stored=[...map.values()].find(record=>record.submitted_text);
      assert.ok(stored, 'original record must be durable before queue begins');
      assert.equal(opts.minComposerDwellMs,1000);
      return rawQueue.sendNow(id,opts);
    },
    remove:id=>rawQueue.remove(id)
  };
  persistent=createPersistentMessageController({
    queue:intercepted,storage,getConversationId:()=> 'chat-12345678',
    behavior:createTaskIdBehavior(webcrypto),now:()=>123456789
  });
  const id=persistent.saveAndSend('сырой текст  ',{minComposerDwellMs:1000});
  assert.match(id,/^task_[0-9a-f]{32}$/);
  assert.equal(persistent.load(id).original_text,'сырой текст  ');
  assert.match(f.composer.value,/task_id: /);
  assert.equal(f.clicked,0);
  f.tick(1000);
  f.queue.attemptSend();
  assert.equal(f.clicked,1);
});

test('existing plus-panel persistent send path defaults to no dwell',()=>{
  const f=setup();
  const map=new Map();
  const queue={
    isWaitingToSend:()=>f.queue.isWaitingToSend(),
    add:(t,o)=>f.queue.add(t,o),
    sendNow:(id,opts)=>{
      assert.equal(opts.minComposerDwellMs,0);
      return f.queue.sendNow(id,opts);
    },
    remove:id=>f.queue.remove(id)
  };
  const ctl=createPersistentMessageController({
    queue,storage:{
      get:k=>structuredClone(map.get(k)||null),
      set:(k,v)=>map.set(k,structuredClone(v)),
      list:()=>[...map.keys()]
    },getConversationId:()=> 'chat-12345678',
    behavior:createTaskIdBehavior(webcrypto)
  });
  assert.ok(ctl.saveAndSend('Old plus panel send'));
  f.queue.attemptSend();
  assert.equal(f.clicked,1);
  assert.equal(f.clickAt-f.insertingAt,0);
});

test('prompt larger than old 64KiB is transferred in bounded, yielding chunks and sent whole', () => {
  const f=setup();
  const original=('Строка 🌐\n'+'абвг'.repeat(15)+'\n').repeat(1400).trim();
  assert.ok(Buffer.byteLength(original,'utf8')>65536);
  const id=f.queue.add(original,{persistent:true});
  assert.ok(id);
  assert.equal(f.queue.sendNow(id,{source:'manual-persisted',minComposerDwellMs:1000}),false);
  assert.ok(f.composer.value.length <=4096,'initial edit must be bounded');
  assert.equal(f.clicked,0);
  for(let i=0;i<Math.ceil(original.length/4095)+8;i++){
    f.tick(30);f.queue.attemptSend();
  }
  assert.equal(f.composer.value,original,'full text must arrive before Send');
  assert.equal(f.clicked,0,'must wait for dwell after last inserted chunk');
  f.tick(1000);f.queue.attemptSend();
  assert.equal(f.clicked,1);
  assert.equal(f.clickBody,original);
});

test('large prompt edited during chunk transfer is not sent by the script', () => {
  const f=setup();
  const original='Hello world 🌐\n'.repeat(5500);
  const id=f.queue.add(original,{persistent:true});
  f.queue.sendNow(id,{source:'manual-persisted',minComposerDwellMs:1000});
  f.tick(25);f.queue.attemptSend();
  const userEdited=f.composer.value+'[редакция пользователя]';
  f.composer.value=userEdited;
  f.tick(30);f.queue.attemptSend();
  assert.equal(f.clicked,0);
  assert.equal(f.composer.value,userEdited);
  assert.equal(f.queue.isWaitingToSend(),false);
  assert.match(f.queue.getLastStatus(),/изменён|занят/,
    'editing abort is reported; persistent source is managed by the durable controller');
});

test('large insertion chunk boundaries keep Unicode surrogate pairs intact', () => {
  const {nextInsertBoundary,NATIVE_INSERT_CHUNK}=require('../src/queued-prompt.js');
  const text='x'.repeat(NATIVE_INSERT_CHUNK-1)+'🌐'+'tail';
  const first=nextInsertBoundary(text,0);
  assert.equal(first,NATIVE_INSERT_CHUNK-1);
  assert.equal(text.slice(0,first)+'|'+text.slice(first),'x'.repeat(NATIVE_INSERT_CHUNK-1)+'|🌐tail');
});

test('rich contenteditable editor receives only bounded chunks before automatic Send', () => {
  let clock=1000,clicked=0,collapsed=false;
  const pastedChunks=[];
  const composer={
    innerText:'',isContentEditable:true,isConnected:true,
    focus(){},dispatchEvent(){return true},getAttribute(){return 'true'}
  };
  const sendButton={click(){clicked++;this.lastBody=composer.innerText;composer.innerText=''}};
  const sandbox={
    ChatGPTTabNotifier:{
      findComposerContext:()=>({composer,container:{},sendButton}),
      isGenerating:()=>false,isSendButtonReady:()=>true
    },
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
    document:{
      createRange:()=>({selectNodeContents(){collapsed=false},collapse(_toStart){collapsed=true}}),
      execCommand(_type,_unused,part){
        pastedChunks.push(part);
        composer.innerText=collapsed?composer.innerText+part:part;
        return true
      }
    },
    Event:class{},InputEvent:class{},
    Date:{now:()=>clock},
    setTimeout(){return 1},clearTimeout(){},
    console:{info(){},warn(){}}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/queued-prompt.js'),'utf8'),sandbox);
  const queue=sandbox.ChatGPTTabNotifier.createQueuedPromptController();
  const original='Точный большой контент 🌐\n'.repeat(3800).trim();
  const id=queue.add(original,{persistent:true});
  assert.equal(queue.sendNow(id,{source:'manual-persisted',minComposerDwellMs:1000}),false);
  for(let k=0;k<original.length/4000+6;k++){clock+=30;queue.attemptSend()}
  assert.equal(composer.innerText,original);
  assert.equal(clicked,0);
  assert.ok(pastedChunks.length>2);
  assert.ok(pastedChunks.every(part=>part.length<=4096));
  clock+=1000;queue.attemptSend();
  assert.equal(clicked,1);
  assert.equal(sendButton.lastBody,original);
});

test('insert-only writes exact content without clicking Send or creating queue items', async () => {
  const f=setup();
  const original='  Точный черновик 🌍\nВторая строка  ';
  const response=await f.queue.insertOnly(original);
  assert.equal(response.ok,true,response.reason);
  assert.equal(f.composer.value,original);
  assert.equal(f.clicked,0);
  assert.equal(f.queue.getCount(),0);
  assert.equal(f.queue.isWaitingToSend(),false);
});

test('insert-only refuses an occupied ChatGPT composer without changing it', async () => {
  const f=setup();
  f.composer.value='Уже введённый чужой текст';
  const answer=await f.queue.insertOnly('Новый черновик');
  assert.equal(answer.ok,false);
  assert.equal(f.composer.value,'Уже введённый чужой текст');
  assert.equal(f.clicked,0);
});

test('insert-only long Unicode prompt is chunked, complete and never sent', async () => {
  const f=setup();
  const original=('Проверка 🌐\n'+'заметка 📘'.repeat(7)+'\n').repeat(1200);
  assert.ok(original.length>12000);
  const answer=await f.queue.insertOnly(original);
  assert.equal(answer.ok,true,answer.reason);
  assert.equal(f.composer.value,original);
  assert.equal(f.clicked,0);
  assert.equal(f.queue.getCount(),0);
  assert.equal(f.queue.isWaitingToSend(),false);
});

test('insert-only rejects concurrent queued sends and preserves native editor', async () => {
  const f=setup();
  const id=f.queue.add('Очередной запрос',{persistent:true});
  f.queue.sendNow(id,{source:'manual-persisted',minComposerDwellMs:1000});
  const before=f.composer.value;
  const answer=await f.queue.insertOnly('Не отправлять');
  assert.equal(answer.ok,false);
  assert.equal(f.composer.value,before);
});

test('insert-only detects whitespace, blank-line and character corruption without Send', async () => {
  const cases = [
    ['A  B', value => value.replace('  ', ' ')],
    ['alpha\n\nbeta', value => value.replace('\n\n', '\n')],
    ['one\ttwo', value => value.replace('\t', ' ')],
    ['one two', value => value.replace(' ', '\u00a0')],
    ['  leading and trailing  ', value => value.trim()],
    ['текст 🌍 без потерь', value => value.replace('🌍', '❌')]
  ];
  for (const [original, transformNativeValue] of cases) {
    const f=setup(1000,{transformNativeValue});
    const answer=await f.queue.insertOnly(original);
    assert.equal(answer.ok,false,'Corruption was accepted: '+JSON.stringify(original));
    assert.match(answer.reason,/не совпала|изменил/);
    assert.equal(f.clicked,0);
    assert.equal(f.queue.getCount(),0);
    assert.notEqual(f.composer.value,original);
  }
});

test('insert-only accepts empty rich composer with structural newline before first character', async () => {
  let clicked=0, execCount=0;
  const editor={
    innerText:'\n',textContent:'',isContentEditable:true,isConnected:true,
    focus(){},dispatchEvent(){return true},getAttribute(){return 'true'}
  };
  const sendButton={click(){clicked++}};
  const sandbox={
    ChatGPTTabNotifier:{
      findComposerContext:()=>({composer:editor,container:{},sendButton}),
      isGenerating:()=>false,isSendButtonReady:()=>true
    },
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
    document:{
      createRange:()=>({selectNodeContents(){},collapse(){}}),
      execCommand(_type,_unused,text){
        execCount++;
        editor.innerText=text;
        editor.textContent=text;
        return true;
      }
    },
    Event:class{},InputEvent:class{},
    setTimeout(callback){queueMicrotask(callback);return 1},clearTimeout(){},
    console:{info(){},warn(){}}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/queued-prompt.js'),'utf8'),sandbox);
  const queue=sandbox.ChatGPTTabNotifier.createQueuedPromptController();
  const original='Проверка  A  B\n\nВторая строка 🌍\nКонец теста.';
  const result=await queue.insertOnly(original);
  assert.equal(result.ok,true,result.reason);
  assert.equal(execCount,1,'structural blank must not stop before first insertion');
  assert.equal(editor.innerText,original);
  assert.equal(clicked,0);
  assert.equal(queue.getCount(),0);
});

test('insert-only never overwrites hidden content behind structural newline', async () => {
  let clicks=0, writes=0;
  const editor={
    innerText:'\n',textContent:'Чужой текст',isContentEditable:true,isConnected:true,
    focus(){},dispatchEvent(){return true},getAttribute(){return 'true'}
  };
  const sandbox={
    ChatGPTTabNotifier:{
      findComposerContext:()=>({composer:editor,container:{},sendButton:{click(){clicks++}}}),
      isGenerating:()=>false
    },
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
    document:{createRange:()=>({selectNodeContents(){},collapse(){}}),
      execCommand(){writes++;return true}},
    Event:class{},InputEvent:class{},
    setTimeout(callback){queueMicrotask(callback);return 1},clearTimeout(){},
    console:{info(){},warn(){}}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/queued-prompt.js'),'utf8'),sandbox);
  const result=await sandbox.ChatGPTTabNotifier.createQueuedPromptController()
    .insertOnly('Новый черновик');
  assert.equal(result.ok,false);
  assert.equal(writes,0);
  assert.equal(clicks,0);
});

test('insert-only rich composer refuses altered newline after actual insertion, no Send', async () => {
  let clicks=0, writes=0;
  const editor={
    innerText:'\n',textContent:'',isContentEditable:true,isConnected:true,
    focus(){},dispatchEvent(){return true},getAttribute(){return 'true'}
  };
  const sandbox={
    ChatGPTTabNotifier:{
      findComposerContext:()=>({composer:editor,container:{},sendButton:{click(){clicks++}}}),
      isGenerating:()=>false
    },
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
    document:{createRange:()=>({selectNodeContents(){},collapse(){}}),
      execCommand(_type,_unused,text){
        writes++;
        editor.innerText=text.replace('\n\n','\n');
        editor.textContent=editor.innerText;
        return true
      }},
    Event:class{},InputEvent:class{},
    setTimeout(callback){queueMicrotask(callback);return 1},clearTimeout(){},
    console:{info(){},warn(){}}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/queued-prompt.js'),'utf8'),sandbox);
  const result=await sandbox.ChatGPTTabNotifier.createQueuedPromptController()
    .insertOnly('A\n\nB');
  assert.equal(result.ok,false);
  assert.equal(writes,1,'insertion was genuinely attempted');
  assert.equal(clicks,0);
});

test('insert-only readiness fails closed on occupied native composer', async()=>{
  const f=setup();
  assert.equal(f.queue.canInsertOnly(),true);
  f.composer.value='Не стирать мой текст';
  assert.equal(f.queue.canInsertOnly(),false);
  assert.equal(f.clicked,0);
});

test('append-only extends a populated native draft without erasing it or clicking Send',async()=>{
  const f=setup();
  f.composer.value='Чужой черновик  A  B\n';
  assert.equal(f.queue.readNativeDraft(),f.composer.value);
  const prefix=f.queue.readNativeDraft();
  const addition='\n\n[Fortis task context]\ntask_id: task_'+'a'.repeat(32);
  const result=await f.queue.appendOnly(addition,prefix);
  assert.equal(result.ok,true,result.reason);
  assert.equal(f.composer.value,prefix+addition);
  assert.equal(f.clicked,0);
  assert.equal(f.queue.getCount(),0);
});

test('append-only refuses if prior editor snapshot changed',async()=>{
  const f=setup();
  f.composer.value='Original';
  const before=f.queue.readNativeDraft();
  f.composer.value='User edited Original';
  const result=await f.queue.appendOnly('\n\nSomething new',before);
  assert.equal(result.ok,false);
  assert.equal(f.composer.value,'User edited Original');
  assert.equal(f.clicked,0);
});

test('append-only fails closed on native text normalization and keeps source',async()=>{
  const f=setup(1000,{transformNativeValue:txt=>txt.replace('  ', ' ')});
  f.composer.value='Previous';
  const prefix=f.queue.readNativeDraft();
  const result=await f.queue.appendOnly('\n\nA  B',prefix);
  assert.equal(result.ok,false);
  assert.match(result.reason,/посимвольно/);
  assert.equal(f.clicked,0);
});

test('File rich-editor paragraph matcher accepts only empty-line layout differences',()=>{
 const {fileContextTextMatches}=require('../src/queued-prompt.js');
 const context='Полный текст в прикреплённом файле fortis-prompt-abc.txt.'+
   '\n\n[Fortis task context]\ntask_id: task_'+'1'.repeat(32)+
   '\nНужна точная инструкция  A  B\n[/Fortis task context]';
 const rich=context.replace(/\n/g,'\n\n').replace('A  B','A\u00a0 B');
 assert.equal(fileContextTextMatches(rich,context),true);
 assert.equal(fileContextTextMatches(context,context),true);
 assert.equal(fileContextTextMatches(rich.replace(/\n/g,'\r\n'),context),true);
 assert.equal(fileContextTextMatches(rich.replace('task_'+ '1'.repeat(32),
   'task_'+ '2'.repeat(32)),context),false,'wrong task ID rejected');
 assert.equal(fileContextTextMatches(rich.replace('fortis-prompt-abc.txt',
   'fortis-prompt-other.txt'),context),false,'different file rejected');
 assert.equal(fileContextTextMatches(rich.replace('Нужна точная инструкция',''),
   context),false,'missing module text rejected');
 assert.equal(fileContextTextMatches(rich.replace('A\u00a0 B','A B'),
   context),false,'lost repeated spaces are a real mismatch');
 assert.equal(fileContextTextMatches(rich.replace('A\u00a0 B','A\t B'),
   context),false,'tab != space');
 assert.equal(fileContextTextMatches(rich+'\n\nExtra command',context),false);
 assert.equal(fileContextTextMatches('',context),false);
 assert.equal(fileContextTextMatches('Just task_id: task_'+ '1'.repeat(32),
   context),false,'task ID alone is not enough');
});

test('File native rich Insert tolerates paragraph rendering while ordinary Insert stays strict',async()=>{
 function richQueue(){
  let clicked=0, isEnd=false;
  const composer={
   innerText:'',isContentEditable:true,isConnected:true,disabled:false,readOnly:false,
   focus(){},dispatchEvent(){},getAttribute:k=>k==='contenteditable'?'true':null,
   textContent:''
  };
  const sandbox={
   ChatGPTTabNotifier:{
    findComposerContext:()=>({composer,container:{},sendButton:{click(){clicked++}}}),
    isGenerating:()=>false,isSendButtonReady:()=>true
   },
   window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
   document:{
    createRange:()=>({selectNodeContents(){isEnd=false},collapse(){isEnd=true}}),
    execCommand(_kind,_silent,part){
      // Simulate actual browser structural paragraph separators in innerText.
      composer.innerText=(isEnd?composer.innerText:'')+part.replace(/\n/g,'\n\n');
      return true;
    }
   },
   Event:class{},InputEvent:class{},setTimeout,clearTimeout,console
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/queued-prompt.js'),'utf8'),sandbox);
  return {queue:sandbox.ChatGPTTabNotifier.createQueuedPromptController(),
          composer,get clicked(){return clicked}};
 }
 const prompt='Полный текст находится в прикреплённом файле.\n\n'+
  '[Fortis task context]\ntask_id: task_'+'1'.repeat(32)+
  '\nВыполни все инструкции.\n[/Fortis task context]';
 const file=richQueue();
 const result=await file.queue.insertOnly(prompt,{fileContext:true});
 assert.equal(result.ok,true,result.reason);
 assert.notEqual(file.composer.innerText,prompt,
   'rich DOM innerText differs byte-for-byte from prepared string');
 assert.equal(file.clicked,0,'no Send by File');
 const ordinary=richQueue();
 const failed=await ordinary.queue.insertOnly(prompt);
 assert.equal(failed.ok,false,'ordinary Insert is NOT weakened');
 assert.match(failed.reason,/посимвольно/);
 assert.equal(ordinary.clicked,0);
 const suffix='\n\nЕщё инструкции\n[Fortis task context]\ntask_id: task_'+
   '2'.repeat(32)+'\n[/Fortis task context]';
 const second=await file.queue.appendOnly(suffix,file.queue.readNativeDraft(),
                                         {fileContext:true});
 assert.equal(second.ok,true,second.reason);
 assert.equal(file.clicked,0);
 assert.equal(file.queue.getCount(),0);
});

test('File rich text mismatch still refuses truncated or tampered context',async()=>{
 const composer={
  innerText:'',isContentEditable:true,isConnected:true,disabled:false,readOnly:false,
  focus(){},dispatchEvent(){},getAttribute:()=> 'true',textContent:''
 };
 const sandbox={
  ChatGPTTabNotifier:{
   findComposerContext:()=>({composer,container:{}}),
   isGenerating:()=>false
  },
  window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
  document:{
   createRange:()=>({selectNodeContents(){},collapse(){}}),
   execCommand(_kind,_silent,part){
    composer.innerText=part.replace('task_id: ', 'task_destroyed: ');
    return true
   }
  },
  Event:class{},InputEvent:class{},setTimeout,clearTimeout,console
 };
 vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync(require.resolve('../src/queued-prompt.js'),'utf8'),sandbox);
 const f=sandbox.ChatGPTTabNotifier.createQueuedPromptController();
 const result=await f.insertOnly('read\n\n[Fortis task context]\ntask_id: task_'+
  'a'.repeat(32),{fileContext:true});
 assert.equal(result.ok,false,'tampered task ID must fail');
 assert.match(result.reason,/посимвольно/);
});
