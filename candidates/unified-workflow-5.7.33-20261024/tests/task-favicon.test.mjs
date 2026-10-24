import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {TASK_PALETTE,validateTaskOverview,taskFaviconSvg,resolveTabVisual}=require('../src/task-favicon.js');
const {cleanTitle,faviconSvg}=require('../src/title-utils.js');
const CHAT='12345678-abcd', SID='rs_'+'a'.repeat(32);
const colors={prepared:null,waiting_ai:'yellow',activity_observed:'yellow',working:'blue',silent:'purple',unknown:'purple',completed:'green',failed:'red',blocked:null};
function overview(values={},time=1792530000000,current=Object.keys(values).at(-1)||null){
 const counts=Object.fromEntries(Object.keys(colors).map(k=>[k,values[k]||0]));
 const primary=current;
 return {version:2,basis:'latest_task',available:true,primary_state:primary,primary_color:primary?colors[primary]:null,counts,
 pending_count:counts.waiting_ai+counts.activity_observed,working_count:counts.working,
 silent_count:counts.silent+counts.unknown,blocked_count:counts.blocked,draft_count:counts.prepared,
 completed_count:counts.completed,failed_count:counts.failed,checked_at_unix:time/1000,incomplete:false};
}
function harness({store=new Map(),session=new Map()}={}){
 const state={time:1792530000000,dom:false,enabled:true,starts:0,finishes:0,alerts:[],prompt:null};
 class ClockDate extends Date {static now(){return state.time;}}
 const doc={title:'ChatGPT',links:[],getElementById(id){return doc.links.find(x=>x.id===id)||null;},
 createElement(){return {id:'',rel:'',href:'',remove(){doc.links=doc.links.filter(x=>x!==this);}};}};
 doc.head={appendChild(link){doc.links.push(link);}};
 const native={id:'native',rel:'icon',href:'https://chatgpt.com/favicon.ico'};doc.links.push(native);
 const pair={version:1,origin:'http://127.0.0.1:18755',conversation_id:CHAT,reporting_session_id:SID,observer_key:'o'.repeat(48)};
 if(!store.has('fortis-observatory-v1-pair-'+CHAT))store.set('fortis-observatory-v1-pair-'+CHAT,pair);
 const requests=[];
 const ctx={Date:ClockDate,URL,document:doc,location:{href:'https://chatgpt.com/c/'+CHAT},console,
 sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v)},
 GM_getValue:(k,d)=>store.has(k)?store.get(k):d,GM_setValue:(k,v)=>store.set(k,v),GM_deleteValue:k=>store.delete(k),
 GM_xmlhttpRequest:r=>requests.push(r),crypto:{getRandomValues:arr=>{arr.fill(1);return arr}},
 Uint8Array,alert:m=>state.alerts.push(m),prompt:()=>state.prompt};
 vm.createContext(ctx);
 for(const name of ['config.js','task-favicon.js','title-utils.js','tab-state.js','observatory-completion.js']){
  vm.runInContext(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),ctx);
 }
 const tab=ctx.ChatGPTTabNotifier.createTabStateController({isGenerating:()=>state.dom});
 const bridge=ctx.ChatGPTTabNotifier.createObservatoryCompletionBridge({tabState:tab,isEnabled:()=>state.enabled,
 responseMonitor:{startFromExternal(){state.starts++;tab.setState('observatory-working');return true;},
 finishFromExternal(){state.finishes++;tab.setState('observatory-fresh');return true;}}});
 const gets=()=>requests.filter(r=>r.method==='GET');
 function reply(model=overview({},state.time),fields={},req=gets().at(-1)){
  req.onload({status:200,responseText:JSON.stringify({ok:true,version:1,conversation_id:CHAT,reporting_session_id:SID,
   sequence:-1,event:'none',task_id:null,accepted_unix:null,task_overview:model,...fields})});
 }
 return {state,doc,tab,bridge,ctx,requests,gets,reply,store,session,pair,
 icon:()=>doc.getElementById('chatgpt-tab-notifier-custom-icon'),tick(ms=4000){state.time+=ms;bridge.check();}};
}

