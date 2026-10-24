import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createSessionDispatchMonitor,validDispatchPair} = require('../src/observatory-dispatch.js');
const sid='rs_'+'a'.repeat(32), chat='abcdefgh-01234567';
const id='dispatch_'+'b'.repeat(32), task='task_'+'c'.repeat(32);
const pair={version:1,origin:'http://127.0.0.1:18755',
  reporting_session_id:sid,conversation_id:chat,dispatch_key:'d'.repeat(48)};

function setup({editorText='',storedStatus='send_queued',busy=false,generate=false}={}){
  let active=chat;
  let pairing={...pair};
  let value=editorText;
  let sends=0,inserts=0;
  const calls=[];
  let clock=5000;
  const context={composer:{isConnected:true,disabled:false,readOnly:false,
    get value(){return value},set value(x){value=x}}};
  const messages={
    saveAndSend(original,options){
      sends++;this.lastOriginal=original;this.lastOptions=options;return task
    },
    listForChat:()=>[{task_id:task,send_status:storedStatus}]
  };
  const queue={
    isWaitingToSend:()=>busy,isInsertingOnly:()=>false,
    async insertOnly(text){inserts++;value=text;return {ok:true}}
  };
  const monitor=createSessionDispatchMonitor({
    getPairing:()=>pairing,getConversationId:()=>active,
    request:args=>calls.push(args),queue,messages,
    profiles:{prepare:()=>({minComposerDwellMs:1000,extraText:'helper'})},
    findComposerContext:()=>context,
    isGenerating:()=>generate,
    now:()=>clock
  });
  async function deliver(mode,text='Большой промпт 🌍'){
    assert.equal(monitor.check(),true);
    const poll=calls.find(x=>x.method==='GET');
    assert.ok(poll);
    poll.onload({status:200,responseText:JSON.stringify({
      ok:true,session:sid,chat,command:{dispatch_id:id,mode,text}
    })});
    // Two microtasks permit the async action to resolve and acknowledge.
    await new Promise(resolve=>setImmediate(resolve));
    return calls.find(x=>x.method==='POST');
  }
  return {monitor,calls,deliver,messages,
    get value(){return value},get inserts(){return inserts},get sends(){return sends},
    setChat:x=>{active=x},setPair:x=>{pairing=x},advance:ms=>{clock+=ms}};
}

test('dispatch pairing is a separate capability, scoped to owner Viewer and Chat ID',()=>{
  assert.equal(validDispatchPair(pair,chat),true);
  assert.equal(validDispatchPair({...pair,dispatch_key:undefined},chat),false);
  assert.equal(validDispatchPair({...pair,dispatch_key:'short'},chat),false);
  assert.equal(validDispatchPair({...pair,origin:'http://127.0.0.1:18754'},chat),false);
  assert.equal(validDispatchPair(pair,'other-chat'),false);
  const t=setup();t.setPair({...pair,dispatch_key:undefined});
  assert.equal(t.monitor.check(),false);
  assert.equal(t.calls.length,0);
});

test('insert-only from owner is an editable draft without task creation or Send',async()=>{
  const t=setup();
  const request=await t.deliver('insert','Начало 🧪\nКонец');
  assert.equal(t.inserts,1);assert.equal(t.sends,0);
  assert.equal(t.value,'Начало 🧪\nКонец');
  assert.equal(request.url,pair.origin+'/api/dispatch/ack');
  assert.equal(request.headers['X-Fortis-Dispatch-Key'],pair.dispatch_key);
  assert.deepEqual(JSON.parse(request.data),{
    session:sid,chat,dispatch_id:id,status:'inserted',task_id:null
  });
});

test('send command uses existing task pipeline and reports initiation, not acceptance',async()=>{
  const t=setup();
  const request=await t.deliver('send','Отправить строго в этот чат');
  assert.equal(t.sends,1);
  assert.equal(t.messages.lastOriginal,'Отправить строго в этот чат');
  assert.equal(t.messages.lastOptions.extraText,'helper');
  assert.equal(t.inserts,0);
  assert.equal(JSON.parse(request.data).task_id,task);
  assert.equal(JSON.parse(request.data).status,'send_initiated');
  assert.equal(t.calls.filter(x=>x.method==='GET').length,1);
});

test('occupied composer or missing verified queued record refuses automatic Send',async()=>{
  const a=setup({editorText:'Чужой несохранённый черновик'});
  const ack=await a.deliver('send','Новый текст');
  assert.equal(a.sends,0);
  assert.equal(a.value,'Чужой несохранённый черновик');
  assert.equal(JSON.parse(ack.data).status,'refused');
  const b=setup({storedStatus:'send_failed'});
  const failed=await b.deliver('send','Оригинал');
  assert.equal(b.sends,1);
  assert.equal(JSON.parse(failed.data).status,'refused');
  assert.equal(JSON.parse(failed.data).task_id,null);
});

