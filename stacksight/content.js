// StackSight — content script (v1.3)

const TITLE_DISPLAY_MAX = 80;
const STACK_NAME_MAX = 40;

let promptShown = false;

// Wrap runtime.sendMessage so the user closing the tab mid-action
// never produces "Receiving end does not exist" or unhandled promise rejections.
function safeRuntimeSendMessage(msg) {
  try {
    return chrome.runtime.sendMessage(msg).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SHOW_PROMPT') return false;

  if (msg.force) {
    const existing = document.getElementById('stacksight-prompt');
    if (existing) existing.remove();
    promptShown = false;
  }

  if (promptShown) return false;

  showPrompt(msg.origin, msg.title, msg.stacks, msg.currentStack);
  promptShown = true;

  // No async response — explicitly close the channel.
  return false;
});

function showPrompt(origin, title, stacks, currentStack) {
  if (document.getElementById('stacksight-prompt')) return;

  // SECURITY: cap the page-controlled title to a reasonable display length.
  const displayTitle = (typeof title === 'string' && title.length > TITLE_DISPLAY_MAX)
    ? title.slice(0, TITLE_DISPLAY_MAX - 1) + '…'
    : (title || origin);

  const root = document.createElement('div');
  root.id = 'stacksight-prompt';

  const stackOptions = stacks.map(s => {
    const sel = s === currentStack ? ' selected' : '';
    return `<option value="${escapeAttr(s)}"${sel}>${escapeHtml(s)}</option>`;
  }).join('');

  const heading = currentStack
    ? `In <strong>${escapeHtml(currentStack)}</strong>. Move?`
    : 'Add this site to a stack?';
  const ctaLabel = currentStack ? 'Save' : 'Add';

  // Origin (verified by Chrome) is rendered first and given more visual weight,
  // so a misleading <title> can't masquerade as the site identity.
  root.innerHTML = `
    <div class="ss-card">
      <div class="ss-header">
        <span class="ss-logo">StackSight</span>
        <button class="ss-close" data-action="dismiss" title="Don't ask again for this site">✕</button>
      </div>
      <div class="ss-body">
        <div class="ss-question">${heading}</div>
        <div class="ss-origin">${escapeHtml(origin)}</div>
        <div class="ss-title" title="${escapeAttr(displayTitle)}">${escapeHtml(displayTitle)}</div>
        <select class="ss-select">
          ${stackOptions}
          <option value="__new__">+ Create new stack…</option>
        </select>
        <input class="ss-new-stack" type="text" maxlength="${STACK_NAME_MAX}" placeholder="New stack name" style="display:none" />
        <div class="ss-actions">
          <button class="ss-btn-skip" data-action="skip">Not now</button>
          <button class="ss-btn-add" data-action="add">${ctaLabel}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const select = root.querySelector('.ss-select');
  const newInput = root.querySelector('.ss-new-stack');

  select.addEventListener('change', (e) => {
    if (!e.isTrusted) return; // SECURITY
    const isNew = select.value === '__new__';
    newInput.style.display = isNew ? 'block' : 'none';
    if (isNew) newInput.focus();
  });

  root.addEventListener('click', async (e) => {
    if (!e.isTrusted) return; // SECURITY
    const action = e.target.dataset.action;
    if (!action) return;

    if (action === 'add') {
      let stack = select.value;
      if (stack === '__new__') {
        stack = newInput.value.trim();
        if (!stack) {
          newInput.focus();
          return;
        }
        if (stack.length > STACK_NAME_MAX) stack = stack.slice(0, STACK_NAME_MAX);
      }
      await safeRuntimeSendMessage({
        type: 'ADD_ITEM',
        payload: { name: displayTitle, url: origin, stack }
      });
      root.remove();
      promptShown = false;
    } else if (action === 'dismiss') {
      await safeRuntimeSendMessage({ type: 'DISMISS_SITE', origin });
      root.remove();
      promptShown = false;
    } else if (action === 'skip') {
      root.remove();
      promptShown = false;
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
