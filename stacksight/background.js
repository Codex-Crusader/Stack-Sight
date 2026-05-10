// StackSight — background service worker (v1.3)

const KEYS = {
  STACKS: 'stacks',
  ITEMS: 'items',
  DISMISSED: 'dismissed',
  CURRENCY: 'currency',
  ONBOARDING: 'onboardingShown'
};

const CONTEXT_MENU_ID = 'stacksight-add';
const VISIT_THROTTLE_MS = 30 * 1000;
const RECENT_VISITS_MAX = 30;
const MAX_STACK_NAME_LEN = 40;
const MAX_NOTE_LEN = 2000;
const MAX_NAME_LEN = 200;

function getOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function clamp(str, max) {
  if (typeof str !== 'string') return '';
  return str.length > max ? str.slice(0, max) : str;
}

// Wraps tabs.sendMessage so a closed tab / missing content script never
// surfaces an unhandled rejection or "Receiving end does not exist" error.
function safeTabsSendMessage(tabId, msg) {
  try {
    return chrome.tabs.sendMessage(tabId, msg).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

// Storage helpers with silent failure (background must never throw).
async function safeStorageSet(obj) {
  try { await chrome.storage.local.set(obj); return true; }
  catch { return false; }
}

// Seed storage and register the context menu on install / update.
chrome.runtime.onInstalled.addListener(async (details) => {
  const data = await chrome.storage.local.get([
    KEYS.STACKS, KEYS.ITEMS, KEYS.DISMISSED, KEYS.CURRENCY, KEYS.ONBOARDING
  ]);
  const updates = {};
  if (!data[KEYS.STACKS]) updates[KEYS.STACKS] = ['Default'];
  if (!data[KEYS.ITEMS]) updates[KEYS.ITEMS] = {};
  if (!data[KEYS.DISMISSED]) updates[KEYS.DISMISSED] = [];
  if (!data[KEYS.CURRENCY]) updates[KEYS.CURRENCY] = '$';
  if (data[KEYS.ONBOARDING] === undefined) updates[KEYS.ONBOARDING] = false;
  if (Object.keys(updates).length) await safeStorageSet(updates);

  // Re-register context menu (removeAll first so updates don't double-register).
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Add to StackSight',
      contexts: ['page']
    });
  });

  // Open welcome page only on first install.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }).catch(() => {});
  }
});

// Track every completed page load.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const origin = getOrigin(tab.url);
  if (!origin) return;

  const data = await chrome.storage.local.get([KEYS.ITEMS, KEYS.DISMISSED, KEYS.STACKS]);
  const items = data[KEYS.ITEMS] || {};
  const dismissed = data[KEYS.DISMISSED] || [];
  const stacks = data[KEYS.STACKS] || ['Default'];

  if (items[origin]) {
    // Already tracked — bump timestamp + visit count, throttled.
    const recentVisits = Array.isArray(items[origin].recentVisits)
      ? items[origin].recentVisits
      : (items[origin].lastVisited ? [items[origin].lastVisited] : []);
    const now = Date.now();
    const lastVisit = recentVisits[0] || items[origin].lastVisited || 0;
    if (now - lastVisit < VISIT_THROTTLE_MS) return;

    items[origin].lastVisited = now;
    items[origin].visitCount = (items[origin].visitCount || 0) + 1;
    items[origin].recentVisits = [now, ...recentVisits].slice(0, RECENT_VISITS_MAX);
    await safeStorageSet({ [KEYS.ITEMS]: items });
    return;
  }

  if (dismissed.includes(origin)) return;

  // Untracked + not dismissed → show the prompt (silently swallow any reject).
  await safeTabsSendMessage(tabId, {
    type: 'SHOW_PROMPT',
    origin,
    title: tab.title || origin,
    stacks,
    currentStack: null,
    force: false
  });
});

// Right-click → "Add to StackSight": always show the prompt.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  if (!tab || !tab.url || tab.id == null) return;

  const origin = getOrigin(tab.url);
  if (!origin) return;

  const data = await chrome.storage.local.get([KEYS.ITEMS, KEYS.STACKS]);
  const items = data[KEYS.ITEMS] || {};
  const stacks = data[KEYS.STACKS] || ['Default'];
  const currentStack = items[origin] ? items[origin].stack : null;

  await safeTabsSendMessage(tab.id, {
    type: 'SHOW_PROMPT',
    origin,
    title: tab.title || origin,
    stacks,
    currentStack,
    force: true
  });
});

// Handle prompt actions coming back from the content script.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ADD_ITEM') {
    addItem(msg.payload).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'DISMISS_SITE') {
    dismissSite(msg.origin).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

async function addItem(payload) {
  const origin = getOrigin(payload && payload.url);
  if (!origin) return { ok: false, error: 'invalid url' };

  const name = clamp(payload.name || origin, MAX_NAME_LEN);
  const stack = clamp(payload.stack || 'Default', MAX_STACK_NAME_LEN);
  const note = clamp(payload.note || '', MAX_NOTE_LEN);

  const data = await chrome.storage.local.get([KEYS.ITEMS, KEYS.STACKS, KEYS.DISMISSED]);
  const items = data[KEYS.ITEMS] || {};
  const stacks = data[KEYS.STACKS] || ['Default'];
  const dismissed = data[KEYS.DISMISSED] || [];

  if (stack && !stacks.includes(stack)) stacks.push(stack);

  // Re-adding clears the dismissed entry.
  const newDismissed = dismissed.filter(d => d !== origin);

  // Preserve fields like visitCount and recentVisits if already tracked.
  const existing = items[origin] || {};
  const now = Date.now();
  items[origin] = {
    name,
    url: origin,
    stack,
    cost: payload.cost ?? existing.cost ?? null,
    billingCycle: payload.billingCycle ?? existing.billingCycle ?? null,
    renewalDate: payload.renewalDate ?? existing.renewalDate ?? null,
    lastVisited: existing.lastVisited || now,
    visitCount: existing.visitCount || 1,
    recentVisits: Array.isArray(existing.recentVisits) && existing.recentVisits.length
      ? existing.recentVisits
      : [now],
    note: note || existing.note || ''
  };

  const ok = await safeStorageSet({
    [KEYS.ITEMS]: items,
    [KEYS.STACKS]: stacks,
    [KEYS.DISMISSED]: newDismissed
  });
  return { ok };
}

async function dismissSite(origin) {
  if (!getOrigin(origin)) return { ok: false, error: 'invalid origin' };
  const data = await chrome.storage.local.get([KEYS.DISMISSED]);
  const dismissed = data[KEYS.DISMISSED] || [];
  if (!dismissed.includes(origin)) {
    dismissed.push(origin);
    await safeStorageSet({ [KEYS.DISMISSED]: dismissed });
  }
  return { ok: true };
}
