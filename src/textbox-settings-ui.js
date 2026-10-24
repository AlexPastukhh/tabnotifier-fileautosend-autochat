(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ChatGPTTabNotifier=Object.assign(root.ChatGPTTabNotifier||{},api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function mountTextboxSettings({shadow,manager,positionPanel}){
    const row=shadow.querySelector('.row');
    const auto=shadow.querySelector('[data-role="auto-send"]');
    if(!row||!auto)return null;
    const style=document.createElement('style');
    style.textContent=`
      .auto-stack{display:flex;flex:0 0 34px;flex-direction:column;gap:5px;
        align-items:center;justify-content:center;height:83px}
      .settings-button{width:33px;height:33px;border:1px solid #64748b;
        border-radius:999px;background:#243044;color:white;font:18px system-ui;cursor:pointer}
      .settings-button[aria-expanded=true]{background:#3b507a}
      .textbox-modules-panel{position:absolute;right:0;z-index:9;overflow:auto;
        width:min(440px,calc(100vw - 22px));max-height:min(74vh,590px);
        padding:13px;border:1px solid #64748b;border-radius:12px;
        background:#131e2d;color:#eef5ff;font:12px/1.45 system-ui;
        box-shadow:0 14px 40px #000a;cursor:default;
        user-select:text;-webkit-user-select:text;touch-action:auto}
      .textbox-modules-panel[hidden]{display:none}
      .textbox-modules-panel h3{margin:3px 0 7px;font-size:15px}
      .textbox-modules-panel h4{margin:12px 0 6px;font-size:13px}
      .textbox-modules-panel p{margin:4px 0;color:#aabdda}
      .textbox-modules-panel input,.textbox-modules-panel select{background:#0b1320;color:#fff;
        border:1px solid #536378;border-radius:7px;padding:7px;min-width:0;font:12px system-ui}
      .textbox-modules-panel input[type=checkbox]{width:15px;height:15px;accent-color:#8ca5ff}
      .textbox-modules-panel button{background:#253349;color:#eef5ff;border:1px solid #465e7c;
        border-radius:7px;padding:6px;cursor:pointer}
      .textbox-modules-panel button:disabled{opacity:.4;cursor:default}
      .textbox-modules-panel .fields{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0}
      .textbox-modules-panel .fields select,.textbox-modules-panel .fields input{flex:1 1 150px}
      .textbox-modules-panel .module-row{display:flex;gap:5px;align-items:center;
        border:1px solid #33455e;border-radius:8px;margin:5px 0;padding:7px}
      .textbox-modules-panel .module-row[hidden]{display:none}
      .textbox-modules-panel .module-title{flex:1;overflow-wrap:anywhere}
      .textbox-modules-panel label.behavior{display:flex;gap:8px;align-items:center;margin:7px 0}
      .textbox-modules-panel .preview{max-height:110px;overflow:auto;white-space:pre-wrap;
        font:11px/1.5 ui-monospace,monospace;color:#d1dffc;background:#0b1320;
        border:1px solid #374761;border-radius:8px;padding:8px}
      .textbox-modules-panel .settings-error{color:#f4b8b8;white-space:pre-wrap}
    `;
    shadow.appendChild(style);
    const stack=document.createElement('div');stack.className='auto-stack';
    auto.replaceWith(stack);stack.appendChild(auto);
    const button=document.createElement('button');
    button.type='button';button.className='settings-button';
    button.setAttribute('aria-label','Настройки профилей, промптов и модулей Textbox');
    button.setAttribute('aria-expanded','false');button.textContent='⚙';
    stack.appendChild(button);
    const panel=document.createElement('section');
    panel.className='textbox-modules-panel';panel.hidden=true;
    panel.setAttribute('aria-label','Настройки Fortis Textbox');
    panel.innerHTML=`
      <h3>⚙ Профили Textbox <button type="button" class="close" aria-label="Закрыть">×</button></h3>
      <p>Текстовые модули создаются и редактируются только в Planning Helper.</p>
      <div class="fields"><select class="profiles" aria-label="Текущий профиль"></select>
        <button type="button" class="delete-profile">Удалить профиль</button></div>
      <div class="fields"><input class="new-profile" maxlength="70" placeholder="Название нового профиля">
        <button type="button" class="create-profile">+ Профиль</button></div>
      <h4>Промпт профиля</h4>
      <p>Один промпт из Helper добавляется после твоего текста, перед модулями. Выбор не нажимает Send.</p>
      <div class="module-row selected-prompt" hidden aria-label="Подключённый промпт">
        <span class="module-title prompt-title"></span>
        <button type="button" class="detach-prompt" aria-label="Отключить промпт" title="Отключить промпт">×</button>
      </div>
      <p class="no-prompt">Без промпта.</p>
      <div class="fields"><input class="prompt-search" aria-label="Поиск промптов Planning Helper" placeholder="Поиск промпта по имени или ID..."></div>
      <div class="fields"><select class="available-prompts" aria-label="Доступные промпты Helper"></select>
        <button type="button" class="attach-prompt">Подключить промпт</button></div>
      <h4>Текстовые модули профиля</h4><div class="selected"></div>
      <div class="fields"><input class="module-search" aria-label="Поиск готовых модулей Planning Helper" placeholder="Поиск по имени или ID..."></div>
      <div class="fields"><select class="available" aria-label="Доступные модули Helper"></select>
        <button type="button" class="attach">Подключить</button></div>
      <div class="fields"><input class="ai-module-ids" maxlength="1800"
        aria-label="ID существующих модулей от AI"
        placeholder="ID или [[module:id]] от AI, через запятую">
        <button type="button" class="attach-ids">Подключить по ID</button></div>
      <p class="source"></p>
      <h4>Поведенческие модули · код</h4><div class="behavior-list"></div>
      <h4>Предпросмотр</h4><div class="preview"></div>
      <p class="settings-error" role="status"></p>`;
    row.appendChild(panel);
    const $=selector=>panel.querySelector(selector);
    let cache='';
    function act(fn){
      try{fn();$('.settings-error').textContent='';cache='';render();}
      catch(error){$('.settings-error').textContent=error.message||'Ошибка';}
    }
    function control(text,fn,disabled=false){
      const element=document.createElement('button');
      element.type='button';element.textContent=text;element.disabled=disabled;
      element.addEventListener('click',()=>act(fn));return element;
    }
    function render(){
      if(panel.hidden||!manager)return;
      const state=manager.getProfiles(),active=manager.getActive(),catalog=manager.getCatalog();
      const prompts=manager.getPromptCatalog();
      const signature=JSON.stringify([state,catalog,prompts,manager.isConnected(),manager.getError()]);
      if(signature===cache)return;
      cache=signature;
      const select=$('.profiles');select.replaceChildren();
      for(const p of state.profiles){
        const option=document.createElement('option');
        option.value=p.id;option.textContent=p.name;select.appendChild(option);
      }
      select.value=state.active;$('.delete-profile').disabled=state.profiles.length===1;
      const chosen=prompts?.find(p=>p.id===active.promptId);
      $('.selected-prompt').hidden=!active.promptId;
      $('.no-prompt').hidden=Boolean(active.promptId);
      $('.prompt-title').textContent=active.promptId
        ? (chosen?chosen.title:active.promptId+' (недоступен)') : '';
      $('.prompt-title').title=active.promptId||'';
      const promptSelect=$('.available-prompts'),previous=promptSelect.value;
      promptSelect.replaceChildren();
      const promptTerm=$('.prompt-search').value.trim().toLowerCase();
      for(const p of prompts||[]){
        if(promptTerm&&!(p.id+' '+p.title).toLowerCase().includes(promptTerm))continue;
        const option=document.createElement('option');
        option.value=p.id;option.textContent=p.title+' · '+p.id;promptSelect.appendChild(option);
      }
      if([...promptSelect.options].some(o=>o.value===previous))promptSelect.value=previous;
      else if([...promptSelect.options].some(o=>o.value===active.promptId))promptSelect.value=active.promptId;
      $('.attach-prompt').disabled=prompts===null||!promptSelect.options.length;
      $('.detach-prompt').disabled=!active.promptId;
      const list=$('.selected');list.replaceChildren();
      for(const [index,id] of active.moduleIds.entries()){
        const info=catalog?.find(m=>m.id===id);
        const line=document.createElement('div');line.className='module-row';
        const name=document.createElement('span');name.className='module-title';
        name.textContent=info?.title||id+' (недоступен)';
        line.append(name,
          control('↑',()=>manager.moveModule(id,-1),index===0),
          control('↓',()=>manager.moveModule(id,1),index===active.moduleIds.length-1),
          control('×',()=>manager.removeModule(id)));
        list.appendChild(line);
      }
      if(!active.moduleIds.length){const p=document.createElement('p');
        p.textContent='Нет подключённых модулей.';list.appendChild(p);}
      const available=$('.available');available.replaceChildren();
      const term=$('.module-search').value.trim().toLowerCase();
      for(const m of catalog||[]){
        if(active.moduleIds.includes(m.id)||
           (term&&!(m.id+' '+m.title).toLowerCase().includes(term)))continue;
        const option=document.createElement('option');
        option.value=m.id;option.textContent=m.title+' · '+m.id;available.appendChild(option);
      }
      $('.attach').disabled=!catalog||!available.options.length;
      $('.source').textContent=catalog
        ? 'Единая локальная библиотека Planning Helper · '+catalog.length+' модулей · '+
          (prompts===null?'каталог промптов ещё не получен: обнови вкладки ChatGPT':prompts.length+' промптов')+'. GitHub и редактор — только в Helper.'
        : 'Ожидаю Planning Helper. Модули не дублируются и не загружаются автоматически из GitHub.';
      const behaviors=$('.behavior-list');behaviors.replaceChildren();
      for(const b of manager.getBehaviors()){
        const label=document.createElement('label');label.className='behavior';
        const checkbox=document.createElement('input');checkbox.type='checkbox';
        checkbox.checked=b.required||active.behavior[b.id]!==false;
        checkbox.disabled=b.required;
        checkbox.addEventListener('change',()=>act(()=>manager.setBehavior(b.id,checkbox.checked)));
        const title=document.createElement('span');
        title.textContent=b.title+(b.required?' · обязательный':'');
        title.title=b.description;label.append(checkbox,title);behaviors.appendChild(label);
      }
      try{
        const prepared=manager.prepare('Текст пользователя');
        $('.preview').textContent=prepared.original+
          (prepared.extraText?'\n\n'+prepared.extraText:'');
      }catch(error){$('.preview').textContent=error.message;}
    }
    button.addEventListener('click',()=>{
      panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));
      if(!panel.hidden){manager?.requestCatalog();cache='';render();positionPanel?.(panel);}
    });
    $('.close').addEventListener('click',()=>button.click());
    $('.profiles').addEventListener('change',event=>act(()=>manager.setActive(event.target.value)));
    $('.create-profile').addEventListener('click',()=>act(()=>{
      manager.createProfile($('.new-profile').value);$('.new-profile').value='';
    }));
    $('.delete-profile').addEventListener('click',()=>act(()=>manager.deleteProfile()));
    $('.attach').addEventListener('click',()=>act(()=>manager.addModule($('.available').value)));
    $('.attach-ids').addEventListener('click',()=>act(()=>{
      manager.addModulesByReferences($('.ai-module-ids').value);
      $('.ai-module-ids').value='';
    }));
    $('.attach-prompt').addEventListener('click',()=>act(()=>manager.setPrompt($('.available-prompts').value)));
    $('.detach-prompt').addEventListener('click',()=>act(()=>manager.setPrompt(null)));
    $('.prompt-search').addEventListener('input',()=>{cache='';render();});
    $('.module-search').addEventListener('input',()=>{cache='';render();});
    return {panel,button,render,close(){panel.hidden=true;button.setAttribute('aria-expanded','false');}};
  }
  return {mountTextboxSettings};
});
