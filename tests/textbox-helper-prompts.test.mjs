import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require=createRequire(import.meta.url);
const {createTextboxProfileManager,normalizeProfiles,resolveSelectedText,TEXTBOX_PROFILE_STORAGE_KEY,SHARED_MODULE_CHANNEL}=require('../src/textbox-module-profiles.js');
const {createHelperModuleChannel}=require('../../obs-planning-docs/planning/documentation/tools/tampermonkey/chat-command-palette/src/shared-module-channel.js');
const {createPersistentMessageController,createTaskIdBehavior}=require('../src/persisted-messages.js');

class Channel {
  static all=new Set();
  constructor(name){this.name=name;Channel.all.add(this);}
  addEventListener(type,fn){if(type==='message')this.onmessage=fn;}
  postMessage(data){for(const peer of Channel.all)if(peer!==this&&peer.name===this.name)peer.onmessage?.({data:structuredClone(data)});}
  close(){Channel.all.delete(this);}
}
const item=(kind,id,text,title=id)=>({item:{kind,id,text,title},repositorySha:'not-shared',token:'not-shared'});
async function fixture(t,stored){
  const gm=new Map(stored?[[TEXTBOX_PROFILE_STORAGE_KEY,JSON.stringify(stored)]]:[]);
  const state={helperItems:[item('prompt','review','Начни [[module:rules]].','Обзор 🧪'),item('module','rules','с проверки'),item('module','extra','Затем отчёт'),item('command','hidden','Never publish')]};
  const helper=createHelperModuleChannel({Channel,readSnapshot:async()=>state});
  const manager=createTextboxProfileManager({Channel,getValue:(k,d)=>gm.get(k)??d,setValue:(k,v)=>gm.set(k,v)});
  t.after(()=>{helper.close();manager.close();});
  await helper.publish();
  return {gm,state,helper,manager};
}
test('real Helper prompt and nested module complement original; GM stores only selected prompt ID',async t=>{
  const f=await fixture(t);
  assert.deepEqual(f.manager.getPromptCatalog(),[{id:'review',title:'Обзор 🧪',text:'Начни [[module:rules]].'}]);
  f.manager.setPrompt('review');f.manager.addModule('extra');
  const original='  исходник\r\n🧪  ';
  const prepared=f.manager.prepare(original);
  assert.equal(prepared.original,original);
  assert.equal(prepared.extraText,'Начни с проверки.\n\nЗатем отчёт');
  const saved=f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY);
  assert.equal(JSON.parse(saved).profiles[0].promptId,'review');
  assert.doesNotMatch(saved,/Начни|с проверки|not-shared/);
  const clone=f.manager.getPromptCatalog();clone[0].text='tampered';
  assert.equal(f.manager.prepare(original).extraText,prepared.extraText);
  const reload=createTextboxProfileManager({Channel,getValue:(k,d)=>f.gm.get(k)??d,setValue:(k,v)=>f.gm.set(k,v)});
  t.after(()=>reload.close());await f.helper.publish();
  assert.equal(reload.prepare(original).extraText,prepared.extraText);
});
test('prompt ID is per profile; remote module override preserves selected profile prompt without editing GM',async t=>{
  const f=await fixture(t);f.manager.setPrompt('review');
  const alternate=f.manager.createProfile('Пустой');
  const before=f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY);
  assert.equal(f.manager.prepare('Q').extraText,'');
  assert.equal(f.manager.prepareForProfile('Q','default',[]).extraText,'Начни с проверки.');
  assert.equal(f.manager.prepareForProfile('Q','default',['extra']).extraText,'Начни с проверки.\n\nЗатем отчёт');
  assert.equal(f.manager.getActive().id,alternate);
  assert.equal(f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY),before);
  f.manager.setActive('default');f.manager.setPrompt(null);
  assert.equal(f.manager.prepare('Q').extraText,'');
});
test('prompt updates use current Helper body; deletion and unavailable Helper block incomplete preparation',async t=>{
  const f=await fixture(t);f.manager.setPrompt('review');
  f.state.helperItems[0].item.text='Новый [[module:rules]]';
  await f.helper.publish();assert.equal(f.manager.prepare('Q').extraText,'Новый с проверки');
  f.state.helperItems=f.state.helperItems.filter(p=>p.item.kind!=='prompt');
  await f.helper.publish();assert.throws(()=>f.manager.prepare('Q'),/Нет локального промпта/);
  assert.equal(f.manager.getActive().promptId,'review');
  const offline=createTextboxProfileManager({Channel:null,getValue:(k,d)=>f.gm.get(k)??d,setValue:(k,v)=>f.gm.set(k,v)});
  t.after(()=>offline.close());assert.throws(()=>offline.prepare('Q'),/не подключён/);
  offline.setPrompt(null);assert.equal(offline.prepare('Q').extraText,'');
});
test('missing references, cycles and unknown prompt cannot partially change the saved profile',async t=>{
  const f=await fixture(t);f.manager.setPrompt('review');
  const before=f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY);
  assert.throws(()=>f.manager.setPrompt('missing'),/Нет локального промпта/);
  f.state.helperItems[0].item.text='[[module:missing]]';await f.helper.publish();
  assert.throws(()=>f.manager.setPrompt('review'),/Нет локального модуля/);
  f.state.helperItems[0].item.text='[[module:rules]]';
  f.state.helperItems[1].item.text='[[module:rules]]';await f.helper.publish();
  assert.throws(()=>f.manager.prepare('Q'),/Цикл ссылок/);
  assert.equal(f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY),before);
});
test('old catalog works for modules, but cannot silently discard a selected prompt',async t=>{
  const f=await fixture(t);f.manager.setPrompt('review');
  // A fresh page that has only received legacy packets must remain compatible
  // for modules, while refusing its persisted prompt until Helper upgrades.
  f.manager.close();
  f.manager=createTextboxProfileManager({Channel,getValue:(k,d)=>f.gm.get(k)??d,setValue:(k,v)=>f.gm.set(k,v)});
  t.after(()=>f.manager.close());
  const oldHelper=new Channel(SHARED_MODULE_CHANNEL);t.after(()=>oldHelper.close());
  oldHelper.postMessage({protocol:SHARED_MODULE_CHANNEL,type:'catalog',modules:[{id:'extra',title:'Extra',text:'legacy'}]});
  assert.equal(f.manager.getPromptCatalog(),null);
  assert.throws(()=>f.manager.prepare('Q'),/не передал каталог промптов/);
  f.manager.setPrompt(null);f.manager.addModule('extra');
  assert.equal(f.manager.prepare('Q').extraText,'legacy');
});
test('legacy profile keeps behavior and module order; invalid prompt fields fail closed',()=>{
  const legacy={version:1,active:'a',profiles:[{id:'a',name:'Old',moduleIds:['b','a'],behavior:{'native-send-dwell':false}}]};
  const out=normalizeProfiles(legacy);
  assert.deepEqual(out.profiles[0].moduleIds,['b','a']);
  assert.equal(out.profiles[0].behavior['native-send-dwell'],false);
  assert.equal(out.profiles[0].promptId,undefined);
  for(const id of ['',7,{},['x'],'../path','[[module:x]]']){
    assert.throws(()=>normalizeProfiles({...legacy,profiles:[{...legacy.profiles[0],promptId:id}]}),/BAD_PROFILE_PROMPT/);
  }
});
test('malformed prompt catalog clears prior bodies; valid packet recovers without GM writes',async t=>{
  const f=await fixture(t);f.manager.setPrompt('review');const before=f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY);
  const peer=new Channel(SHARED_MODULE_CHANNEL);t.after(()=>peer.close());
  for(const prompts of [null,{},[{id:'x',title:'X',text:42}],[{id:'x',title:'X',text:'a'},{id:'x',title:'Y',text:'b'}]]){
    peer.postMessage({protocol:SHARED_MODULE_CHANNEL,type:'catalog',modules:[],prompts});
    assert.equal(f.manager.isConnected(),false);assert.equal(f.manager.getPromptCatalog(),null);
    assert.throws(()=>f.manager.prepare('Q'),/не подключён/);
    await f.helper.publish();assert.equal(f.manager.prepare('Q').extraText,'Начни с проверки.');
  }
  assert.equal(f.gm.get(TEXTBOX_PROFILE_STORAGE_KEY),before);
});
test('bounded prompt expansion rejects repeated nested output and combined overflow',()=>{
  const modules=[{id:'large',title:'Large',text:'x'.repeat(60000)}];
  assert.throws(()=>resolveSelectedText({promptId:'p',moduleIds:[]},modules,[{id:'p',text:'[[module:large]][[module:large]]'}]),/Слишком длинный/);
  assert.throws(()=>resolveSelectedText({promptId:'p',moduleIds:['large']},modules,[{id:'p',text:'y'.repeat(60000)}]),/Слишком длинный/);
});
test('selecting a prompt only stores references; actual preparation preserves archived original bytes',async t=>{
  const f=await fixture(t);const data=new Map(),queued=[];
  const ctl=createPersistentMessageController({behavior:createTaskIdBehavior(webcrypto),getConversationId:()=> 'chat-12345678',
    storage:{set:(k,v)=>data.set(k,structuredClone(v)),get:k=>structuredClone(data.get(k)||null),list:()=>[...data.keys()]},
    queue:{isWaitingToSend:()=>false,add:text=>{queued.push(text);return 'q1';},sendNow:()=>true,remove:()=>{}}});
  f.manager.setPrompt('review');assert.equal(data.size,0);assert.equal(queued.length,0);
  const p=f.manager.prepare('  точный оригинал 🧪  ');
  const id=ctl.saveAndSend(p.original,{extraText:p.extraText});
  assert.ok(id);assert.equal(ctl.load(id).original_text,p.original);
  assert.match(queued[0],/Начни с проверки\./);assert.match(queued[0],new RegExp('task_id: '+id));
});
