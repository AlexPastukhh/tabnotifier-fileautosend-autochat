import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {createTextboxProfileManager,SHARED_MODULE_CHANNEL}=require('../src/textbox-module-profiles.js');
const {createHelperModuleChannel}=require('../../obs-planning-docs/planning/documentation/tools/tampermonkey/chat-command-palette/src/shared-module-channel.js');
class Channel {
  static all=new Set();
  constructor(name){this.name=name;Channel.all.add(this);}
  addEventListener(_,fn){this.onmessage=fn;}
  postMessage(data){for(const peer of Channel.all)if(peer!==this&&peer.name===this.name)peer.onmessage?.({data:structuredClone(data)});}
  close(){Channel.all.delete(this);}
}
function setup(t){
  const gm=new Map(),manager=createTextboxProfileManager({Channel,getValue:(k,d)=>gm.get(k)??d,setValue:(k,v)=>gm.set(k,v)});
  const legacy=new Channel(SHARED_MODULE_CHANNEL);
  const state={helperItems:[{item:{kind:'module',id:'rules',title:'Rules',text:'Current rules'}},{item:{kind:'prompt',id:'review',title:'Review',text:'Prompt [[module:rules]]'}}]};
  const modern=createHelperModuleChannel({Channel,readSnapshot:async()=>state});
  const oldPacket=()=>legacy.postMessage({protocol:SHARED_MODULE_CHANNEL,type:'catalog',modules:[{id:'old',title:'Old',text:'Legacy-only rules'}]});
  t.after(()=>{manager.close();legacy.close();modern.close();});
  return {manager,legacy,modern,state,gm,oldPacket};
}
test('package and displayed Notifier version agree',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(require('../src/config.js').SCRIPT_VERSION,pkg.version);
});
test('updated Helper then old tab reply must not erase prompt catalog or mix module bodies',async t=>{
  const f=setup(t);await f.modern.publish();f.manager.setPrompt('review');
  const before=f.manager.getCatalog(),disk=[...f.gm];
  f.oldPacket();
  assert.equal(f.manager.getPromptCatalog()?.[0]?.id,'review');
  assert.deepEqual(f.manager.getCatalog(),before);
  assert.equal(f.manager.prepare('Q').extraText,'Prompt Current rules');
  assert.deepEqual([...f.gm],disk);
});
test('legacy-first startup upgrades to full catalog; subsequent modern edits/deletions remain authoritative',async t=>{
  const f=setup(t);f.oldPacket();
  assert.equal(f.manager.getPromptCatalog(),null);assert.equal(f.manager.getCatalog()[0].id,'old');
  await f.modern.publish();f.manager.setPrompt('review');f.oldPacket();
  assert.equal(f.manager.prepare('Q').extraText,'Prompt Current rules');
  f.state.helperItems[0].item.text='Edited current rules';await f.modern.publish();f.oldPacket();
  assert.equal(f.manager.prepare('Q').extraText,'Prompt Edited current rules');
  f.state.helperItems=[];await f.modern.publish();f.oldPacket();
  assert.deepEqual(f.manager.getPromptCatalog(),[]);assert.deepEqual(f.manager.getCatalog(),[]);
  assert.throws(()=>f.manager.prepare('Q'),/Нет локального промпта/);
});
test('invalid modern packet stays blocked after legacy reply until valid modern recovery',async t=>{
  const f=setup(t);await f.modern.publish();f.manager.setPrompt('review');
  f.legacy.postMessage({protocol:SHARED_MODULE_CHANNEL,type:'catalog',modules:[],prompts:null});
  assert.equal(f.manager.isConnected(),false);f.oldPacket();
  assert.equal(f.manager.isConnected(),false);assert.equal(f.manager.getCatalog(),null);
  assert.throws(()=>f.manager.prepare('Q'),/не подключён/);
  await f.modern.publish();assert.equal(f.manager.prepare('Q').extraText,'Prompt Current rules');
});


test('build and build:check reject a stale runtime version before publishing a bundle',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fortis-version-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  fs.mkdirSync(path.join(temp,'src'));
  fs.copyFileSync(new URL('../build-userscript.mjs',import.meta.url),path.join(temp,'build-userscript.mjs'));
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({version:'1.2.3'}));
  fs.writeFileSync(path.join(temp,'src/config.js'),"const SCRIPT_VERSION = '1.2.2';");
  for(const args of [[],['--check']]){
    const result=spawnSync(process.execPath,[path.join(temp,'build-userscript.mjs'),...args],{encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/runtime version must match package.json/);
    assert.equal(fs.existsSync(path.join(temp,'chatgpt-tab-notifier.user.js')),false);
  }
});
