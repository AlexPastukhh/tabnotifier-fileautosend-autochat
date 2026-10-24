import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
const require=createRequire(import.meta.url);
const {createTextboxProfileManager,resolveSelectedText,
  TEXTBOX_PROFILE_STORAGE_KEY}=require('../src/textbox-module-profiles.js');
const {createTaskIdBehavior,createPersistentMessageController}=
  require('../src/persisted-messages.js');

class TestChannel {
  static all=new Set();
  constructor(name){this.name=name;this.closed=false;TestChannel.all.add(this);}
  addEventListener(type,fn){if(type==='message')this.onmessage=fn;}
  postMessage(data){
    for(const c of TestChannel.all)if(c!==this&&!c.closed&&c.name===this.name)
      c.onmessage?.({data:structuredClone(data)});
  }
  close(){this.closed=true;TestChannel.all.delete(this);}
}
function setup(){
  TestChannel.all.clear();
  const gm=new Map();
  const manager=createTextboxProfileManager({
    getValue:(key,fallback)=>gm.get(key) ?? fallback,
    setValue:(key,value)=>gm.set(key,value),
    Channel:TestChannel
  });
  const helper=new TestChannel('fortis-shared-helper-text-modules-v1');
  let list=[
    {id:'review.summary',title:'Обзор',text:'Сформируй обзор [[module:policy.verification]].'},
    {id:'policy.verification',title:'Проверка',text:'Проверяй результат через Fortis Repo.'}
  ];
  helper.onmessage=e=>{
    if(e.data?.type==='request')helper.postMessage({
      protocol:'fortis-shared-helper-text-modules-v1',type:'catalog',modules:list});
  };
  return {manager,gm,publish(modules){
    list=modules;
    helper.postMessage({protocol:'fortis-shared-helper-text-modules-v1',
      type:'catalog',modules:list});
  },helper};
}

test('Notifier reads modules from Helper only and stores profile references, not module text',()=>{
  const f=setup();
  assert.equal(f.manager.getCatalog(),null);
  f.manager.requestCatalog();
  assert.equal(f.manager.isConnected(),true);
  const id=f.manager.createProfile('Работа в Repo');
  assert.ok(id.startsWith('p'));
  f.manager.addModule('review.summary');
  const composed=f.manager.prepare('  пользователь 🧪  ');
  assert.equal(composed.original,'  пользователь 🧪  ');
  assert.match(composed.extraText,/Сформируй обзор Проверяй результат через Fortis Repo\./);
  const disk=String(f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY));
  assert.ok(disk.includes('review.summary'));
  assert.ok(disk.includes('Работа в Repo'));
  assert.ok(!disk.includes('Сформируй обзор'));
  assert.ok(!disk.includes('Проверяй результат'));
  f.manager.close();f.helper.close();
});

test('AI proposal: paste multiple existing Helper module references and attach atomically',()=>{
  const f=setup();
  f.manager.requestCatalog();
  const before=f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY);
  const inserted=f.manager.addModulesByReferences(
    '[[module:review.summary]], [[module:policy.verification]]');
  assert.deepEqual(inserted,['review.summary','policy.verification']);
  assert.deepEqual(f.manager.getActive().moduleIds,inserted);
  const disk=f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY);
  assert.ok(disk.includes('review.summary'));
  assert.doesNotMatch(disk,/Сформируй обзор/);
  assert.deepEqual(f.manager.addModulesByReferences('review.summary'),[]);
  assert.deepEqual(f.manager.getActive().moduleIds,inserted);
  assert.throws(()=>f.manager.addModulesByReferences(
    'review.summary, nonexistent.module'),/Нет локального модуля/);
  assert.deepEqual(f.manager.getActive().moduleIds,inserted);
  assert.throws(()=>f.manager.addModulesByReferences(
    '[[module:review.summary]]; process.exit(1)'),/Неверная ссылка/);
  assert.deepEqual(f.manager.getActive().moduleIds,inserted);
  assert.throws(()=>f.manager.addModulesByReferences(
    'review.summary '.repeat(21)),/максимум 20/);
  f.manager.close();f.helper.close();
});

test('AI proposal validates nested dependencies and refuses partial GM mutation',()=>{
  const f=setup();
  f.manager.requestCatalog();
  f.publish([{id:'review.summary',title:'broken',text:'[[module:unknown.ref]]'},
    {id:'policy.verification',title:'safe',text:'Works'}]);
  const old=f.manager.getActive().moduleIds;
  assert.throws(()=>f.manager.addModulesByReferences(
    'policy.verification review.summary'),/Нет локального модуля/);
  assert.deepEqual(f.manager.getActive().moduleIds,old);
  assert.equal(f.gm.size,0);
  f.manager.close();f.helper.close();
});

