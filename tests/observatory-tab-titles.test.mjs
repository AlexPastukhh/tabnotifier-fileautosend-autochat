import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const CHAT='synthetic-chat-12345678';
function harness(){
 let clock=1792530000000;
 const requests=[],store=new Map();
 const context={
  URL,Uint8Array,TextEncoder,JSON,console,
  location:{href:'https://chatgpt.com/c/'+CHAT},
  document:{title:'🔵 ✓ Проект Альфа'},
  Date:class extends Date {static now(){return clock}},
  crypto:{getRandomValues:a=>{a.fill(0x42);return a}},
  GM_getValue:(k,d)=>store.has(k)?store.get(k):d,
  GM_setValue:(k,v)=>store.set(k,v),
  GM_xmlhttpRequest:req=>requests.push(req)
 };
 vm.createContext(context);
 for(const name of ['config','task-favicon','title-utils','observatory-completion']){
  vm.runInContext(readFileSync(new URL('../src/'+name+'.js',import.meta.url),'utf8'),context);
 }
 const bridge=context.ChatGPTTabNotifier.createObservatoryCompletionBridge({
  tabState:{getNaturalTitle:()=>context.document.title,getState:()=>''},
  responseMonitor:{},isEnabled:()=>true
 });
 const next=()=>{clock+=8000;bridge.check();return requests.at(-1)};
 const reply=(req,info={ok:true,status:'not_registered',supports_tab_titles:true})=>
  req.onload({status:200,responseText:JSON.stringify(info)});
 return {context,requests,store,bridge,next,reply};
}
test('tab titles require advertised support and do not alter proof or task data',()=>{
 const h=harness(),probe=h.next(),first=JSON.parse(probe.data);
 assert.deepEqual(Object.keys(first).sort(),['chat','proof']);
 h.reply(probe);
 const named=JSON.parse(h.next().data);
 assert.equal(named.title,'Проект Альфа');
 assert.equal(named.chat,CHAT);
 assert.equal(named.proof,first.proof);
 assert.deepEqual(Object.keys(named).sort(),['chat','proof','title']);
 assert.equal(h.store.has('fortis-observatory-v1-pair-'+CHAT),false);
});
test('older Viewer stays on legacy enrollment without title or pairing changes',()=>{
 const h=harness(),probe=h.next();
 h.reply(probe,{ok:true,status:'not_registered'});
 assert.equal(JSON.parse(h.next().data).title,undefined);
});
test('renaming updates only the title and removes status decorations and controls',()=>{
 const h=harness();h.reply(h.next());
 h.context.document.title='🟢 ✓ [Observatory: нет связи] Новый\nпроект\u202e';
 const req=h.next(),body=JSON.parse(req.data);
 assert.equal(body.title,'Новый проект');
 assert.equal(body.chat,CHAT);
 assert.equal(req.url,'http://127.0.0.1:18755/api/notifier/enroll');
});
test('Unicode title length and complete UTF-8 enrollment remain bounded',()=>{
 const h=harness();h.reply(h.next());
 h.context.document.title='🧪'.repeat(500);
 const req=h.next(),body=JSON.parse(req.data);
 assert.equal([...body.title].length,128);
 assert.equal(new TextEncoder().encode(body.title).length,512);
 assert.ok(new TextEncoder().encode(req.data).length<=1024);
});
test('Viewer downgrade falls back on the next normal heartbeat',()=>{
 const h=harness();h.reply(h.next());
 const named=h.next();assert.ok(JSON.parse(named.data).title);
 named.onload({status:403,responseText:'{}'});
 assert.equal(JSON.parse(h.next().data).title,undefined);
});
test('late title-support reply cannot affect a different conversation',()=>{
 const h=harness(),probe=h.next();
 h.context.location.href='https://chatgpt.com/c/another-chat-12345678';
 h.reply(probe);
 const req=h.next(),body=JSON.parse(req.data);
 assert.equal(body.chat,'another-chat-12345678');
 assert.equal(body.title,undefined);
});