test('switched chat before HTTP response cannot process cross-session command',async()=>{
  const t=setup();
  assert.equal(t.monitor.check(),true);
  t.setChat('other-chat');
  t.calls[0].onload({status:200,responseText:JSON.stringify({
    ok:true,session:sid,chat,command:{dispatch_id:id,mode:'send',text:'Ошибка адреса'}
  })});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(t.sends,0);
  assert.equal(t.calls.length,1);
});

test('duplicate network callback is not delivered twice even if response repeated',async()=>{
  const t=setup();
  t.monitor.check();
  const reply={status:200,responseText:JSON.stringify({
    ok:true,session:sid,chat,command:{dispatch_id:id,mode:'send',text:'Один раз'}
  })};
  t.calls[0].onload(reply);
  t.calls[0].onload(reply);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(t.sends,1);
  assert.equal(t.calls.filter(x=>x.method==='POST').length,1);
});

test('owner File reuses Notifier quick File action, one claimed dispatch and no Send',async()=>{
  const calls=[],ops=[];
  const monitor=createSessionDispatchMonitor({
    getPairing:()=>pair,getConversationId:()=>chat,
    request:x=>calls.push(x),now:()=>50000,
    findComposerContext:()=>({composer:{isConnected:true,value:''}}),
    canExecute:()=>true,
    profiles:{getCatalog:()=>[
      {id:'policy.verification',title:'Проверка',text:'секретное содержимое'}
    ],getActive:()=>({moduleIds:['policy.verification']}),
      getProfiles:()=>({active:'repo',profiles:[
        {id:'default',name:'Обычный',moduleIds:[],behavior:{}},
        {id:'repo',name:'Работа с Repo',moduleIds:['policy.verification'],behavior:{}}
      ]})},
    quickAction:async x=>{ops.push(x);return {ok:true,taskId:task}}
  });
  assert.equal(monitor.check(),true);
  const sync=calls.find(x=>x.url.endsWith('/api/dispatch/modules'));
  assert.ok(sync,'catalog metadata provided under scoped dispatch key');
  assert.equal(sync.headers['X-Fortis-Dispatch-Key'],pair.dispatch_key);
  const data=JSON.parse(sync.data);
  assert.equal(data.default_module_ids[0],'policy.verification');
  assert.equal(data.active_profile_id,'repo');
  assert.equal(data.profiles.length,2);
  assert.deepEqual(data.profiles[1],{id:'repo',name:'Работа с Repo',
    module_ids:['policy.verification']});
  assert.deepEqual(data.modules,[{id:'policy.verification',title:'Проверка'}]);
  assert.doesNotMatch(sync.data,/секретное содержимое/);
  const poll=calls.find(x=>x.url.includes('/api/dispatch/poll?'));
  const payload={ok:true,session:sid,chat,command:{
    dispatch_id:id,mode:'file',text:'Оригинал файла',
    module_ids:['policy.verification']
  }};
  poll.onload({status:200,responseText:JSON.stringify(payload)});
  poll.onload({status:200,responseText:JSON.stringify(payload)});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ops.length,1,'duplicate callbacks never trigger two File actions');
  assert.equal(ops[0].mode,'file');
  assert.equal(ops[0].text,'Оригинал файла');
  assert.deepEqual(ops[0].moduleIds,['policy.verification']);
  const ack=calls.filter(x=>x.url.endsWith('/api/dispatch/ack'));
  assert.equal(ack.length,1);
  assert.equal(JSON.parse(ack[0].data).status,'file_attached');
  assert.equal(JSON.parse(ack[0].data).task_id,task);
});

