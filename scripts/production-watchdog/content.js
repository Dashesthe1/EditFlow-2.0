(() => {
  const listenerKey = '__EDITFLOW_ACTUATOR_LISTENER__';
  const versionKey = '__EDITFLOW_ACTUATOR_VERSION__';
  const observerVersion = '4.0.2';
  const previousListener = globalThis[listenerKey];
  // Extension reloads can leave page globals behind after the old listener is removed.
  if (previousListener && chrome.runtime.onMessage.hasListener?.(previousListener)) {
    if (globalThis[versionKey] === observerVersion) return;
    chrome.runtime.onMessage.removeListener?.(previousListener);
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = e => e && e.isConnected && e.getClientRects().length && !e.disabled;
  const buttons = () => [...document.querySelectorAll('button')];
  const findButton = (selector, pattern) => [...document.querySelectorAll(selector)].find(visible)
    || buttons().find(e => visible(e) && pattern.test((e.getAttribute('aria-label') || e.title || '').toLowerCase()));
  const messages = () => [...document.querySelectorAll('[data-message-author-role="user"], [data-user-message-bubble], [data-turn="user"]')];
  let sending = false;
  async function send(cmd) {
    if (sending) return { sent: false, error: 'SEND_IN_FLIGHT' };
    sending = true;
    try {
      const normalize = s => String(s || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
      const expected = normalize(cmd.prompt);
      const session=cmd.prompt.match(/practice:[a-f0-9-]{36}/)?.[0];
      const assignment=cmd.prompt.match(/gpt-assignment:[a-f0-9-]{36}/)?.[0];
      const matches=value=>{
        const text=normalize(value);
        return text===expected || (session&&assignment&&text.includes(session)&&text.includes(assignment)
          &&text.includes('EditFlow Supervisor')&&text.includes('Source Match is the sole footage analyzer.')
          &&text.includes('Do not view, analyze or compare footage or images'));
      };
      const ownReceipt=()=>{
        const users=messages();const anchor=users.findLastIndex(e=>[e.innerText,e.textContent].some(matches));
        return anchor>=0&&!users.slice(anchor+1).some(e=>[e.innerText,e.textContent].some(value=>
          [...String(value??'').matchAll(/(?:practice|gpt-assignment):[a-f0-9-]{36}/g)].some(m=>m[0]!==session&&m[0]!==assignment)));
      };
      if (ownReceipt()) return { sent: true, conversationUrl: location.href };
      if (cmd.verifyOnly) return { sent: false, error: 'DELIVERY_NOT_FOUND' };
      if (/\/c\//.test(location.pathname) || messages().length) throw Error('CONTINUATION_TARGET_NOT_EMPTY');
      const box = document.querySelector('#prompt-textarea, [contenteditable="true"][role="textbox"], textarea');
      if (!visible(box)) throw Error('COMPOSER_UNAVAILABLE');
      const draft = normalize(box instanceof HTMLTextAreaElement ? box.value : box.textContent);
      if (draft && draft !== expected) throw Error('CONTINUATION_COMPOSER_NOT_EMPTY');
      box.focus();
      if (box instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, cmd.prompt);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, cmd.prompt);
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: cmd.prompt }));
      }
      await sleep(350);
      const button = findButton('button[data-testid="send-button"]', /^(send|send prompt|send message)$/);
      if (!button) throw Error('SEND_BUTTON_UNAVAILABLE');
      button.click();
      for (let i = 0; i < 30; i++) {
        if (ownReceipt()) return { sent: true, conversationUrl: location.href };
        await sleep(200);
      }
      throw Error('SEND_ACCEPTANCE_UNCONFIRMED');
    } finally { sending = false; }
  }
  const listener = (cmd, _sender, respond) => {
    if (cmd.type === 'EDITFLOW_ACTUATOR_PING') { respond({ ok: true, version: observerVersion }); return; }
    if (cmd.type === 'EDITFLOW_ACTUATOR_STOP') {
      if (cmd.expectedUrl !== location.href) { respond({ clicked: false }); return; }
      const button = findButton('button[data-testid="stop-button"]', /stop (generating|streaming|response|responding)|^stop$/);
      if (button) button.click(); respond({ clicked: !!button }); return;
    }
    if (cmd.type === 'EDITFLOW_ACTUATOR_SEND') { send(cmd).then(respond).catch(e => respond({ sent: false, error: e.message })); return true; }
  };
  globalThis[listenerKey] = listener;
  globalThis[versionKey] = observerVersion;
  chrome.runtime.onMessage.addListener(listener);
})();
