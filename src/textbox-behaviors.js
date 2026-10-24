(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ChatGPTTabNotifier=Object.assign(root.ChatGPTTabNotifier||{},api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // THE ONLY CODE REGISTRY FOR BEHAVIOR MODULES.
  // To add one, declare id/title/description, defaultEnabled and apply(context).
  // The Notifier settings switch appears automatically; NO JS editor or dynamic
  // code execution exists in either browser UI or the Planning Helper catalog.
  const TEXTBOX_BEHAVIOR_PLUGINS=Object.freeze([
    Object.freeze({
      id:'task-id',title:'Task ID и точный оригинал',required:true,
      description:'Штатная генерация и сохранение task_id. Защищённая основа всегда включена.',
      apply(){/* Implemented in persistentMessageController, deliberately non-disableable. */}
    }),
    Object.freeze({
      id:'native-send-dwell',title:'Пауза перед Send · 1 сек',
      required:false,defaultEnabled:true,
      description:'Ждать одну секунду после переноса текста в обычное поле ChatGPT.',
      apply(context){context.minComposerDwellMs=1000;}
    }),
    Object.freeze({
      id:'focus-after-send',title:'Возврат фокуса в Textbox',
      required:false,defaultEnabled:true,
      description:'После подготовки сообщения вернуть курсор в новое поле.',
      apply(context){context.focusAfterSend=true;}
    })
  ]);
  return {TEXTBOX_BEHAVIOR_PLUGINS};
});
