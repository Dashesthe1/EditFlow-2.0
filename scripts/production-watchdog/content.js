(() => {
  if (globalThis.__EDITFLOW_ACTUATOR_V302__) return;
  globalThis.__EDITFLOW_ACTUATOR_V302__ = true;
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
      const identity = [cmd.prompt.match(/gpt-assignment:[\w-]+/)?.[0],
        cmd.prompt.match(/session ([\w:-]+) from/)?.[1], cmd.prompt.match(/ef-worker:\d+:[a-f0-9]{64}/)?.[0]];
      const ownReceipt = () => messages().some(e => [e.innerText, e.textContent].some(value => {
        const text = normalize(value);
        return text === expected || (identity.every(Boolean) && identity.every(id => text.includes(id))
          && text.includes('session with the given raw files to make the finished product.'));
      }));
      if (ownReceipt()) return { sent: true };
      if (/\/c\//.test(location.pathname) || messages().length) throw Error('CONTINUATION_TARGET_NOT_EMPTY');
      const box = document.querySelector('#prompt-textarea, [contenteditable="true"][role="textbox"], textarea');
      if (!visible(box)) throw Error('COMPOSER_UNAVAILABLE');
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
        if (ownReceipt()) return { sent: true };
        await sleep(200);
      }
      throw Error('SEND_ACCEPTANCE_UNCONFIRMED');
    } finally { sending = false; }
  }
  chrome.runtime.onMessage.addListener((cmd, _sender, respond) => {
    if (cmd.type === 'EDITFLOW_ACTUATOR_PING') { respond({ ok: true }); return; }
    if (cmd.type === 'EDITFLOW_ACTUATOR_STOP') {
      if (cmd.expectedUrl !== location.href) { respond({ clicked: false }); return; }
      const button = findButton('button[data-testid="stop-button"]', /stop (generating|streaming|response|responding)|^stop$/);
      if (button) button.click(); respond({ clicked: !!button }); return;
    }
    if (cmd.type === 'EDITFLOW_ACTUATOR_SEND') { send(cmd).then(respond).catch(e => respond({ sent: false, error: e.message })); return true; }
  });
})();