test('Helper local save and GitHub Sync missing publish update into existing Notifier profile',()=>{
  const f=setup();f.manager.requestCatalog();
  f.manager.addModule('review.summary');
  f.publish([
    {id:'review.summary',title:'Изменено в Helper',text:'GitHub Sync: [[module:policy.verification]]'},
    {id:'policy.verification',title:'Проверка',text:'НОВАЯ версия после GitHub.'},
    {id:'new.github.module',title:'Загружен из GitHub',text:'Импортировано в Helper'}
  ]);
  assert.match(f.manager.prepare('вопрос').extraText,/НОВАЯ версия после GitHub/);
  f.manager.addModule('new.github.module');
  assert.match(f.manager.prepare('вопрос').extraText,/Импортировано в Helper/);
  f.manager.close();f.helper.close();
});

test('missing, cyclic and unavailable module fail closed before Send',()=>{
  const f=setup();
  f.manager.requestCatalog();f.manager.addModule('review.summary');
  f.publish([{id:'policy.verification',title:'broken',text:'...'}]);
  assert.throws(()=>f.manager.prepare('request'),/Нет локального модуля/);
  f.publish([
    {id:'review.summary',title:'A',text:'[[module:policy.verification]]'},
    {id:'policy.verification',title:'B',text:'[[module:review.summary]]'}]);
  assert.throws(()=>f.manager.prepare('request'),/Цикл ссылок/);
  f.manager.close();
  // Without a Helper channel, cached module bodies must not be available.
  const offline=createTextboxProfileManager({
    getValue:(key,fallback)=>f.gm.get(key)??fallback,
    setValue:(key,value)=>f.gm.set(key,value),Channel:null
  });
  assert.throws(()=>offline.prepare('request'),/не подключён/);
  f.helper.close();
});

test('per-profile behavior switches change only new textbox submit options',()=>{
  const f=setup();
  f.manager.createProfile('Быстро');
  f.manager.setBehavior('native-send-dwell',false);
  f.manager.setBehavior('focus-after-send',false);
  const prepared=f.manager.prepare('Hello');
  assert.equal(prepared.minComposerDwellMs,0);
  assert.equal(prepared.focusAfterSend,false);
  assert.throws(()=>f.manager.setBehavior('task-id',false),/нельзя переключить/);
  f.manager.setActive('default');
  assert.equal(f.manager.prepare('Hello').minComposerDwellMs,1000);
  f.manager.close();f.helper.close();
});

test('GM failure rejects profile mutation without losing in-memory selection',()=>{
  const m=createTextboxProfileManager({
    getValue:()=>null,
    setValue:()=>{throw new Error('quota')},Channel:null
  });
  assert.throws(()=>m.createProfile('Fail'),/quota/);
  assert.equal(m.getProfiles().profiles.length,1);
  m.close();
});

test('corrupt stored profiles cannot be overwritten after Helper catalog update',()=>{
  const raw=new Map([[TEXTBOX_PROFILE_STORAGE_KEY,'{invalid json']]);
  const manager=createTextboxProfileManager({
    getValue:(k,d)=>raw.get(k)??d,
    setValue:(k,v)=>raw.set(k,v),Channel:TestChannel
  });
  const helper=new TestChannel('fortis-shared-helper-text-modules-v1');
  helper.postMessage({protocol:'fortis-shared-helper-text-modules-v1',
    type:'catalog',modules:[{id:'valid',title:'Valid',text:'ready'}]});
  assert.ok(manager.getCatalog());
  assert.throws(()=>manager.createProfile('Should not overwrite'),/повреждённые профили/);
  assert.throws(()=>manager.prepare('test'),/Профили не прочитаны/);
  assert.equal(raw.get(TEXTBOX_PROFILE_STORAGE_KEY),'{invalid json');
  manager.close();helper.close();
});

