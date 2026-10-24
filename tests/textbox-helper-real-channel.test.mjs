import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const {createTextboxProfileManager,SHARED_MODULE_CHANNEL}=
  require('../src/textbox-module-profiles.js');

const myDir=path.dirname(fileURLToPath(import.meta.url));
const helperSource=path.resolve(myDir,
  '../../obs-planning-docs/planning/documentation/tools/tampermonkey/chat-command-palette/src/shared-module-channel.js');
const helperAvailable=existsSync(helperSource);
const {createHelperModuleChannel}=helperAvailable?require(helperSource):{};

class Channel{
  static open=new Set();
  constructor(name){this.name=name;this.closed=false;Channel.open.add(this);}
  addEventListener(type,listener){if(type==='message')this.onmessage=listener;}
  postMessage(payload){
    for(const peer of Channel.open){
      if(peer!==this&&!peer.closed&&peer.name===this.name)
        peer.onmessage?.({data:structuredClone(payload)});
    }
  }
  close(){this.closed=true;Channel.open.delete(this);}
}
test('real Helper publisher → real Notifier consumer → profile IDs → reloaded GitHub module',
  {skip:!helperAvailable},async()=>{
  assert.equal(SHARED_MODULE_CHANNEL,'fortis-shared-helper-text-modules-v1');
  const gm=new Map();
  let items=[{
    item:{kind:'module',id:'live.helper.module',title:'Первоначальный текст',
      text:'Проверь и отчитайся.',createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T00:00:00Z'},
    repositoryKnown:false
  }];
  const publisher=createHelperModuleChannel({
    Channel,readSnapshot:async()=>({schemaVersion:9,helperItems:items})
  });
  const notifier=createTextboxProfileManager({
    getValue:(key,other)=>gm.get(key)??other,
    setValue:(key,value)=>gm.set(key,value),
    Channel
  });
  notifier.requestCatalog();
  await publisher.publish();
  assert.equal(notifier.getCatalog()?.[0]?.id,'live.helper.module');
  notifier.addModule('live.helper.module');
  assert.equal(notifier.prepare('Вопрос').extraText,'Проверь и отчитайся.');
  // Simulate normal Planning Helper verified local edit, then Github Reload GitHub
  items=[{...items[0],item:{...items[0].item,text:'Новый текст после Save/Sync GitHub'},
    repositoryKnown:true,repositorySha:'git_verified_sha'}];
  await publisher.publish();
  assert.equal(notifier.prepare('Вопрос').extraText,'Новый текст после Save/Sync GitHub');
  const profileDisk=gm.get('fortis-textbox-profiles-v1');
  assert.ok(profileDisk.includes('live.helper.module'));
  assert.ok(!profileDisk.includes('Новый текст после'));
  // If Helper legitimately removes the module, Notifier does not use stale text.
  items=[];
  await publisher.publish();
  assert.throws(()=>notifier.prepare('Вопрос'),/Нет локального модуля/);
  notifier.close();publisher.close();
});
