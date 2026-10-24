import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {mountTextboxSettings}=require('../src/textbox-settings-ui.js');
const {createTextboxProfileManager,SHARED_MODULE_CHANNEL}=require('../src/textbox-module-profiles.js');

// A DOM event fixture: no UI source matching and no duplicate manager logic.
class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.events={};this.attributes={};this._value='';this.textContent='';this.hidden=false;this.disabled=false;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  dispatch(k){for(const fn of this.events[k]||[])fn({target:this});}
  click(){if(!this.disabled)this.dispatch('click');}
  appendChild(child){this.children.push(child);child.parent=this;return child;}
  append(...children){children.forEach(c=>this.appendChild(c));}
  replaceChildren(...children){this.children=[];this._value='';this.append(...children);}
  replaceWith(child){const i=this.parent.children.indexOf(this);this.parent.children.splice(i,1,child);child.parent=this.parent;}
  get options(){return this.children.filter(c=>c.tagName==='OPTION');}
  get value(){return this._value||(this.tagName==='SELECT'?this.options[0]?.value||'':'');}
  set value(v){this._value=v;}
  set innerHTML(html){
    // Static UI markup only; dynamic data must go through textContent.
    this.query={};
    for(const match of html.matchAll(/<(\w+)\b[^>]*class="([^"]+)"[^>]*>/g)){
      const node=new Element(match[1]);node.className=match[2];
      for(const cls of node.className.split(' '))this.query['.'+cls]=node;
    }
  }
  querySelector(selector){return this.query?.[selector]||null;}
}
class Channel {
  static all=new Set();
  constructor(name){this.name=name;Channel.all.add(this);}
  addEventListener(_,fn){this.onmessage=fn;}
  postMessage(data){for(const c of Channel.all)if(c!==this&&c.name===this.name)c.onmessage?.({data:structuredClone(data)});}
  close(){Channel.all.delete(this);}
}
test('real prompt selector events attach, search, restore per profile and detach without Send or HTML execution',t=>{
  const previous=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag)};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  let sends=0;
  const shadow=new Element('shadow'),row=new Element('div'),auto=new Element('button');row.append(auto);
  auto.addEventListener('click',()=>sends++);
  shadow.query={'.row':row,'[data-role="auto-send"]':auto};
  const gm=new Map();let ui;
  const manager=createTextboxProfileManager({Channel,getValue:(k,d)=>gm.get(k)??d,setValue:(k,v)=>gm.set(k,v),onChange:()=>ui?.render()});
  const peer=new Channel(SHARED_MODULE_CHANNEL);t.after(()=>{peer.close();manager.close();});
  let prompts=[{id:'review',title:'Обзор 🧪',text:'Обзор [[module:rules]]'},
    {id:'inert',title:'<img src=x onerror=alert(1)>',text:'Другой промпт'}];
  const publish=()=>peer.postMessage({protocol:SHARED_MODULE_CHANNEL,type:'catalog',modules:[{id:'rules',title:'Правила',text:'с проверкой'}],prompts});
  ui=mountTextboxSettings({shadow,manager});publish();ui.button.click();
  const $=s=>ui.panel.querySelector(s);
  assert.equal(ui.panel.hidden,false);assert.equal($('.selected-prompt').hidden,true);assert.equal($('.no-prompt').hidden,false);
  $('.prompt-search').value='Обзор';$('.prompt-search').dispatch('input');
  assert.equal($('.available-prompts').options.length,1);assert.equal(manager.getActive().promptId,undefined);
  $('.attach-prompt').click();
  assert.equal(manager.getActive().promptId,'review');
  assert.equal($('.selected-prompt').hidden,false);assert.equal($('.no-prompt').hidden,true);
  assert.equal($('.prompt-title').textContent,'Обзор 🧪');
  assert.equal($('.preview').textContent,'Текст пользователя\n\nОбзор с проверкой');
  $('.new-profile').value='Пустой';$('.create-profile').click();
  assert.equal($('.selected-prompt').hidden,true);assert.equal($('.no-prompt').hidden,false);
  $('.profiles').value='default';$('.profiles').dispatch('change');
  assert.equal($('.selected-prompt').hidden,false);assert.equal($('.no-prompt').hidden,true);
  assert.equal($('.prompt-title').textContent,'Обзор 🧪');assert.equal($('.prompt-title').title,'review');
  $('.prompt-search').value='';$('.prompt-search').dispatch('input');
  assert.equal($('.available-prompts').options.length,2);
  const inert=$('.available-prompts').options.find(o=>o.value==='inert');
  assert.equal(inert.textContent,'<img src=x onerror=alert(1)> · inert');
  assert.equal(inert.children.length,0);
  prompts=prompts.filter(p=>p.id!=='review');publish();
  assert.equal($('.selected-prompt').hidden,false);
  assert.match($('.prompt-title').textContent,/недоступен/);
  assert.match($('.preview').textContent,/Нет локального промпта/);
  assert.equal(manager.getActive().promptId,'review');
  $('.detach-prompt').click();
  assert.equal($('.selected-prompt').hidden,true);assert.equal($('.no-prompt').hidden,false);
  assert.equal($('.preview').textContent,'Текст пользователя');
  $('.close').click();assert.equal(ui.panel.hidden,true);
  ui.button.click();
  peer.postMessage({protocol:SHARED_MODULE_CHANNEL,type:'catalog',modules:[]});
  assert.equal($('.attach-prompt').disabled,false);
  assert.match($('.source').textContent,/1 промптов/);
  assert.equal(manager.getPromptCatalog()[0].id,'inert','legacy tab cannot erase the updated list');
  assert.equal(sends,0);
});
