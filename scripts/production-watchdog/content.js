(() => {
  const listenerKey = '__EDITFLOW_ACTUATOR_LISTENER__';
  const versionKey = '__EDITFLOW_ACTUATOR_VERSION__';
  const observerVersion = '3.5.0';
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
      const identity = [cmd.prompt.match(/gpt-assignment:[\w-]+/)?.[0],
        cmd.prompt.match(/\band session ([\w:-]+)(?=;|\s|$)/)?.[1], cmd.prompt.match(/ef-worker:\d+:[a-f0-9]{64}/)?.[0]];
      const matches = e => [e.innerText, e.textContent].some(value => {
        const text = normalize(value);
        return text === expected || (identity.every(Boolean) && identity.every(id => text.includes(id))
          && text.includes(cmd.prompt.includes('DIRECT_EDITING_V1:') ? 'DIRECT_EDITING_V1:'
            : 'session with the given raw files to make the finished product.'));
      });
      const ownReceipt = () => {
        const users = messages();
        const anchor = users.findLastIndex(matches);
        if (anchor < 0) return false;
        // A retry can acknowledge its submitted prompt, including collapsed/wrapped
        // UI text, but never adopt a conversation with a later competing worker.
        return !users.slice(anchor).some(e => [e.innerText, e.textContent].some(value => {
          const text = normalize(value);
          return identity.every(Boolean) && ([...text.matchAll(/ef-worker:\d+:[a-f0-9]{64}/g)].some(m => m[0] !== identity[2])
            || [...text.matchAll(/gpt-assignment:[\w-]+/g)].some(m => m[0] !== identity[0])
            || [...text.matchAll(/\band session ([\w:-]+)(?=;|\s|$)/g)].some(m => m[1] !== identity[1]));
        }));
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
  function executionStatus(target) {
    // Inspect only the supervisor-owned continuation. No prompt/credential/text leaves the tab.
    const users = messages();
    const texts = node => [node?.textContent, node?.innerText].filter(value => typeof value === 'string')
      .map(value => value.replace(/[\u200b-\u200f\ufeff]/g, ''));
    const observation = { userNodes: users.length,
      hasAssignment: users.some(node => texts(node).some(text => text.includes(target.assignmentId || '\u0000'))),
      hasSession: users.some(node => texts(node).some(text => text.includes(target.sessionId || '\u0000'))),
      hasGeneration: users.some(node => texts(node).some(text => text.includes('ef-worker:' + target.generation + ':'))) };
    const result = (state, reason) => ({ state, observation: { ...observation, reason, observerHealthy: true } });
    if (!target.assignmentId || !target.sessionId || !Number.isInteger(target.generation)) return result('UNKNOWN', 'INVALID_TARGET');
    const owns = node => texts(node).some(text => text.includes(target.assignmentId) && text.includes(target.sessionId)
      && text.includes('ef-worker:' + target.generation + ':'));
    let anchorIndex = users.findLastIndex(owns);
    // The full verified send receipt already binds this exact tab/generation.
    // ChatGPT can collapse the entire continuation, hiding every identity field.
    // Retain that binding while still checking all visible users for a competing
    // continuation and requiring processing/final controls for the latest turn.
    if (anchorIndex < 0 && target.deliveryConfirmed === true
      && target.expectedUrl && target.expectedUrl === location.href) anchorIndex = 0;
    if (anchorIndex < 0) return result('UNKNOWN', 'OWNER_PROMPT_NOT_FOUND');
    // Nested/collapsed bubbles and normal follow-ups do not discard the retained owner.
    // A later continuation for a different worker or assignment does invalidate it.
    for (const node of users.slice(anchorIndex)) {
      const competing = texts(node).some(text => [...text.matchAll(/ef-worker:(\d+):/g)].some(match => Number(match[1]) !== target.generation)
        || [...text.matchAll(/gpt-assignment:[\w-]+/g)].some(match => match[0] !== target.assignmentId)
        || [...text.matchAll(/\band session ([\w:-]+)(?=;|\s|$)/g)].some(match => match[1] !== target.sessionId));
      if (competing) return result('UNKNOWN', 'NEWER_FOREIGN_CONTINUATION');
    }
    observation.ownerVerified = true;
    const lastUser = users.at(-1);
    const stopping = findButton('button[data-testid="stop-button"]', /stop (generating|streaming|response|responding)|^stop$/);
    const streaming = [...document.querySelectorAll('[data-is-streaming="true"], [data-is-streaming="1"]')].some(visible);
    const assistant = [...document.querySelectorAll('[data-message-author-role="assistant"], [data-turn="assistant"]')].at(-1);
    const currentAssistant = assistant && !(typeof lastUser?.compareDocumentPosition === 'function'
      && !(lastUser.compareDocumentPosition(assistant) & 4));
    const turn = currentAssistant && (assistant.closest?.('article, [data-testid^="conversation-turn-"]') || assistant);
    const busy = turn && [...turn.querySelectorAll('[aria-busy="true"], [data-testid="thinking-indicator"], [data-testid="research-in-progress"]')].some(visible);
    observation.processing = !!(stopping || streaming || busy);
    if (observation.processing) return result('PROCESSING', 'OWNED_PROCESSING');
    const composer = document.querySelector('#prompt-textarea, [contenteditable="true"][role="textbox"], textarea');
    const composerUsable = !!(visible(composer) && composer.getAttribute?.('aria-disabled') !== 'true'
      && composer.getAttribute?.('contenteditable') !== 'false' && !composer.readOnly);
    observation.shellReady = document.readyState === 'complete' && composerUsable;
    // Inspect semantic error surfaces, never arbitrary user/assistant prose. A
    // quoted expiry message, historical error, or ordinary tool output isn't death.
    const errors = [...document.querySelectorAll('[role="alert"], [role="alertdialog"], [data-testid="conversation-error"], [data-testid="conversation-turn-error"], [data-testid="error-message"], [data-testid="session-expired"]')]
      .filter(node => visible(node) && !node.closest?.('[data-message-author-role="user"], [data-turn="user"]'))
      .filter(node => {
        const ownerTurn = node.closest?.('article, [data-testid^="conversation-turn-"]');
        return !ownerTurn || ownerTurn === turn;
      });
    const recovery = errors.some(node => [...node.querySelectorAll('button, a')].some(button => visible(button)
      && /retry|try again|new chat|reload|refresh|start over/i.test(button.getAttribute?.('aria-label') || button.textContent || '')));
    const expiry = errors.some(node => /(?:session|conversation|chat).{0,40}(?:expired|has ended|no longer available)|(?:maximum|max).{0,30}(?:(?:conversation|chat).{0,30}(?:length|limit)|length.{0,30}(?:conversation|chat))|conversation.{0,40}(?:too long|length limit)/i.test(node.textContent || ''));
    observation.terminalSurface = errors.length > 0;
    observation.composerUsable = composerUsable;
    observation.recoveryAction = recovery;
    if (expiry && (!composerUsable || recovery)) return result('EXPIRED', 'OWNED_EXPIRED');
    if (errors.length && !composerUsable && recovery) return result('UNUSABLE', 'OWNED_UNUSABLE');
    if (!currentAssistant) return result('UNKNOWN', 'NO_CURRENT_ASSISTANT');
    const finishedControl = [...turn.querySelectorAll('button[data-testid="copy-turn-action-button"], button[data-testid="copy-response-button"], button[data-testid="good-response-turn-action-button"], button[data-testid="bad-response-turn-action-button"], button[aria-label="Copy response"], button[aria-label="Good response"], button[aria-label="Bad response"]')].some(visible);
    return result(finishedControl ? 'FINISHED' : 'UNKNOWN', finishedControl ? 'OWNED_FINISHED' : 'NO_FINAL_CONTROLS');
  }

  const listener = (cmd, _sender, respond) => {
    if (cmd.type === 'EDITFLOW_ACTUATOR_STATUS') { respond(executionStatus(cmd)); return; }
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
