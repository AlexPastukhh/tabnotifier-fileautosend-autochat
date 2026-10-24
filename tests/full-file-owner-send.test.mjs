import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';

const require=createRequire(import.meta.url);
const {createTaskIdBehavior,createPersistentMessageController}=
  require('../src/persisted-messages.js');
const {createPromptTextFile}=require('../src/upload-button-ui.js');
const original='Вопрос 🌍  A  B\n\nКонец с пробелами  \n\n';
const chat='6adb63dd-d8f0-83ed-90a1-1c1cf39a8cd2';
const session='rs_'+'a'.repeat(32);
const fileName='fortis-prompt-candidate.txt';

function makeController(){
  const records=new Map();
  const controller=createPersistentMessageController({
    queue:{isWaitingToSend:()=>false},
    storage:{get:k=>records.get(k)||null,
      set:(k,v)=>{records.set(k,JSON.parse(JSON.stringify(v)))},
      list:()=>[...records.keys()]},
    getConversationId:()=>chat,
    getPairing:()=>({conversation_id:chat,reporting_session_id:session,
      origin:'http://127.0.0.1:18755'}),
    behavior:createTaskIdBehavior(webcrypto),
    now:()=>1234567890
  });
  return controller;
}

test('full File contains raw bytes, complete task context and all module text',()=>{
  const controller=makeController();
  const modules='МОДУЛЬ-ПРОВЕРКА\n'+('инструкция 🔎'.repeat(3000));
  const prepared=controller.prepareDraft(original,{mode:'file',
    fileName,extraText:modules});
  assert.match(prepared.task_id,/^task_[0-9a-f]{32}$/);
  assert.ok(prepared.file_text.startsWith(original+'\n\n'));
  assert.ok(prepared.file_text.endsWith(modules));
  assert.match(prepared.file_text,/Маркер пользователя/);
  assert.match(prepared.file_text,/reporting_session_id:/);
  assert.match(prepared.file_text,new RegExp('task_id: '+prepared.task_id));
  assert.ok(!prepared.submitted_text.includes('МОДУЛЬ-ПРОВЕРКА'));
  assert.ok(!prepared.submitted_text.includes('Маркер пользователя'));
  assert.ok(prepared.submitted_text.length<600);
  const stored=controller.load(prepared.task_id);
  assert.equal(stored.original_text,original);
  assert.equal(stored.send_status,'draft');
  assert.ok(!('file_text' in stored),'GM record only needs original and short pointer');
  class FakeFile{
    constructor(chunks,name,options){
      this.text=chunks.join('');this.name=name;this.type=options.type;
      this.size=Buffer.byteLength(this.text,'utf8');
    }
  }
  const attached=createPromptTextFile(prepared.file_text,fileName,FakeFile);
  assert.equal(attached.text,prepared.file_text);
  assert.equal(attached.size,Buffer.byteLength(prepared.file_text,'utf8'));
  assert.equal(controller.recordManualDraftSend(prepared.submitted_text),null,
    'no file evidence means no Send transition');
  assert.equal(controller.recordManualDraftSend(prepared.submitted_text,
    {fileNameVisible:()=>true}),prepared.task_id);
  assert.equal(controller.recordManualDraftSend(prepared.submitted_text,
    {fileNameVisible:()=>true}),null,'never claim same draft twice');
});

test('owner Send is Full File + one gated native click, ordinary File never Sends',()=>{
  const source=fs.readFileSync(require.resolve('../src/upload-button-ui.js'),'utf8');
  const handler=source.slice(source.indexOf('handleQuickDispatch = async function'),
    source.indexOf("ui.quickSend.addEventListener('click'"));
  assert.match(handler,/if\(mode==='file'\)return handleQuickFile\(text,moduleIds,profileId\)/);
  assert.match(handler,/if\(mode==='send_prepared'\)return sendPreparedNative\(\)/);
  assert.match(handler,/if\(mode==='insert'\)return handleQuickInsert/);
  assert.match(handler,/if\(typeof existing!=='string'\|\|existing.trim\(\)\)/);
  assert.match(handler,/const prepared=await handleQuickFile\(text,moduleIds,profileId\)/);
  assert.match(handler,/if\(!prepared\?\.ok\)/);
  assert.match(handler,/return sendPreparedNative\(prepared.taskId\)/);
  const prepare=source.slice(source.indexOf('function sendPreparedNative('),
    source.indexOf('handleQuickDispatch = async function'));
  assert.match(prepare,/fileVisible/);
  assert.match(prepare,/expectedTaskId !== null && taskId !== expectedTaskId/);
  assert.match(prepare,/if\(committed!==taskId\)return/);
  assert.equal((prepare.match(/button\.click\(\)/g)||[]).length,1);
  const file=source.slice(source.indexOf('async function handleQuickFile('),
    source.indexOf("ui.quickFile.addEventListener('click'"));
  assert.doesNotMatch(file,/sendPreparedNative\(/);
  assert.match(file,/createPromptTextFile\(record\.file_text,fileName\)/);
});
