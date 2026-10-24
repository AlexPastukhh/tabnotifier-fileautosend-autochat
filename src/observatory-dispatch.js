(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const SID = /^rs_[0-9a-f]{32}$/;
  const DID = /^dispatch_[0-9a-f]{32}$/;
  const KEY = /^[A-Za-z0-9_-]{40,70}$/;
  const TASK = /^task_[0-9a-f]{32}$/;
  const MAX_BYTES = 512 * 1024;

  function validDispatchPair(pair, chat) {
    return Boolean(pair && pair.origin === 'http://127.0.0.1:18755' &&
      pair.conversation_id === chat && SID.test(pair.reporting_session_id || '') &&
      KEY.test(pair.dispatch_key || ''));
  }

  function createSessionDispatchMonitor({
    getPairing, getConversationId, request, queue, messages, profiles,
    quickAction = null,
    findComposerContext = deps.findComposerContext,
    isGenerating = deps.isGenerating, canExecute = () => true,
    now = () => Date.now(),
    report = () => {}
  } = {}) {
    let pending = false;
    let lastCheck = -Infinity;
    let lastDispatch = '';
    let lastModulesSync = -Infinity;
    const MIN_POLL_MS = 3500;
    function syncModules(pair, chat) {
      if(!current(pair, chat) || !profiles?.getProfiles ||
         now()-lastModulesSync<12000)return;
      lastModulesSync=now();
      try {
        const state=profiles.getProfiles();
        if(!state || !Array.isArray(state.profiles) || !state.profiles.length)return;
        const catalog=profiles.getCatalog?.();
        const safe=(Array.isArray(catalog)?catalog:[]).slice(0,200).map(item=>({
          id:item.id,title:String(item.title||item.id).slice(0,140)
        }));
        const ids=new Set(safe.map(x=>x.id));
        const allProfiles=state.profiles.slice(0,40).map(p=>({
          id:p.id,name:p.name,module_ids:[...p.moduleIds]
        }));
        const active=state.profiles.find(p=>p.id===state.active)?.moduleIds||[];
        const defaults=active.filter(id=>ids.has(id));
        request({
          method:'POST',url:pair.origin+'/api/dispatch/modules',
          headers:{'Content-Type':'application/json',
            'X-Fortis-Dispatch-Key':pair.dispatch_key},
          data:JSON.stringify({session:pair.reporting_session_id,chat,
            modules:safe,default_module_ids:defaults,
            profiles:allProfiles,active_profile_id:state.active}),
          timeout:3000,onload(){},onerror(){},ontimeout(){}
        });
      }catch(_){}
    }

    function current(pair, chat) {
      const actual = getPairing?.();
      return getConversationId?.() === chat && validDispatchPair(actual, chat) &&
        actual.reporting_session_id === pair.reporting_session_id &&
        actual.dispatch_key === pair.dispatch_key;
    }
    function ack(pair, chat, command, status, taskId = null, reason = null,
                 detail = null) {
      if (!current(pair, chat)) return;
      try {
        request({
          method: 'POST',
          url: pair.origin + '/api/dispatch/ack',
          headers: {'Content-Type': 'application/json',
            'X-Fortis-Dispatch-Key': pair.dispatch_key},
          data: JSON.stringify({
            session: pair.reporting_session_id, chat,
            dispatch_id: command.dispatch_id, status, task_id: taskId,
            ...(reason?{reason}:{}),
            ...(detail?{detail}:{})
          }),
          timeout: 3000,
          onload() {}, onerror() {}, ontimeout() {}
        });
      } catch (_) {}
    }

    async function execute(data, pair, chat) {
      const command = data?.command;
      const moduleIds=command?.module_ids===undefined?null:command.module_ids;
      const profileId=command?.profile_id??null;
      if (!command || !DID.test(command.dispatch_id || '') ||
          !['insert','send','file','send_prepared'].includes(command.mode) ||
          (profileId!==null&&
           (typeof profileId!=='string'||!/^[a-z0-9][a-z0-9_-]{0,55}$/.test(profileId))) ||
          (command.delay_ms !== undefined &&
            (!Number.isSafeInteger(command.delay_ms)||command.delay_ms<0||
             command.delay_ms>10000||command.mode!=='send')) ||
          typeof command.text !== 'string' ||
          (command.mode!=='send_prepared'&&!command.text.trim()) ||
          (moduleIds!==null&&(!Array.isArray(moduleIds) || moduleIds.length>100 ||
          moduleIds.some(id=>typeof id!=='string'||
            !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)))) ||
          new TextEncoder().encode(command.text).length > MAX_BYTES ||
          !current(pair, chat)) return;
      // The local owner-local broker does not redeliver an already claimed
      // command. The local guard additionally rejects unexpected duplicated callbacks.
      if (lastDispatch === command.dispatch_id) return;
      lastDispatch = command.dispatch_id;
      let status = 'refused', taskId = null, reason = 'unknown', detail = null;
      try {
        const context = findComposerContext?.();
        const composer = context?.composer;
        if (!composer || composer.isConnected === false ||
            composer.disabled || composer.readOnly ||
            queue?.isWaitingToSend?.() || queue?.isInsertingOnly?.() ||
            isGenerating?.() || !canExecute(context)) return;
        if(typeof quickAction === 'function'){
          // Reuse Notifier File/Insert/Send button pipeline with its file
          // hash guard, Planning Helper context and task-id retention.
          if(command.mode==='send' &&
             (deps.readComposerText?.(composer)||composer.value||composer.innerText||'').trim())
            return;
          const outcome=await quickAction({
            mode:command.mode,text:command.text, moduleIds,profileId,
            ...(command.mode==='send' ? {delayMs:command.delay_ms===undefined?1000:command.delay_ms} : {})
          });
          if(command.mode==='file'&&typeof outcome?.detail==='string'&&
             outcome.detail.length<=512)detail=outcome.detail;
          if(!outcome?.ok){
            reason=outcome?.reason||'unknown';
            if(command.mode==='file'&&outcome?.attachmentAttempted&&current(pair,chat)){
              status=outcome.attachmentConfirmed?'attachment_only':'attachment_unconfirmed';
            }
          }
          if(outcome?.ok && current(pair,chat)){
            if(command.mode==='file'||command.mode==='insert'){
              if(TASK.test(outcome.taskId||'')){
                taskId=outcome.taskId;
                status=command.mode==='file'?'file_attached':'inserted';
              } else reason='prepared_missing';
            } else if(command.mode==='send_prepared'){
              if(TASK.test(outcome.taskId||'')){
                status='send_initiated';taskId=outcome.taskId;
              } else reason='not_confirmed';
            } else if(TASK.test(outcome.taskId||'')){
              const record=(messages?.listForChat?.(chat)||[]).find(
                entry=>entry.task_id===outcome.taskId);
              if(record&&['send_queued','send_unconfirmed','sent'].includes(record.send_status)){
                status='send_initiated';taskId=outcome.taskId;
              }
            }
          }
        }else if (command.mode === 'insert') {
          const outcome = await queue?.insertOnly?.(command.text);
          if (outcome?.ok && current(pair, chat)) status = 'inserted';
        } else if(command.mode==='send') {
          // Never replace another user's active ChatGPT draft.
          if ((deps.readComposerText?.(composer) || composer.value || composer.innerText || '').trim()) return;
          const options = profiles?.prepare
            ? profiles.prepare(command.text) : {minComposerDwellMs: 1000, extraText: ''};
          if (!current(pair, chat)) return;
          const id = messages?.saveAndSend?.(command.text, {
            minComposerDwellMs: options.minComposerDwellMs,
            extraText: options.extraText || ''
          });
          if (TASK.test(id || '')) {
            const record = (messages?.listForChat?.(chat) || []).find(item => item.task_id === id);
            if (record && ['send_queued', 'send_unconfirmed', 'sent'].includes(record.send_status)) {
              status = 'send_initiated';
              taskId = id;
            }
          }
        }
      } catch (_) {
        status = 'refused';
      } finally {
        ack(pair, chat, command, status, taskId,
          ['refused','attachment_only','attachment_unconfirmed'].includes(status)?reason:null,
          command.mode==='file'?detail:null);
        try { report(status); } catch (_) {}
      }
    }

    function check() {
      if (pending || typeof request !== 'function') return false;
      const pair = getPairing?.(), chat = getConversationId?.();
      if (!validDispatchPair(pair, chat)) return false;
      if (now() - lastCheck < MIN_POLL_MS) return false;
      lastCheck = now(); pending = true;
      syncModules(pair,chat);
      try {
        request({
          method: 'GET',
          url: pair.origin + '/api/dispatch/poll?session=' +
            encodeURIComponent(pair.reporting_session_id) + '&chat=' +
            encodeURIComponent(chat),
          headers: {'X-Fortis-Dispatch-Key': pair.dispatch_key},
          timeout: 3000,
          onload(response) {
            pending = false;
            if (response?.status !== 200 || !current(pair, chat)) return;
            try {
              const data = JSON.parse(response.responseText);
              if (data?.ok !== true || data.session !== pair.reporting_session_id ||
                  data.chat !== chat) return;
              // async execution acknowledges only once it tried the action.
              void execute(data, pair, chat);
            } catch (_) {}
          },
          onerror() { pending = false; },
          ontimeout() { pending = false; }
        });
        return true;
      } catch (_) {
        pending = false;
        return false;
      }
    }

    return {check, isPolling: () => pending};
  }
  return {createSessionDispatchMonitor, validDispatchPair};
});
