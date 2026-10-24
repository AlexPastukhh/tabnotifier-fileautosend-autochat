(function(root,factory){
  const registry=typeof require==='function'?require('./textbox-behaviors.js'):(root.ChatGPTTabNotifier||{});
  const api=factory(registry);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ChatGPTTabNotifier=Object.assign(root.ChatGPTTabNotifier||{},api);
})(typeof globalThis!=='undefined'?globalThis:this,function(registry){
  'use strict';
  const CHANNEL='fortis-shared-helper-text-modules-v1';
  const STORAGE_KEY='fortis-textbox-profiles-v1';
  const MODULE_ID=/^[a-z0-9][a-z0-9._-]{0,79}$/;
  const BEHAVIORS=registry.TEXTBOX_BEHAVIOR_PLUGINS;
  function defaultProfiles(){
    return {version:1,active:'default',profiles:[{
      id:'default',name:'Обычный',moduleIds:[],
      behavior:Object.fromEntries(BEHAVIORS.filter(b=>!b.required)
        .map(b=>[b.id,b.defaultEnabled===true]))
    }]};
  }
  function normalizeProfiles(value){
    if(!value||value.version!==1||!Array.isArray(value.profiles)||
       !value.profiles.length||value.profiles.length>40)throw new Error('BAD_PROFILE_STORE');
    const ids=new Set();
    const profiles=value.profiles.map(p=>{
      if(typeof p.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,55}$/.test(p.id)||
         ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>70||
         !Array.isArray(p.moduleIds)||p.moduleIds.length>100||
         p.moduleIds.some(id=>!MODULE_ID.test(id))||
         new Set(p.moduleIds).size!==p.moduleIds.length)throw new Error('BAD_PROFILE');
      if(p.promptId!==undefined&&p.promptId!==null&&
         (typeof p.promptId!=='string'||!MODULE_ID.test(p.promptId)))throw new Error('BAD_PROFILE_PROMPT');
      ids.add(p.id);
      const behavior={};
      for(const b of BEHAVIORS.filter(item=>!item.required)){
        behavior[b.id]=typeof p.behavior?.[b.id]==='boolean'?
          p.behavior[b.id]:b.defaultEnabled===true;
      }
      return {id:p.id,name:p.name.trim(),moduleIds:[...p.moduleIds],
        ...(p.promptId?{promptId:p.promptId}:{}),behavior};
    });
    if(!ids.has(value.active))throw new Error('BAD_ACTIVE_PROFILE');
    return {version:1,active:value.active,profiles};
  }
  function normalizeCatalog(value){
    if(!Array.isArray(value)||value.length>2000)throw new Error('INVALID_MODULE_CATALOG');
    let total=0;
    const seen=new Set();
    return value.map(m=>{
      if(!m||typeof m.id!=='string'||!MODULE_ID.test(m.id)||seen.has(m.id)||
         typeof m.title!=='string'||m.title.length>300||
         typeof m.text!=='string'||m.text.length>100000)
        throw new Error('INVALID_MODULE_CATALOG');
      seen.add(m.id);total+=m.text.length;
      if(total>600000)throw new Error('MODULE_CATALOG_TOO_LARGE');
      return {id:m.id,title:m.title,text:m.text};
    });
  }
  function resolveSelectedText(profile,catalog,prompts=null){
    if(!profile?.moduleIds?.length&&!profile?.promptId)return '';
    if(catalog===null)throw new Error('Planning Helper не подключён. Модули недоступны.');
    const byId=new Map(catalog.map(m=>[m.id,m]));
    // Expand only literal module references. Bound every append, including
    // repeated references, before allocating an oversized composed string.
    function expand(text,stack=[]){
      let out='',cursor=0;
      function append(piece){
        if(out.length+piece.length>100000)throw new Error('Слишком длинный результат модулей');
        out+=piece;
      }
      for(const match of text.matchAll(/\[\[module:([a-z0-9][a-z0-9._-]{0,79})\]\]/g)){
        append(text.slice(cursor,match.index));
        append(resolve(match[1],stack));cursor=match.index+match[0].length;
      }
      append(text.slice(cursor));return out;
    }
    function resolve(id,stack=[]){
      if(stack.includes(id)||stack.length>24)throw new Error('Цикл ссылок модулей: '+id);
      const value=byId.get(id);
      if(!value)throw new Error('Нет локального модуля: '+id);
      return expand(value.text,[...stack,id]);
    }
    const content=[];
    if(profile.promptId){
      if(prompts===null)throw new Error('Helper не передал каталог промптов. Обнови вкладки ChatGPT и запроси каталог.');
      const prompt=prompts.find(p=>p.id===profile.promptId);
      if(!prompt)throw new Error('Нет локального промпта: '+profile.promptId);
      content.push(expand(prompt.text));
    }
    content.push(...profile.moduleIds.map(id=>resolve(id)));
    if(content.join('\n\n').length>100000)throw new Error('Слишком длинный результат модулей');
    return content.filter(Boolean).join('\n\n');
  }
  function createTextboxProfileManager({getValue,setValue,Channel=typeof BroadcastChannel==='function'?BroadcastChannel:null,onChange=()=>{}}={}){
    let value=defaultProfiles(),catalog=null,prompts=null,connected=false,channel=null,lastError='',profileReadFailed=false;
    let fullCatalogSeen=false;
    function notify(){try{onChange();}catch(_){}}
    try{
      const raw=getValue?.(STORAGE_KEY,null);
      if(raw!==null&&raw!==undefined)value=normalizeProfiles(
        typeof raw==='string'?JSON.parse(raw):raw);
    }catch(_){profileReadFailed=true;lastError='Не удалось прочитать профили; сохранение заблокировано.';}
    if(Channel){
      try{
        channel=new Channel(CHANNEL);
        const handler=event=>{
          const message=event?.data;
          if(message?.protocol!==CHANNEL||message.type!=='catalog')return;
          // Open tabs can still run the pre-prompts Helper. Once a verified
          // full catalog arrives, never downgrade to their module-only reply.
          // Keep the complete snapshot atomic, including its module bodies.
          if(fullCatalogSeen&&message.prompts===undefined)return;
          try{
            const modules=normalizeCatalog(message.modules);
            const nextPrompts=message.prompts===undefined?null:normalizeCatalog(message.prompts);
            catalog=modules;prompts=nextPrompts;connected=true;
            if(nextPrompts!==null)fullCatalogSeen=true;
            if(!profileReadFailed)lastError='';notify();}
          catch(_){catalog=null;prompts=null;connected=false;lastError='Некорректный каталог Helper';notify();}
        };
        if(typeof channel.addEventListener==='function')channel.addEventListener('message',handler);
        else channel.onmessage=handler;
      }catch(_){lastError='Канал Planning Helper недоступен';}
    }
    function persist(next){
      if(profileReadFailed)throw new Error('Нельзя перезаписывать повреждённые профили.');
      const checked=normalizeProfiles(next);
      if(typeof setValue!=='function'||typeof getValue!=='function')throw new Error('GM хранилище профилей недоступно');
      const serialized=JSON.stringify(checked);
      setValue(STORAGE_KEY,serialized);
      const actual=getValue(STORAGE_KEY,null);
      const normalized=normalizeProfiles(typeof actual==='string'?JSON.parse(actual):actual);
      if(JSON.stringify(normalized)!==serialized)throw new Error('Не удалось подтвердить сохранение профиля');
      value=checked;notify();
    }
    function current(){return value.profiles.find(p=>p.id===value.active);}
    function modify(changer){
      const next=structuredCloneFallback(value);
      changer(next,next.profiles.find(p=>p.id===next.active));
      persist(next);
    }
    function structuredCloneFallback(object){return JSON.parse(JSON.stringify(object));}
    function createProfile(name){
      const label=String(name||'').trim();
      if(!label||label.length>70)throw new Error('Название профиля: 1–70 символов');
      const id='p'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
      modify(next=>{const behavior=Object.fromEntries(
        BEHAVIORS.filter(b=>!b.required).map(b=>[b.id,b.defaultEnabled===true]));
        next.profiles.push({id,name:label,moduleIds:[],behavior});next.active=id;});
      return id;
    }
    function deleteProfile(){
      if(value.profiles.length===1)throw new Error('Последний профиль удалить нельзя');
      modify(next=>{next.profiles=next.profiles.filter(p=>p.id!==next.active);next.active=next.profiles[0].id;});
    }
    function setActive(id){
      if(!value.profiles.some(p=>p.id===id))throw new Error('Нет такого профиля');
      modify(next=>{next.active=id;});
    }
    function addModulesByReferences(value){
      // AI may SUGGEST existing IDs, but cannot mutate GM data itself.
      // User must paste the reference list and confirm via the settings UI.
      // Accept plain IDs or Helper's [[module:id]] references, separated by
      // commas, semicolons, newlines or spaces. Never execute instructions/JS.
      const input=String(value||'').trim();
      if(!input||input.length>1800)throw new Error('Укажи не более 20 ID модулей');
      const parts=input.split(/[\s,;]+/).filter(Boolean);
      if(parts.length>20)throw new Error('Допускается максимум 20 модулей за раз');
      const ids=parts.map(part=>{
        const id=part.startsWith('[[module:')&&part.endsWith(']]')
          ?part.slice(9,-2):part;
        if(!MODULE_ID.test(id))throw new Error('Неверная ссылка на модуль: '+part.slice(0,90));
        return id;
      });
      if(!catalog)throw new Error('Planning Helper не подключён. Нельзя подтвердить ID.');
      const known=new Set(catalog.map(m=>m.id));
      for(const id of ids){
        if(!known.has(id))throw new Error('Нет локального модуля Planning Helper: '+id);
      }
      const unique=[...new Set(ids)];
      const selected=current().moduleIds;
      const additions=unique.filter(id=>!selected.includes(id));
      if(additions.length){
        // Validate the entire proposed resulting profile, including nested
        // dependencies, before making any persistent changes.
        resolveSelectedText({...current(),moduleIds:[...selected,...additions]},catalog,prompts);
        modify((_next,p)=>{p.moduleIds.push(...additions);});
      }
      return additions;
    }
    function setPrompt(id){
      if(id===null){modify((_next,p)=>{delete p.promptId;});return;}
      if(typeof id!=='string'||!MODULE_ID.test(id))throw new Error('Неверный ID промпта');
      // Resolve the complete prospective profile before verified GM persistence.
      resolveSelectedText({...current(),promptId:id},catalog,prompts);
      modify((_next,p)=>{p.promptId=id;});
    }
    function addModule(id){return addModulesByReferences(id);}
    function removeModule(id){modify((_next,p)=>{p.moduleIds=p.moduleIds.filter(v=>v!==id);});}
    function moveModule(id,direction){
      modify((_next,p)=>{const i=p.moduleIds.indexOf(id),j=i+direction;
        if(i>=0&&j>=0&&j<p.moduleIds.length)
          [p.moduleIds[i],p.moduleIds[j]]=[p.moduleIds[j],p.moduleIds[i]];
      });
    }
    function setBehavior(id,enabled){
      if(!BEHAVIORS.some(b=>b.id===id&&!b.required))throw new Error('Этот JS-модуль нельзя переключить');
      modify((_next,p)=>{p.behavior[id]=Boolean(enabled);});
    }
    function prepareForProfile(original,profileId=null,moduleIds=null){
      if(profileReadFailed)throw new Error('Профили не прочитаны. Отправка из Textbox отменена.');
      const source=String(original);
      const active=profileId===null?current():value.profiles.find(p=>p.id===profileId);
      if(!active)throw new Error('Профиль Observatory больше не существует в Notifier.');
      let effective=active;
      if(moduleIds!==null){
        if(!Array.isArray(moduleIds)||moduleIds.length>100||
           moduleIds.some(id=>typeof id!=='string'||!MODULE_ID.test(id))||
           new Set(moduleIds).size!==moduleIds.length)
          throw new Error('Неверный список модулей Observatory.');
        // Only known catalog IDs; no remote module body or JS code accepted.
        if(moduleIds.length && (!catalog||moduleIds.some(id=>!catalog.some(item=>item.id===id))))
          throw new Error('Модули Observatory недоступны в Planning Helper.');
        effective={...active,moduleIds:[...moduleIds]};
      }
      const text=resolveSelectedText(effective,catalog,prompts);
      const context={original:source,extraText:text,
        minComposerDwellMs:0,focusAfterSend:false};
      for(const plugin of BEHAVIORS){
        if(plugin.required||active.behavior[plugin.id]!==false)
          plugin.apply(context);
      }
      return context;
    }
    function prepareForModules(original,moduleIds=null){
      return prepareForProfile(original,null,moduleIds);
    }
    function prepare(original){return prepareForProfile(original);}
    function requestCatalog(){channel?.postMessage({protocol:CHANNEL,type:'request'});}
    return {requestCatalog,getCatalog:()=>catalog?catalog.map(m=>({...m})):null,
      getPromptCatalog:()=>prompts?prompts.map(p=>({...p})):null,
      getProfiles:()=>structuredCloneFallback(value),getActive:()=>structuredCloneFallback(current()),
      isConnected:()=>connected,getError:()=>lastError,getBehaviors:()=>BEHAVIORS,
      createProfile,deleteProfile,setActive,setPrompt,addModule,addModulesByReferences,removeModule,moveModule,setBehavior,
      prepare,prepareForModules,prepareForProfile,close:()=>channel?.close?.()};
  }
  return {SHARED_MODULE_CHANNEL:CHANNEL,TEXTBOX_PROFILE_STORAGE_KEY:STORAGE_KEY,
    TEXTBOX_BEHAVIORS:BEHAVIORS,normalizeProfiles,normalizeCatalog,
    resolveSelectedText,createTextboxProfileManager};
});