test('fourth gear mounted only once and retained through UI redraw',()=>{
  const source=fs.readFileSync(require.resolve('../src/upload-button-ui.js'),'utf8');
  const panel=fs.readFileSync(require.resolve('../src/textbox-settings-ui.js'),'utf8');
  assert.match(source,/settingsUi: host.__fortisTextboxSettings \|\| null/);
  assert.match(source,/host.__fortisTextboxSettings=ui.settingsUi/);
  assert.match(source,/ui.settingsUi\?\.render\(\)/);
  assert.match(panel,/\.auto-stack/);
  assert.match(panel,/\.settings-button/);
  assert.match(panel,/manager\?\.requestCatalog\(\)/);
  assert.match(panel,/module-search/);
  assert.doesNotMatch(panel,/createModule\(|editModule\(|saveModule\(|github\.com/);
});

test('full original remains exact while helper module text augments only submitted copy',()=>{
  const f=setup();f.manager.requestCatalog();f.manager.addModule('review.summary');
  const composed=f.manager.prepare('  мой исходник 🧪  ');
  const data=new Map(),sent=[];
  const ctl=createPersistentMessageController({
    behavior:createTaskIdBehavior(webcrypto),
    getConversationId:()=> 'chat-12345678',
    storage:{set:(k,v)=>data.set(k,structuredClone(v)),get:k=>structuredClone(data.get(k)||null),
      list:()=>[...data.keys()]},
    queue:{
      isWaitingToSend:()=>false,
      add(text){sent.push(text);return 'q1';},
      sendNow:()=>true,remove:()=>{}
    }
  });
  const id=ctl.saveAndSend(composed.original,{extraText:composed.extraText,
    minComposerDwellMs:composed.minComposerDwellMs});
  assert.ok(id);
  assert.equal(ctl.load(id).original_text,'  мой исходник 🧪  ');
  assert.match(sent[0],/Сформируй обзор Проверяй результат через Fortis Repo\./);
  assert.match(sent[0],new RegExp('task_id: '+id));
  assert.ok(!ctl.load(id).original_text.includes('Сформируй обзор'));
  f.manager.close();f.helper.close();
});

test('UI is a module selector, not a second text module editor or GitHub client',()=>{
  const ui=fs.readFileSync(require.resolve('../src/textbox-settings-ui.js'),'utf8');
  assert.match(ui,/Текстовые модули создаются и редактируются только в Planning Helper/);
  assert.match(ui,/manager\.addModule/);
  assert.match(ui,/manager\.createProfile/);
  assert.match(ui,/manager\.setBehavior/);
  assert.doesNotMatch(ui,/saveModule\(|editModule\(|createModule\(|GM_xmlhttpRequest|github\.com/);
  const floating=fs.readFileSync(require.resolve('../src/upload-button-ui.js'),'utf8');
  assert.match(floating,/mountTextboxSettings/);
  for(const role of ['delay-send','queue','auto-send'])assert.match(floating,new RegExp('data-role="'+role+'"'));
});

test('owner-selected module IDs resolve through same Planning Helper without mutating active profile',()=>{
 const f=setup();f.manager.requestCatalog();
 const activeBefore=f.manager.getActive();
 const out=f.manager.prepareForModules('Проверить', ['review.summary']);
 assert.match(out.extraText,/Сформируй обзор Проверяй результат через Fortis Repo/);
 assert.deepEqual(f.manager.getActive(),activeBefore);
 const none=f.manager.prepareForModules('Проверить', []);
 assert.doesNotMatch(none.extraText,/Сформируй обзор/);
 assert.throws(()=>f.manager.prepareForModules('текст',['unknown.module']),/недоступны в Planning Helper/);
 assert.throws(()=>f.manager.prepareForModules('текст',['policy.verification','policy.verification']),/Неверный список/);
 assert.deepEqual(f.manager.getActive(),activeBefore);
 f.manager.close();f.helper.close();
});

test('Observatory chooses the same real Notifier profile and its behavior without changing active GM',()=>{
 const f=setup();f.manager.requestCatalog();
 f.manager.addModule('policy.verification');
 const usual=f.manager.getProfiles().active;
 const alternate=f.manager.createProfile('Без задержки');
 f.manager.addModule('review.summary');
 f.manager.setBehavior('native-send-dwell',false);
 f.manager.setBehavior('focus-after-send',false);
 const gmBefore=f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY);
 const fromViewer=f.manager.prepareForProfile('Проверка A',usual,null);
 assert.equal(fromViewer.minComposerDwellMs,1000);
 assert.equal(fromViewer.focusAfterSend,true);
 assert.match(fromViewer.extraText,/Проверяй результат через Fortis Repo/);
 assert.doesNotMatch(fromViewer.extraText,/Сформируй обзор/);
 const alt=f.manager.prepareForProfile('Проверка B',alternate,null);
 assert.equal(alt.minComposerDwellMs,0);
 assert.equal(alt.focusAfterSend,false);
 assert.match(alt.extraText,/Сформируй обзор/);
 assert.equal(f.manager.getProfiles().active,alternate,'Viewer selection does not edit Notifier active profile');
 assert.equal(f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY),gmBefore,'no GM profile modifications');
 const override=f.manager.prepareForProfile('Проверка C',usual,['review.summary']);
 assert.match(override.extraText,/Сформируй обзор/);
 assert.equal(override.minComposerDwellMs,1000,'module override never changes selected behavior');
 assert.throws(()=>f.manager.prepareForProfile('текст','not-saved'),/больше не существует/);
 assert.equal(f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY),gmBefore);
 f.manager.close();f.helper.close();
});