test('owner Insert with explicit empty module list cannot send',async()=>{
  const calls=[],ops=[];
  const monitor=createSessionDispatchMonitor({
    getPairing:()=>pair,getConversationId:()=>chat,
    request:x=>calls.push(x),now:()=>100000,
    findComposerContext:()=>({composer:{isConnected:true,value:''}}),
    canExecute:()=>true,
    quickAction:async opts=>{ops.push(opts);return {ok:true,taskId:task}}
  });
  monitor.check();
  const poll=calls.find(x=>x.url.includes('/api/dispatch/poll?'));
  poll.onload({status:200,responseText:JSON.stringify({ok:true,session:sid,chat,command:{
    dispatch_id:id,mode:'insert',text:'Вставить без Send',module_ids:[]}})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ops.length,1);
  assert.deepEqual(ops[0].moduleIds,[]);
  const ack=calls.find(x=>x.url.endsWith('/api/dispatch/ack'));
  assert.equal(JSON.parse(ack.data).status,'inserted');
  assert.equal(JSON.parse(ack.data).task_id,task);
});

test('owner Send refuses occupied native composer before invoking Notifier action',async()=>{
  const calls=[],ops=[];
  const monitor=createSessionDispatchMonitor({
    getPairing:()=>pair,getConversationId:()=>chat,
    request:x=>calls.push(x),now:()=>110000,
    findComposerContext:()=>({composer:{isConnected:true,value:'Чужой черновик'}}),
    canExecute:()=>true,quickAction:async x=>{ops.push(x);return {ok:true,taskId:task}}
  });
  monitor.check();
  const poll=calls.find(x=>x.url.includes('/api/dispatch/poll?'));
  poll.onload({status:200,responseText:JSON.stringify({ok:true,session:sid,chat,command:{
    dispatch_id:id,mode:'send',text:'Отправить',module_ids:[]}})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ops.length,0);
  assert.equal(JSON.parse(calls.find(x=>x.url.endsWith('/api/dispatch/ack')).data).status,'refused');
});

test('owner profile ID arrives to identical File/Insert pipeline without changing native GM profile',async()=>{
 const calls=[],ops=[];
 const monitor=createSessionDispatchMonitor({
  getPairing:()=>pair,getConversationId:()=>chat,request:x=>calls.push(x),now:()=>35000,
  profiles:{
   getProfiles:()=>({active:'second',profiles:[
    {id:'default',name:'Обычный',moduleIds:['policy.verification']},
    {id:'second',name:'Рабочий',moduleIds:['review.summary']}
   ]}),
   getCatalog:()=>[
    {id:'policy.verification',title:'Проверка',text:'PRIVATETEXT'},
    {id:'review.summary',title:'Обзор',text:'SECRET'}
   ]
  },
  findComposerContext:()=>({composer:{isConnected:true,value:''}}),
  canExecute:()=>true,
  quickAction:async args=>{ops.push(args);return {ok:true,taskId:task}}
 });
 monitor.check();
 const meta=calls.find(x=>x.url.endsWith('/api/dispatch/modules'));
 assert.ok(meta);
 const body=JSON.parse(meta.data);
 assert.equal(body.profiles.length,2);
 assert.deepEqual(body.profiles[0],{id:'default',name:'Обычный',
   module_ids:['policy.verification']});
 assert.equal(body.active_profile_id,'second');
 assert.doesNotMatch(meta.data,/PRIVATETEXT|SECRET|observer_key|dispatch_key/);
 const poll=calls.find(x=>x.url.includes('/api/dispatch/poll?'));
 poll.onload({status:200,responseText:JSON.stringify({
  ok:true,session:sid,chat,command:{dispatch_id:id,mode:'insert',
  text:'Вставить без Send',module_ids:null,profile_id:'default'}
 })});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ops.length,1);
 assert.equal(ops[0].profileId,'default');
 assert.equal(ops[0].moduleIds,null,'Notifier resolves modules and behaviors from saved profile');
 assert.equal(ops[0].mode,'insert');
 assert.equal(JSON.parse(calls.find(x=>x.url.endsWith('/api/dispatch/ack')).data).status,'inserted');
});

test('separate prepared Send uses existing saved task and never creates a second draft',async()=>{
 const calls=[],actions=[];
 const monitor=createSessionDispatchMonitor({
  getPairing:()=>pair,getConversationId:()=>chat,request:x=>calls.push(x),now:()=>129000,
  findComposerContext:()=>({composer:{isConnected:true,value:'Уже подготовленный Fortis контекст'}}),
  canExecute:()=>true,
  quickAction:async args=>{actions.push(args);return {ok:true,taskId:task}}
 });
 assert.equal(monitor.check(),true);
 const poll=calls.find(x=>x.url.includes('/api/dispatch/poll?'));
 const payload={ok:true,session:sid,chat,command:{
  dispatch_id:id,mode:'send_prepared',text:'',module_ids:null,profile_id:null}};
 poll.onload({status:200,responseText:JSON.stringify(payload)});
 poll.onload({status:200,responseText:JSON.stringify(payload)});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(actions,[{mode:'send_prepared',text:'',moduleIds:null,profileId:null}]);
 const acks=calls.filter(x=>x.url.endsWith('/api/dispatch/ack'));
 assert.equal(acks.length,1);
 assert.equal(JSON.parse(acks[0].data).status,'send_initiated');
 assert.equal(JSON.parse(acks[0].data).task_id,task);
});

test('failed prepared Send yields safe structured refusal, not optimistic Send',async()=>{
 const calls=[];
 const monitor=createSessionDispatchMonitor({
  getPairing:()=>pair,getConversationId:()=>chat,request:x=>calls.push(x),now:()=>139000,
  findComposerContext:()=>({composer:{isConnected:true,value:'пустой Fortis draft'}}),
  canExecute:()=>true,
  quickAction:async()=>({ok:false,reason:'prepared_missing'})
 });
 monitor.check();
 const poll=calls.find(x=>x.url.includes('/api/dispatch/poll?'));
 poll.onload({status:200,responseText:JSON.stringify({ok:true,session:sid,chat,command:{
  dispatch_id:id,mode:'send_prepared',text:'',module_ids:null,profile_id:null}})});
 await new Promise(resolve=>setImmediate(resolve));
 const ack=JSON.parse(calls.find(x=>x.url.endsWith('/api/dispatch/ack')).data);
 assert.equal(ack.status,'refused');
 assert.equal(ack.reason,'prepared_missing');
 assert.equal(ack.task_id,null);
});

test('ambiguous file upload is NOT a complete refusal; user may already have the attachment',async()=>{
 const requests=[],hits=[];
 const monitor=createSessionDispatchMonitor({
  getPairing:()=>pair,getConversationId:()=>chat,request:req=>requests.push(req),now:()=>180000,
  findComposerContext:()=>({composer:{isConnected:true,value:''}}),canExecute:()=>true,
  quickAction:async args=>{hits.push(args);return {
   ok:false,reason:'upload_unconfirmed',
   attachmentAttempted:true,attachmentConfirmed:false}}
 });
 monitor.check();
 const poll=requests.find(req=>req.url.includes('/api/dispatch/poll?'));
 poll.onload({status:200,responseText:JSON.stringify({
  ok:true,session:sid,chat,command:{dispatch_id:id,mode:'file',
   text:'unique filename',module_ids:null,profile_id:null}
 })});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(hits.length,1,'exactly one file operation');
 const ack=requests.filter(req=>req.url.endsWith('/api/dispatch/ack'));
 assert.equal(ack.length,1);
 assert.equal(JSON.parse(ack[0].data).status,'attachment_unconfirmed');
 assert.equal(JSON.parse(ack[0].data).reason,'upload_unconfirmed');
 assert.equal(JSON.parse(ack[0].data).task_id,null);
});

test('confirmed file card but missing context is attachment only, never a prepared task',async()=>{
 const requests=[];
 const monitor=createSessionDispatchMonitor({
  getPairing:()=>pair,getConversationId:()=>chat,request:req=>requests.push(req),now:()=>190000,
  findComposerContext:()=>({composer:{isConnected:true,value:''}}),canExecute:()=>true,
  quickAction:async()=>({ok:false,reason:'context_mismatch',
    attachmentAttempted:true,attachmentConfirmed:true})
 });
 monitor.check();
 requests.find(req=>req.url.includes('/api/dispatch/poll?')).onload({
  status:200,responseText:JSON.stringify({ok:true,session:sid,chat,
   command:{dispatch_id:id,mode:'file',text:'one file',
    module_ids:null,profile_id:null}})});
 await new Promise(resolve=>setImmediate(resolve));
 const ack=JSON.parse(requests.find(req=>req.url.endsWith('/api/dispatch/ack')).data);
 assert.equal(ack.status,'attachment_only');
 assert.equal(ack.reason,'context_mismatch');
 assert.equal(ack.task_id,null);
});

test('Notifier full file warning propagates without collapsing to context_mismatch',async()=>{
 const calls=[];
 const detail='Файл прикреплён, но контекст не добавлен: '+
  'Вставка не совпала с исходником посимвольно. '+
  'Исходник сохранён; Send не нажимался. Не отправляй до ручной проверки.';
 const monitor=createSessionDispatchMonitor({
  getPairing:()=>pair,getConversationId:()=>chat,request:x=>calls.push(x),now:()=>202000,
  findComposerContext:()=>({composer:{isConnected:true,value:''}}),
  quickAction:async()=>({ok:false,reason:'context_mismatch',detail,
   attachmentAttempted:true,attachmentConfirmed:true})
 });
 monitor.check();
 calls.find(x=>x.url.includes('/api/dispatch/poll?')).onload({
   status:200,responseText:JSON.stringify({
     ok:true,session:sid,chat,
     command:{dispatch_id:id,mode:'file',text:'unique source',
              module_ids:null,profile_id:null}})
 });
 await new Promise(resolve=>setImmediate(resolve));
 const ack=JSON.parse(calls.find(x=>x.url.endsWith('/api/dispatch/ack')).data);
 assert.equal(ack.status,'attachment_only');
 assert.equal(ack.reason,'context_mismatch');
 assert.equal(ack.task_id,null);
 assert.equal(ack.detail,detail);
 const stringify=JSON.stringify(ack);
 assert.doesNotMatch(stringify,/unique source/);
});
