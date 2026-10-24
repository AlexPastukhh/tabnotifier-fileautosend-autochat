import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = process.env.BROWSER_BINARY;
if (!browser) throw Error('Set BROWSER_BINARY to a local Chromium executable.');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'notifier-layout-'));
const artifactDir = process.env.LAYOUT_ARTIFACT_DIR || work;
fs.mkdirSync(artifactDir, {recursive:true});
const scripts = ['config.js', 'chatgpt-dom.js', 'textbox-settings-ui.js', 'upload-button-ui.js']
  .map(name => '<script>' + fs.readFileSync(path.join(root, 'src', name), 'utf8') + '</script>').join('\n');
const fixture = `<!doctype html><meta charset="utf-8"><title>Notifier layout fixture</title>
<style>body{margin:0;background:#090909;color:#fff;font-family:system-ui}</style>
${scripts}
<script>
window.mutations=0;
window.errors=[];
window.addEventListener('error',e=>errors.push(e.message));
const api=window.ChatGPTTabNotifier;
if(!localStorage.getItem(api.FLOATING_UI_POSITION_KEY))
 localStorage.setItem(api.FLOATING_UI_POSITION_KEY,JSON.stringify({left:72,top:120}));
window.fixture=api.createUploadButtonUi({
 tabState:{isUploadMarked:()=>false},
 uploadController:{isArmed:()=>false,isConfirmingSend:()=>false,toggle:()=>mutations++},
 queuedPromptController:{getItems:()=>[],getPendingIds:()=>[],getCount:()=>0,
   getLastStatus:()=>'',isWaitingToSend:()=>false,readNativeDraft:()=>'',
   insertOnly:()=>{mutations++;return {ok:false}}},
 delayedSendController:{isCheckpointActive:()=>false,getDelayMs:()=>300000,
   getDelayMinutes:()=>5,getCheckpointText:()=>'',getLastStatus:()=>'',getItems:()=>[]},
 persistentMessageController:{listForChat:()=>[],saveAndSend:()=>{mutations++;return null}},
 taskActivityMonitor:null,textboxProfileManager:null
});
fixture.render();
window.addEventListener('resize',()=>fixture.render());
window.ready=true;
</script>`;
const html = path.join(work, 'fixture.html');
fs.writeFileSync(html, fixture);
const child=spawn(browser,['--no-sandbox','--headless','--disable-gpu',
 '--remote-debugging-port=0','--user-data-dir='+path.join(work,'profile'),'about:blank'],
 {stdio:['ignore','ignore','pipe']});