test('canonical overview validates all colors and combined work+waiting counts',()=>{
 for(const [state,color] of Object.entries(colors)){
  const raw=overview({[state]:1});const data=validateTaskOverview(raw,1792530000000);
  assert.equal(data.primary_color,color);assert.equal(data.primary_state,state);
 }
 const raw=overview({working:1,waiting_ai:2,failed:1,completed:4});
 assert.equal(validateTaskOverview(raw,1792530000000).pending_count,2);
 assert.equal(validateTaskOverview({...raw,primary_color:'red'},1792530000000),null);
 assert.equal(validateTaskOverview({...raw,pending_count:0},1792530000000),null);
 assert.equal(validateTaskOverview({...raw,counts:{...raw.counts,working:'1'}},1792530000000),null);
 assert.equal(validateTaskOverview({...raw,checked_at_unix:1},1792530000000),null);
 assert.equal(validateTaskOverview({...raw,checked_at_unix:1792530040},1792530000000),null);
});
test('five-color SVGs have no gray, safely reject arbitrary colors and retain independent dots',()=>{
 assert.equal(Object.keys(TASK_PALETTE).length,5);assert.match(faviconSvg('viewed'),/^data:image/);
 assert.equal(taskFaviconSvg({source:'observatory',color:'__proto__'}),'');assert.equal(taskFaviconSvg({source:'observatory',color:'red" onload="boom()'}),'');
 const svg=decodeURIComponent(taskFaviconSvg({source:'observatory',color:'blue',kind:'work',pending:true,unread:true}));
 assert.match(svg,/#60a5fa/);assert.match(svg,/#facc15/);assert.match(svg,/fill="white"/);
 assert.doesNotMatch(svg,/#64748b|gray/);
});
test('new prefix and fixed connection labels are cleaned without accumulating',()=>{
 assert.equal(cleanTitle('🔵 🟡 ● ◌ [Observatory: нет связи] ChatGPT'),'ChatGPT');
 assert.equal(cleanTitle('🟣 ◌ [Observatory: статус устарел] My Chat'),'My Chat');
 assert.equal(cleanTitle('🟢 ✓ Natural title'),'Natural title');
});
test('draft and blocked remain ordinary and older pending does not mark the current working task',()=>{
 const raw=validateTaskOverview(overview({working:1,waiting_ai:2},1792530000000,'working'),1792530000000);
 const v=resolveTabVisual({bound:true,overview:raw,state:'observatory-fresh'});
 assert.equal(v.icon.color,'blue');assert.equal(v.icon.pending,false);assert.equal(v.icon.unread,true);
 for(const state of ['prepared','blocked']){
  const raw=validateTaskOverview(overview({[state]:1}),1792530000000);
  assert.equal(resolveTabVisual({bound:true,overview:raw}).icon,null);
 }
});
test('bound summary colors do not require started or duplicate notification sequence',()=>{
 const h=harness();h.bridge.check();h.reply(overview({working:1},h.state.time),{sequence:0,event:'progress',accepted_unix:h.state.time/1000});
 assert.equal(h.tab.getVisual().icon.color,'blue');assert.equal(h.state.starts,1);
 h.tick();h.reply(overview({silent:1},h.state.time),{sequence:0,event:'progress',accepted_unix:(h.state.time-4000)/1000});
 assert.equal(h.tab.getVisual().icon.color,'purple');assert.equal(h.state.starts,1);
 const done=harness();done.bridge.check();done.reply(overview({completed:1},done.state.time),{sequence:0,event:'completed',accepted_unix:done.state.time/1000});
 assert.equal(done.tab.getVisual().icon.color,'green');assert.equal(done.state.finishes,0,'reload/first terminal read must not replay a notification');
});
test('upload and current-task summary win; DOM is a fallback without a valid summary',()=>{
 const h=harness();h.bridge.check();h.reply(overview({waiting_ai:1},h.state.time));
 h.tab.setState('working');assert.equal(h.tab.getVisual().icon.color,'yellow');
 h.state.dom=true;h.tab.render();assert.equal(h.tab.getVisual().icon.color,'yellow');assert.equal(h.tab.getVisual().icon.kind,'wait');
 h.tab.setUploadMarked(true);assert.equal(h.tab.getVisual().icon.kind,'upload');
 h.tab.setUploadMarked(false);assert.equal(h.tab.getVisual().icon.kind,'wait');
 h.state.enabled=false;h.tick();assert.equal(h.tab.getVisual().icon.kind,'hourglass');
 assert.equal(h.tab.getState(),'working');
});
test('unread indication survives a working summary and markViewed clears only the unread dot',()=>{
 const h=harness();h.bridge.check();h.reply(overview({working:1,waiting_ai:2},h.state.time,'working'));
 h.tab.setState('observatory-fresh');assert.equal(h.tab.getVisual().icon.unread,true);
 h.tab.markViewed();assert.equal(h.tab.getVisual().icon.color,'blue');assert.equal(h.tab.getVisual().icon.pending,false);
 assert.equal(h.tab.getVisual().icon.unread,false);assert.equal(h.tab.getState(),'observatory-viewed');
});
test('a draft removes historical green and leaves native favicon available',()=>{
 const h=harness();h.bridge.check();h.reply(overview({completed:1},h.state.time));assert.ok(h.icon());
 h.tick();h.reply(overview({completed:1,prepared:1},h.state.time));assert.equal(h.icon(),null);
 assert.equal(h.doc.links.length,1);assert.equal(h.doc.links[0].href,'https://chatgpt.com/favicon.ico');
});
test('timeout and denial clear stale AI color with explicit text, never red',()=>{
 for(const failure of ['timeout','denied']){
  const h=harness();h.bridge.check();h.reply(overview({working:1},h.state.time),{sequence:0,event:'progress',accepted_unix:h.state.time/1000});
  h.tick();const req=h.gets().at(-1);
  if(failure==='timeout')req.ontimeout();else req.onload({status:403,responseText:'{}'});
  assert.equal(h.icon(),null);assert.match(h.doc.title,/нет связи|нет доступа/);
  assert.equal(h.tab.getState(),'observatory-working');
 }
});
test('a hung poll expires color after 20s without launching overlapping reads',()=>{
 const h=harness();h.bridge.check();h.reply(overview({working:1},h.state.time),{sequence:0,event:'progress',accepted_unix:h.state.time/1000});
 h.tick();const total=h.gets().length;h.tick(21000);
 assert.equal(h.gets().length,total);assert.equal(h.icon(),null);assert.match(h.doc.title,/статус устарел/);
});
test('chat switch rejects old response and old callback cannot clear a newer request token',()=>{
 const h=harness();h.bridge.check();const old=h.gets().at(-1);
 const chat2='another-chat-12345678',sid2='rs_'+'b'.repeat(32);
 h.ctx.location.href='https://chatgpt.com/c/'+chat2;
 h.store.set('fortis-observatory-v1-pair-'+chat2,{...h.pair,conversation_id:chat2,reporting_session_id:sid2});
 h.tick();const next=h.gets().at(-1);assert.notEqual(old,next);
 h.reply(overview({failed:1},h.state.time),{},old);assert.equal(h.icon(),null);
 const count=h.gets().length;h.tick();assert.equal(h.gets().length,count);
 h.reply(overview({waiting_ai:1},h.state.time),{conversation_id:chat2,reporting_session_id:sid2},next);
 assert.equal(h.tab.getVisual().icon.color,'yellow');
});
test('unpair and key rotation reject responses for the earlier binding',()=>{
 const h=harness();h.bridge.check();const old=h.gets().at(-1);
 h.state.prompt=JSON.stringify({...h.pair,observer_key:'n'.repeat(48)});h.bridge.pairCurrent();
 const fresh=h.gets().at(-1);assert.notEqual(old,fresh);
 h.reply(overview({failed:1},h.state.time),{},old);assert.equal(h.icon(),null);
 h.reply(overview({working:1},h.state.time),{},fresh);assert.equal(h.tab.getVisual().icon.color,'blue');
 h.bridge.unpairCurrent();assert.equal(h.icon(),null);assert.doesNotMatch(h.doc.title,/нет связи|нет доступа/);
});
test('summary is never restored from sessionStorage after reload',()=>{
 const h=harness();h.bridge.check();h.reply(overview({working:1},h.state.time));h.tab.save();
 assert.doesNotMatch([...h.session.values()].join(''),/task_overview|primary_color|observer_key/);
 const reloaded=harness({store:h.store,session:h.session});assert.equal(reloaded.tab.getVisual().icon,null);
});
test('disabled Observatory mode keeps DOM notifications, and old API has an explicit neutral fallback',()=>{
 const h=harness();h.bridge.check();h.reply(overview({working:1},h.state.time));h.state.enabled=false;h.tick();
 assert.equal(h.icon(),null);assert.doesNotMatch(h.doc.title,/нет связи/);
 h.tab.setState('fresh');assert.equal(h.tab.getVisual().icon.kind,'check');assert.equal(h.tab.getVisual().icon.color,null);assert.equal(h.tab.getVisual().icon.source,'dom');
 const old=harness();old.bridge.check();old.reply(undefined,{task_overview:undefined});
 assert.equal(old.icon(),null);assert.match(old.doc.title,/старый API/);
});
test('invalid or incomplete summary never injects SVG or claims a failure',()=>{
 const h=harness();h.bridge.check();h.reply({...overview({working:1},h.state.time),primary_color:'red" onload="boom()'});
 assert.equal(h.icon(),null);assert.match(h.doc.title,/нет связи/);
 h.tick();h.reply({...overview({working:1},h.state.time),incomplete:true});
 assert.equal(h.tab.getVisual().icon.color,'blue');assert.match(h.doc.title,/неполная сводка/);
 assert.equal(h.gets().every(r=>!r.url.includes('original_text')&&!r.data),true);
 assert.equal(h.requests.some(r=>r.url.includes('/api/dispatch')||r.url.includes('/api/user-messages')),false);
});

test('latest completed remains green despite historical silence, failure, pending and older DOM activity',()=>{
 const h=harness();h.bridge.check();h.reply(overview({unknown:1,working:1,waiting_ai:2,failed:1,completed:1},h.state.time,'completed'));
 h.state.dom=true;h.tab.setState('working');
 assert.equal(h.tab.getVisual().icon.color,'green');assert.equal(h.tab.getVisual().icon.pending,false);
 h.tick();h.reply(overview({unknown:1,working:1,completed:1,prepared:1},h.state.time,'prepared'));
 assert.equal(h.tab.getVisual().icon.source,'dom');assert.equal(h.tab.getVisual().icon.color,null);
});
test('v1 aggregated overview is explicitly unsupported rather than treated as current task',()=>{
 const h=harness();h.bridge.check();h.reply({...overview({working:1},h.state.time),version:1});
 assert.equal(h.icon(),null);assert.match(h.doc.title,/старый API/);
});

test('DOM-only hourglass and check never use Observatory palette colors',()=>{
 const h=harness();h.state.enabled=false;h.bridge.check();
 for(const [state,kind] of [['working','hourglass'],['fresh','check'],['viewed','check']]){
  h.tab.setState(state);const spec=h.tab.getVisual().icon;
  assert.equal(spec.source,'dom');assert.equal(spec.kind,kind);assert.equal(spec.color,null);
  const svg=decodeURIComponent(h.icon().href);
  for(const color of Object.values(TASK_PALETTE))assert.ok(!svg.includes(color));
  assert.match(h.doc.title,kind==='hourglass'?/⏳/:/✓/);
 }
 for(const state of ['observatory-working','observatory-fresh','observatory-viewed']){
  assert.equal(faviconSvg(state),'');
 }
});
test('Observatory current-task color and DOM shape coexist without equating their completion',()=>{
 const h=harness();h.bridge.check();h.reply(overview({working:1},h.state.time));
 h.tab.setState('fresh');
 assert.equal(h.tab.getVisual().icon.source,'observatory');assert.equal(h.tab.getVisual().icon.color,'blue');
 assert.match(h.doc.title,/🔵.*✓.*●/);
 h.tab.markViewed();assert.match(h.doc.title,/🔵.*✓/);assert.doesNotMatch(h.doc.title,/●/);
 h.tick();h.gets().at(-1).ontimeout();
 assert.equal(h.tab.getVisual().icon.source,'dom');assert.equal(h.tab.getVisual().icon.color,null);
 assert.match(h.doc.title,/✓.*нет связи/);
});
test('local upload is monochrome and cannot masquerade as blue Observatory work',()=>{
 const h=harness();h.tab.setUploadMarked(true);
 assert.equal(h.tab.getVisual().icon.source,'local');assert.equal(h.tab.getVisual().icon.kind,'upload');
 const svg=decodeURIComponent(h.icon().href);
 for(const color of Object.values(TASK_PALETTE))assert.ok(!svg.includes(color));
});

test('reported completion never hides simultaneously observed ChatGPT generation',()=>{
 const raw=validateTaskOverview(overview({completed:1},1792530000000),1792530000000);
 const v=resolveTabVisual({bound:true,overview:raw,state:'working',domGenerating:true});
 assert.equal(v.icon.color,'green');
 assert.match(v.symbol,/ChatGPT: генерация наблюдается/);
 assert.equal(cleanTitle(v.symbol+' Natural Chat'), 'Natural Chat');
});