let stderr='';child.stderr.on('data',b=>stderr+=b);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws;
try {
 let port;
 for(let i=0;i<70;i++){
  const active=path.join(work,'profile','DevToolsActivePort');
  if(fs.existsSync(active)){port=Number(fs.readFileSync(active,'utf8').split('\n')[0]);break}
  if(child.exitCode!==null)throw Error('Chromium exited: '+stderr.slice(-1200));
  await delay(100);
 }
 if(!port)throw Error('Chromium did not expose a local test page.');
 const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 const pending=new Map();let sequence=0;
 ws.onmessage=e=>{const r=JSON.parse(e.data);if(!r.id)return;const p=pending.get(r.id);
  if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result)}};
 function cdp(method,params={}){return new Promise((resolve,reject)=>{
  const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
 async function evaluate(expression){
  const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
 }
 async function ready(){
  for(let i=0;i<50;i++){if(await evaluate('window.ready===true'))return;await delay(100)}
  throw Error('UI fixture did not initialize: '+await evaluate('JSON.stringify(window.errors)'));
 }
 const shadow="document.getElementById('chatgpt-tab-notifier-upload-host').shadowRoot";
 async function center(selector){return evaluate(`(()=>{const r=${shadow}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)}
 async function click(selector){const point=await center(selector);
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
 async function metrics(){return evaluate(`(()=>{const h=document.getElementById('chatgpt-tab-notifier-upload-host'),s=h.shadowRoot;
  const r=h.getBoundingClientRect(),b=s.querySelector('.quick-send'),br=b.getBoundingClientRect(),c=s.querySelector('.quick-compose').getBoundingClientRect();
  return {x:r.x,y:r.y,width:r.width,height:r.height,collapsed:h.dataset.textboxCollapsed,
   input:s.querySelector('.quick-input').value,layout:(()=>{try{return JSON.parse(localStorage.getItem(ChatGPTTabNotifier.FLOATING_UI_LAYOUT_KEY)||'null')}catch{return null}})(),
   buttonFits:b.scrollWidth<=b.clientWidth&&b.scrollHeight<=b.clientHeight&&br.bottom<=c.bottom&&br.right<=c.right,
   mutations:window.mutations,errors:window.errors};})()`)}
 async function shot(name){const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(artifactDir,name+'.png'),Buffer.from(r.data,'base64'));}
 await cdp('Page.enable');await cdp('Runtime.enable');
 await cdp('Emulation.setDeviceMetricsOverride',{width:960,height:720,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:pathToFileURL(html).href});await ready();
 assert.equal((await metrics()).buttonFits,true,'Prepared Send must fit its button and composer');
 await evaluate(`${shadow}.querySelector('.quick-input').value='Сохранённый черновик'`);
 await click('.textbox-toggle');
 let m=await metrics();assert.equal(m.collapsed,'true');assert.equal(m.input,'Сохранённый черновик');
 assert.equal(m.layout.collapsed,true);assert.equal(m.mutations,0);
 await shot('collapsed');
 await cdp('Page.reload');await ready();assert.equal((await metrics()).collapsed,'true');
 await click('.textbox-toggle');
 const start=await center('.quick-resize');
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...start});
 await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:start.x+180,y:start.y+100});
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:start.x+180,y:start.y+100});
 m=await metrics();assert.equal(m.width,602);assert.equal(m.height,212);assert.equal(m.buttonFits,true);
 await cdp('Page.reload');await ready();m=await metrics();
 assert.equal(m.width,602);assert.equal(m.height,212);assert.equal(m.collapsed,'false');
 await shot('expanded');
 await evaluate(`${shadow}.querySelector('.quick-resize').focus()`);
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
 await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
 assert.equal((await metrics()).height,228,'Keyboard resize must work without Send');
 await cdp('Emulation.setDeviceMetricsOverride',{width:320,height:360,deviceScaleFactor:1,mobile:false});
 await evaluate('fixture.render()');m=await metrics();
 assert.ok(m.x>=0&&m.y>=0&&m.x+m.width<=320&&m.y+m.height<=360);
 assert.equal(m.layout.width,602,'Viewport adaptation must not overwrite preferred size');
 assert.equal(m.buttonFits,true);await shot('narrow');
 await cdp('Emulation.setDeviceMetricsOverride',{width:960,height:720,deviceScaleFactor:1,mobile:false});
 await evaluate('fixture.render()');assert.equal((await metrics()).width,602);
 await click('.quick-file');
 assert.equal(await evaluate(`${shadow}.querySelector('.quick-feedback').hidden`),false);
 await evaluate(`${shadow}.querySelector('.quick-feedback-text').textContent='Одна попытка прикрепления (input) выполнена, но ChatGPT не подтвердил карточку. Возможно, файл уже добавлен. Второй попытки НЕ делаю; проверь вложения вручную. Send не нажат.';fixture.render()`);
 await shot('feedback');
 await click('.quick-feedback-close');
 await evaluate('fixture.render();fixture.render()');
 assert.equal(await evaluate(`${shadow}.querySelector('.quick-feedback').hidden`),true);
 assert.equal(await evaluate(`${shadow}.querySelectorAll('.quick-feedback-close').length`),1);
 await click('.quick-file');
 assert.equal(await evaluate(`${shadow}.querySelector('.quick-feedback').hidden`),false,'A fresh notification must be visible after dismissal');
 await click('.quick-feedback-close');
 m=await metrics();assert.equal(m.mutations,0);assert.deepEqual(m.errors,[]);
 await evaluate(`localStorage.setItem(ChatGPTTabNotifier.FLOATING_UI_LAYOUT_KEY,'{bad-json')`);
 await cdp('Page.reload');await ready();m=await metrics();
 assert.equal(m.width,422);assert.equal(m.height,112);assert.equal(m.collapsed,'false');
 console.log(JSON.stringify({passed:true,checks:['send-layout','collapse-draft-retention','collapse-reload',
  'pointer-resize','size-reload','keyboard-resize','narrow-viewport','preferences-retained',
  'dismiss-feedback','fresh-feedback','zero-send-side-effects','invalid-preferences'],artifactDir}));
} finally {ws?.close();child.kill();}
