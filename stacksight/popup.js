// StackSight — popup UI logic (v1.3)

const KEYS = {
  STACKS: 'stacks',
  ITEMS: 'items',
  DISMISSED: 'dismissed',
  LAST_LAUNCHED: 'lastLaunchedUrl',
  CURRENCY: 'currency',
  ONBOARDING: 'onboardingShown'
};

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 30;
const RECENT_PERIOD_DAYS = 30;
const RENEWAL_WARN_DAYS = 7;
const CANDIDATES_TAB = '__candidates';
const RECENT_VISITS_MAX = 30;

// SECURITY caps
const MAX_NOTE_LEN = 2000;
const MAX_STACK_NAME_LEN = 40;
const MAX_NAME_LEN = 200;

const state = {
  stacks: [],
  items: {},
  activeTab: 'all',
  search: '',
  editingUrl: null,
  filteredItems: [],
  selectedIdx: 0,
  lastLaunchedUrl: '',
  currency: '$',
  onboardingShown: false,
  selectMode: false,
  selected: new Set(),
  pendingImport: null
};

// ---------- Storage ----------

async function loadState() {
  const data = await chrome.storage.local.get([
    KEYS.STACKS, KEYS.ITEMS, KEYS.LAST_LAUNCHED, KEYS.CURRENCY, KEYS.ONBOARDING
  ]);
  state.stacks = data[KEYS.STACKS] || ['Default'];
  state.items = data[KEYS.ITEMS] || {};
  state.lastLaunchedUrl = data[KEYS.LAST_LAUNCHED] || '';
  state.currency = data[KEYS.CURRENCY] || '$';
  state.onboardingShown = data[KEYS.ONBOARDING] === true;
}

async function safeSet(obj, errorMsg) {
  try {
    await chrome.storage.local.set(obj);
    return true;
  } catch {
    if (errorMsg) alert(errorMsg);
    return false;
  }
}

const saveStacks = () => safeSet({ [KEYS.STACKS]: state.stacks },
  'Could not save changes — local storage may be full.');
const saveItems = () => safeSet({ [KEYS.ITEMS]: state.items },
  'Could not save changes — local storage may be full. Try exporting and trimming items.');
const saveCurrency = () => safeSet({ [KEYS.CURRENCY]: state.currency }, null);
const saveOnboarding = () => safeSet({ [KEYS.ONBOARDING]: state.onboardingShown }, null);
const saveLastLaunched = (url) => safeSet({ [KEYS.LAST_LAUNCHED]: url }, null);

// ---------- Helpers ----------

function clamp(s, max) {
  return typeof s === 'string' && s.length > max ? s.slice(0, max) : (s || '');
}

function getOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch { return null; }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
function fmt$(n) {
  return state.currency + (Number(n) || 0).toFixed(2);
}
function fmt$0(n) {
  return state.currency + Math.round(Number(n) || 0);
}

// ---------- Calculations ----------

function monthlyCost(item) {
  if (!item.cost || !item.billingCycle) return 0;
  if (item.billingCycle === 'monthly') return item.cost;
  if (item.billingCycle === 'yearly') return item.cost / 12;
  return 0;
}

function totalMonthlyCost() {
  return Object.values(state.items).reduce((s, i) => s + monthlyCost(i), 0);
}

function getVisitLog(item) {
  if (Array.isArray(item.recentVisits)) return item.recentVisits;
  return item.lastVisited ? [item.lastVisited] : [];
}

function visitsInPeriod(item, days) {
  const cutoff = Date.now() - days * DAY_MS;
  return getVisitLog(item).filter(t => t >= cutoff).length;
}

function isStale(item) {
  return visitsInPeriod(item, STALE_DAYS) === 0;
}

function candidates() {
  return Object.values(state.items).filter(i => isStale(i) && monthlyCost(i) > 0);
}

function candidatesMonthly() {
  return candidates().reduce((s, i) => s + monthlyCost(i), 0);
}

function nextRenewal(item) {
  if (!item.renewalDate || !item.billingCycle) return null;
  const date = new Date(item.renewalDate + 'T00:00:00');
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  // Auto-roll past renewals forward by the billing period.
  let guard = 0;
  while (date < now && guard++ < 240) {
    if (item.billingCycle === 'monthly') date.setMonth(date.getMonth() + 1);
    else if (item.billingCycle === 'yearly') date.setFullYear(date.getFullYear() + 1);
    else break;
  }
  return date;
}

function daysUntilRenewal(item) {
  const next = nextRenewal(item);
  if (!next) return null;
  return Math.ceil((next - new Date()) / DAY_MS);
}

function imminentRenewal() {
  return Object.values(state.items)
    .map(i => ({ item: i, days: daysUntilRenewal(i) }))
    .filter(r => r.days !== null && r.days >= 0 && r.days <= RENEWAL_WARN_DAYS)
    .sort((a, b) => a.days - b.days)[0];
}

function formatRelative(ts) {
  if (!ts) return 'Never';
  const days = Math.floor((Date.now() - ts) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDateShort(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- Rendering ----------

function render() {
  renderTotal();
  renderTabs();
  renderRenewalBanner();
  renderItems();
}

function renderTotal() {
  const m = totalMonthlyCost();
  const y = m * 12;
  document.getElementById('cost-total').innerHTML =
    `<span class="cost-monthly">${fmt$(m)}/mo</span>` +
    (m > 0 ? ` <span class="cost-yearly">${fmt$0(y)}/yr</span>` : '');
}

function renderTabs() {
  const el = document.getElementById('tabs');
  const cands = candidates();
  const tabs = ['all'];
  if (cands.length > 0) tabs.push(CANDIDATES_TAB);
  tabs.push(...state.stacks);

  el.innerHTML = tabs.map(t => {
    let label, cls;
    if (t === 'all') { label = 'All'; cls = 'tab'; }
    else if (t === CANDIDATES_TAB) {
      label = `💸 Stale (${fmt$0(candidatesMonthly())})`;
      cls = 'tab tab-candidates';
    } else { label = t; cls = 'tab'; }
    if (state.activeTab === t) cls += ' active';
    return `<button class="${cls}" data-tab="${escapeAttr(t)}">${escapeHtml(label)}</button>`;
  }).join('');

  el.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      state.selectedIdx = 0;
      render();
    });
  });
}

function renderRenewalBanner() {
  const banner = document.getElementById('renewal-banner');
  if (state.selectMode) { banner.hidden = true; return; }
  const r = imminentRenewal();
  if (!r) { banner.hidden = true; return; }
  const { item, days } = r;
  const m = monthlyCost(item);
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  banner.hidden = false;
  banner.innerHTML = `
    <span class="renewal-emoji">🔔</span>
    <strong>${escapeHtml(item.name)}</strong> renews ${when}${m > 0 ? ` · ${fmt$(m)}/mo` : ''}
  `;
  banner.onclick = () => openItemModal(item.url);
}

function renderItems() {
  const el = document.getElementById('items');
  const search = state.search.toLowerCase();

  // Self-correct active tab if it no longer exists.
  const cands = candidates();
  if (state.activeTab === CANDIDATES_TAB && cands.length === 0) {
    state.activeTab = 'all';
  }
  if (state.activeTab !== 'all' && state.activeTab !== CANDIDATES_TAB
      && !state.stacks.includes(state.activeTab)) {
    state.activeTab = 'all';
  }

  let items = Object.values(state.items);
  if (state.activeTab === CANDIDATES_TAB) {
    items = items.filter(i => isStale(i) && monthlyCost(i) > 0);
    items.sort((a, b) => monthlyCost(b) - monthlyCost(a));
  } else {
    if (state.activeTab !== 'all') {
      items = items.filter(i => i.stack === state.activeTab);
    }
    if (search) {
      items = items.filter(i =>
        i.name.toLowerCase().includes(search) ||
        i.url.toLowerCase().includes(search) ||
        i.stack.toLowerCase().includes(search) ||
        (i.note || '').toLowerCase().includes(search));
    }
    items.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));

    if (!search && state.lastLaunchedUrl) {
      const idx = items.findIndex(i => i.url === state.lastLaunchedUrl);
      if (idx > 0) {
        const [last] = items.splice(idx, 1);
        items.unshift(last);
      }
    }
  }

  state.filteredItems = items;
  if (state.selectedIdx >= items.length) {
    state.selectedIdx = Math.max(0, items.length - 1);
  }

  if (items.length === 0) {
    el.innerHTML = renderEmpty();
    return;
  }

  el.innerHTML = items.map((item, idx) => renderItem(item, idx)).join('');
  attachItemHandlers(el);
  scrollSelectedIntoView();
}

function renderEmpty() {
  if (Object.keys(state.items).length === 0) {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const shortcut = isMac ? '⌘ + ⇧ + S' : 'Ctrl + Shift + S';
    return `
      <div class="empty empty-tour">
        <div class="empty-icon">📚</div>
        <div class="empty-title">Welcome to StackSight</div>
        <ol class="tour">
          <li>Visit a site you use often</li>
          <li>Pick a stack on the prompt that appears</li>
          <li>Open this popup anytime with <kbd>${shortcut}</kbd></li>
        </ol>
        <p class="tour-foot">Or click <strong>+ Add</strong> below to start manually.</p>
      </div>`;
  }
  if (state.search) {
    return `<div class="empty">No items match <strong>${escapeHtml(state.search)}</strong>.</div>`;
  }
  return `<div class="empty">No items in this view.</div>`;
}

function renderItem(item, idx) {
  const stale = isStale(item);
  const m = monthlyCost(item);
  const recent30 = visitsInPeriod(item, RECENT_PERIOD_DAYS);

  const costPill = m > 0 ? `<span class="pill cost-pill">${fmt$(m)}/mo</span>` : '';
  const staleFlag = stale ? `<span class="stale-flag">stale</span>` : '';
  const note = item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : '';

  let visitInfo = '';
  if (m > 0) {
    if (recent30 > 0) {
      visitInfo = ` · <span class="visit-info">${fmt$(m / recent30)}/visit</span>`;
    } else {
      visitInfo = ` · <span class="visit-info visit-info-warn">unused this month</span>`;
    }
  } else if (item.visitCount && item.visitCount > 0) {
    visitInfo = ` · <span class="visit-info">${item.visitCount} visit${item.visitCount === 1 ? '' : 's'}</span>`;
  }

  // Renewal info
  let renewalInfo = '';
  const days = daysUntilRenewal(item);
  if (days !== null) {
    if (days <= RENEWAL_WARN_DAYS) {
      const txt = days === 0 ? 'renews today' : days === 1 ? 'renews tomorrow' : `renews in ${days}d`;
      renewalInfo = ` · <span class="renewal-info renewal-soon">${txt}</span>`;
    } else if (days <= 30) {
      const next = nextRenewal(item);
      renewalInfo = ` · <span class="renewal-info">renews ${formatDateShort(next)}</span>`;
    }
  }

  const sel = idx === state.selectedIdx ? ' selected' : '';
  const checked = state.selected.has(item.url);
  const checkedCls = checked ? ' checked' : '';
  const checkbox = state.selectMode
    ? `<button class="bulk-check${checkedCls}" data-action="check" aria-label="Toggle selection">${checked ? '☑' : '☐'}</button>`
    : '';
  const actions = state.selectMode ? '' : `
    <div class="item-actions">
      <button class="icon-btn" data-action="open" title="Open">↗</button>
      <button class="icon-btn" data-action="edit" title="Edit">✎</button>
    </div>`;

  return `
    <div class="item ${stale ? 'is-stale' : ''}${sel}${checkedCls}" data-url="${escapeAttr(item.url)}" data-idx="${idx}">
      ${checkbox}
      <div class="item-main">
        <div class="item-name">${escapeHtml(item.name)} ${staleFlag}</div>
        <div class="item-meta">
          <span class="pill stack-pill">${escapeHtml(item.stack)}</span>
          <span class="last-visited">${formatRelative(item.lastVisited)}${visitInfo}${renewalInfo}</span>
          ${costPill}
        </div>
        ${note}
      </div>
      ${actions}
    </div>`;
}

function attachItemHandlers(el) {
  el.querySelectorAll('.item').forEach(node => {
    const url = node.dataset.url;

    if (state.selectMode) {
      // Whole row toggles selection in select mode
      node.addEventListener('click', () => {
        toggleSelected(url);
      });
    } else {
      const openBtn = node.querySelector('[data-action="open"]');
      const editBtn = node.querySelector('[data-action="edit"]');
      if (openBtn) openBtn.addEventListener('click', (e) => { e.stopPropagation(); openFromPopup(url); });
      if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openItemModal(url); });
    }
  });
}

// ---------- Bulk select ----------

function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  state.selected.clear();
  renderRenewalBanner();
  renderBulkBar();
  renderItems();
  document.getElementById('btn-select').textContent = state.selectMode ? '✕ Done' : '☐ Select';
}

function toggleSelected(url) {
  if (state.selected.has(url)) state.selected.delete(url);
  else state.selected.add(url);
  renderBulkBar();
  renderItems();
}

function renderBulkBar() {
  const bar = document.getElementById('bulk-bar');
  if (!state.selectMode) { bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById('bulk-count').textContent =
    state.selected.size === 0 ? 'Select items below'
      : `${state.selected.size} selected`;
  const stackSel = document.getElementById('bulk-stack');
  stackSel.innerHTML = state.stacks.map(s =>
    `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
}

async function bulkMove() {
  if (state.selected.size === 0) { alert('Select at least one item.'); return; }
  const target = document.getElementById('bulk-stack').value;
  if (!target) return;
  for (const url of state.selected) {
    if (state.items[url]) state.items[url].stack = target;
  }
  await saveItems();
  state.selected.clear();
  renderBulkBar();
  render();
}

async function bulkDelete() {
  if (state.selected.size === 0) { alert('Select at least one item.'); return; }
  if (!confirm(`Delete ${state.selected.size} item(s)?`)) return;
  for (const url of state.selected) delete state.items[url];
  await saveItems();
  state.selected.clear();
  renderBulkBar();
  render();
}

// ---------- Keyboard launcher ----------

function moveSelection(delta) {
  if (state.filteredItems.length === 0) return;
  state.selectedIdx = Math.max(0,
    Math.min(state.filteredItems.length - 1, state.selectedIdx + delta));
  document.querySelectorAll('#items .item').forEach((el, i) => {
    el.classList.toggle('selected', i === state.selectedIdx);
  });
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  const selEl = document.querySelector('#items .item.selected');
  if (selEl) selEl.scrollIntoView({ block: 'nearest' });
}

async function openFromPopup(url) {
  state.lastLaunchedUrl = url;
  await saveLastLaunched(url);
  try { chrome.tabs.create({ url }); } catch {}
}

function openSelected() {
  if (state.filteredItems.length === 0) return;
  const item = state.filteredItems[state.selectedIdx];
  if (!item) return;
  openFromPopup(item.url);
}

// ---------- Item modal ----------

function openItemModal(url = null) {
  state.editingUrl = url;
  const modal = document.getElementById('item-modal');
  const title = document.getElementById('item-modal-title');
  const nameEl = document.getElementById('item-name');
  const urlEl = document.getElementById('item-url');
  const stackEl = document.getElementById('item-stack');
  const costEl = document.getElementById('item-cost');
  const billingEl = document.getElementById('item-billing');
  const renewalEl = document.getElementById('item-renewal');
  const noteEl = document.getElementById('item-note');
  const deleteBtn = document.getElementById('item-delete');

  stackEl.innerHTML = state.stacks
    .map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');

  if (url && state.items[url]) {
    const item = state.items[url];
    title.textContent = 'Edit Item';
    nameEl.value = item.name;
    urlEl.value = item.url;
    urlEl.disabled = true;
    stackEl.value = item.stack;
    costEl.value = item.cost ?? '';
    billingEl.value = item.billingCycle ?? '';
    renewalEl.value = item.renewalDate ?? '';
    noteEl.value = item.note || '';
    deleteBtn.hidden = false;
  } else {
    title.textContent = 'Add Item';
    nameEl.value = '';
    urlEl.value = '';
    urlEl.disabled = false;
    stackEl.value = state.stacks[0] || '';
    costEl.value = '';
    billingEl.value = '';
    renewalEl.value = '';
    noteEl.value = '';
    deleteBtn.hidden = true;
  }

  toggleRenewalRow();
  modal.hidden = false;
  nameEl.focus();
}

function toggleRenewalRow() {
  const billing = document.getElementById('item-billing').value;
  document.getElementById('renewal-row').hidden = !billing;
}

function closeItemModal() {
  document.getElementById('item-modal').hidden = true;
  state.editingUrl = null;
}

async function saveItem() {
  const name = document.getElementById('item-name').value.trim();
  const urlRaw = document.getElementById('item-url').value.trim();
  const stack = document.getElementById('item-stack').value;
  const costRaw = document.getElementById('item-cost').value;
  const billing = document.getElementById('item-billing').value;
  const renewalRaw = document.getElementById('item-renewal').value;
  const note = document.getElementById('item-note').value.trim();

  if (!name || !urlRaw) {
    alert('Name and URL are required.');
    return;
  }
  if (name.length > MAX_NAME_LEN) { alert(`Name must be ${MAX_NAME_LEN} characters or less.`); return; }
  if (note.length > MAX_NOTE_LEN) { alert(`Notes must be ${MAX_NOTE_LEN} characters or less.`); return; }

  let normalizedUrl;
  try {
    const parsed = new URL(urlRaw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      alert('Only http:// and https:// URLs are supported.');
      return;
    }
    normalizedUrl = parsed.origin;
  } catch {
    alert('Please enter a valid URL (e.g., https://example.com).');
    return;
  }

  const cost = costRaw !== '' ? parseFloat(costRaw) : null;
  const billingCycle = cost && billing ? billing : null;
  const renewalDate = (cost && billingCycle && renewalRaw) ? renewalRaw : null;

  if (state.editingUrl) {
    const existing = state.items[state.editingUrl];
    state.items[state.editingUrl] = {
      ...existing, name, stack, cost, billingCycle, renewalDate, note
    };
  } else {
    if (state.items[normalizedUrl]) { alert('This site is already in a stack.'); return; }
    const now = Date.now();
    state.items[normalizedUrl] = {
      name, url: normalizedUrl, stack, cost, billingCycle, renewalDate,
      lastVisited: now, visitCount: 1, recentVisits: [now], note
    };
  }

  if (!await saveItems()) return;
  closeItemModal();
  render();
}

async function deleteItem() {
  if (!state.editingUrl) return;
  if (!confirm('Delete this item?')) return;
  delete state.items[state.editingUrl];
  await saveItems();
  closeItemModal();
  render();
}

// ---------- Stacks modal ----------

function openStacksModal() {
  renderStacksList();
  document.getElementById('stacks-modal').hidden = false;
}
function closeStacksModal() {
  document.getElementById('stacks-modal').hidden = true;
}

function renderStacksList() {
  const el = document.getElementById('stacks-list');
  el.innerHTML = state.stacks.map(s => {
    const count = Object.values(state.items).filter(i => i.stack === s).length;
    return `
      <div class="stack-row" data-stack="${escapeAttr(s)}">
        <span class="stack-name">${escapeHtml(s)} <span class="stack-count">(${count})</span></span>
        <div class="stack-row-actions">
          <button class="icon-btn" data-action="rename">Rename</button>
          <button class="icon-btn" data-action="delete">Delete</button>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.stack-row').forEach(row => {
    const name = row.dataset.stack;
    row.querySelector('[data-action="rename"]').addEventListener('click', () => renameStack(name));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteStack(name));
  });
}

async function addStack() {
  const input = document.getElementById('new-stack-name');
  const name = input.value.trim();
  if (!name) return;
  if (name.length > MAX_STACK_NAME_LEN) {
    alert(`Stack names must be ${MAX_STACK_NAME_LEN} characters or less.`); return;
  }
  if (state.stacks.includes(name)) { alert('A stack with that name already exists.'); return; }
  state.stacks.push(name);
  input.value = '';
  if (!await saveStacks()) { state.stacks.pop(); return; }
  renderStacksList();
  renderTabs();
}

async function renameStack(oldName) {
  const newName = prompt('Rename stack:', oldName);
  if (!newName) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;
  if (trimmed.length > MAX_STACK_NAME_LEN) {
    alert(`Stack names must be ${MAX_STACK_NAME_LEN} characters or less.`); return;
  }
  if (state.stacks.includes(trimmed)) { alert('A stack with that name already exists.'); return; }
  state.stacks = state.stacks.map(s => (s === oldName ? trimmed : s));
  for (const url in state.items) {
    if (state.items[url].stack === oldName) state.items[url].stack = trimmed;
  }
  if (state.activeTab === oldName) state.activeTab = trimmed;
  await saveStacks();
  await saveItems();
  renderStacksList();
  render();
}

async function deleteStack(name) {
  if (state.stacks.length <= 1) { alert('You need at least one stack.'); return; }
  const count = Object.values(state.items).filter(i => i.stack === name).length;
  const fallback = state.stacks.find(s => s !== name);
  let confirmMsg = `Delete stack "${name}"?`;
  if (count > 0) confirmMsg += `\n\n${count} item(s) will be moved to "${fallback}".`;
  if (!confirm(confirmMsg)) return;

  for (const url in state.items) {
    if (state.items[url].stack === name) state.items[url].stack = fallback;
  }
  state.stacks = state.stacks.filter(s => s !== name);
  if (state.activeTab === name) state.activeTab = 'all';
  await saveStacks();
  await saveItems();
  renderStacksList();
  render();
}

// ---------- Export / Import ----------

function exportJson() {
  const data = {
    exportedAt: new Date().toISOString(),
    version: '1.3.0',
    stacks: state.stacks,
    items: state.items,
    currency: state.currency
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stacksight-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerImport() {
  document.getElementById('import-file').click();
}

async function handleImportFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    alert('File too large (max 10 MB).');
    return;
  }
  let text;
  try { text = await file.text(); } catch { alert('Could not read file.'); return; }

  let data;
  try { data = JSON.parse(text); }
  catch { alert("Couldn't parse file. Make sure it's a valid JSON export."); return; }

  if (!data || typeof data !== 'object' || !Array.isArray(data.stacks) || typeof data.items !== 'object') {
    alert("This file doesn't look like a StackSight export.");
    return;
  }

  // Sanitize
  const validItems = {};
  let skipped = 0;
  for (const [url, item] of Object.entries(data.items)) {
    const origin = getOrigin(url);
    if (!origin) { skipped++; continue; }
    if (!item || typeof item !== 'object') { skipped++; continue; }
    validItems[origin] = {
      name: clamp(typeof item.name === 'string' ? item.name : origin, MAX_NAME_LEN),
      url: origin,
      stack: clamp(typeof item.stack === 'string' ? item.stack : 'Default', MAX_STACK_NAME_LEN),
      cost: typeof item.cost === 'number' ? item.cost : null,
      billingCycle: (item.billingCycle === 'monthly' || item.billingCycle === 'yearly') ? item.billingCycle : null,
      renewalDate: typeof item.renewalDate === 'string' ? item.renewalDate : null,
      lastVisited: typeof item.lastVisited === 'number' ? item.lastVisited : Date.now(),
      visitCount: typeof item.visitCount === 'number' ? item.visitCount : 1,
      recentVisits: Array.isArray(item.recentVisits)
        ? item.recentVisits.filter(t => typeof t === 'number').slice(0, RECENT_VISITS_MAX)
        : [],
      note: clamp(typeof item.note === 'string' ? item.note : '', MAX_NOTE_LEN)
    };
  }
  const validStacks = data.stacks
    .filter(s => typeof s === 'string')
    .map(s => clamp(s, MAX_STACK_NAME_LEN));

  if (Object.keys(validItems).length === 0) {
    alert('No valid items found in this file.');
    return;
  }

  state.pendingImport = { items: validItems, stacks: validStacks, skipped };

  // Show confirm modal
  const summary = document.getElementById('import-summary');
  const itemCount = Object.keys(validItems).length;
  summary.innerHTML = `
    <div class="import-line"><strong>${itemCount}</strong> item${itemCount === 1 ? '' : 's'} in <strong>${validStacks.length}</strong> stack${validStacks.length === 1 ? '' : 's'}</div>
    ${skipped > 0 ? `<div class="import-line import-warn">${skipped} entr${skipped === 1 ? 'y' : 'ies'} skipped (invalid URL or shape)</div>` : ''}
  `;
  document.getElementById('import-modal').hidden = false;
}

async function applyImport(mode) {
  if (!state.pendingImport) return;
  const { items, stacks } = state.pendingImport;

  if (mode === 'replace') {
    state.items = items;
    state.stacks = stacks.length ? stacks : ['Default'];
  } else {
    for (const s of stacks) {
      if (!state.stacks.includes(s)) state.stacks.push(s);
    }
    for (const [url, item] of Object.entries(items)) {
      if (!state.items[url]) state.items[url] = item;
    }
  }
  await saveItems();
  await saveStacks();
  state.pendingImport = null;
  document.getElementById('import-modal').hidden = true;
  document.getElementById('import-file').value = '';
  render();
}

function cancelImport() {
  state.pendingImport = null;
  document.getElementById('import-modal').hidden = true;
  document.getElementById('import-file').value = '';
}

// ---------- Settings ----------

const LEGAL_HTML = `
<h4>Warranty disclaimer.</h4>
<p>StackSight is provided strictly <strong>"as-is"</strong> and <strong>"as-available"</strong>, without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, accuracy, reliability, security, non-infringement, or uninterrupted operation.</p>
<h4>Limitation of liability.</h4>
<p>To the fullest extent permitted by applicable law, the author shall not be liable for any direct, indirect, incidental, consequential, special, or exemplary damages arising from or related to the use of, or inability to use, StackSight — including loss of data, loss of profits, business interruption, or any other damages — even if the author has been advised of the possibility of such damages.</p>
<h4>Privacy.</h4>
<p>StackSight stores all user data exclusively within the local browser profile via <code>chrome.storage.local</code>. No data is transmitted, synchronised, or shared with any external server, third party, or analytics service. Removing the extension or clearing browser storage erases all data permanently and irrecoverably.</p>
<h4>User responsibility.</h4>
<p>The user is solely responsible for the data they enter. <strong>Do not store sensitive information</strong> (passwords, financial credentials, personal identifiers) in any field, including the notes field. Local browser storage is not encrypted.</p>
<h4>Third-party content.</h4>
<p>Display of any URL, name, or cost figure within StackSight does not constitute endorsement, affiliation, or sponsorship. Trademarks remain the property of their respective owners.</p>
<h4>Intellectual property &amp; permitted use.</h4>
<p>StackSight is created by <strong>Bhargavaram Krishnapur</strong> as a personal and educational project. Use and modification permitted for personal, non-commercial purposes. Redistribution or commercial deployment requires the express written permission of the author.</p>
<h4>No support obligation.</h4>
<p>The author has no obligation to provide updates, security patches, bug fixes, support, or maintenance. Compatibility with future browser versions is not guaranteed.</p>
<h4>Acceptance.</h4>
<p>By installing or using StackSight, the user acknowledges having read and accepted these terms in full.</p>
`;

function openSettings() {
  document.getElementById('setting-currency').value = state.currency;
  document.getElementById('settings-legal').innerHTML = LEGAL_HTML;
  document.getElementById('settings-modal').hidden = false;
}
function closeSettings() {
  document.getElementById('settings-modal').hidden = true;
}
async function changeCurrency(newCurrency) {
  state.currency = newCurrency;
  await saveCurrency();
  render();
}

// ---------- Coach mark ----------

function maybeShowCoachMark() {
  if (state.onboardingShown) return;
  if (Object.keys(state.items).length === 0) return; // tour handles this
  const mark = document.getElementById('coach-mark');
  mark.hidden = false;
  document.getElementById('coach-dismiss').addEventListener('click', dismissCoachMark);
}

async function dismissCoachMark() {
  document.getElementById('coach-mark').hidden = true;
  state.onboardingShown = true;
  await saveOnboarding();
}

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  render();

  const searchEl = document.getElementById('search');
  searchEl.focus();

  // Show coach mark on first popup open with items present.
  setTimeout(maybeShowCoachMark, 250);

  searchEl.addEventListener('input', (e) => {
    state.search = e.target.value;
    state.selectedIdx = 0;
    renderItems();
  });

  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
    else if (e.key === 'Escape' && searchEl.value !== '') {
      e.preventDefault();
      searchEl.value = '';
      state.search = '';
      state.selectedIdx = 0;
      renderItems();
    }
    // Any keystroke in search dismisses the coach mark
    if (!state.onboardingShown && Object.keys(state.items).length > 0) dismissCoachMark();
  });

  // Set maxlength as defense-in-depth on text inputs.
  document.getElementById('item-name').setAttribute('maxlength', MAX_NAME_LEN);
  document.getElementById('item-note').setAttribute('maxlength', MAX_NOTE_LEN);
  document.getElementById('new-stack-name').setAttribute('maxlength', MAX_STACK_NAME_LEN);

  // Header
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  // Actions bar
  document.getElementById('btn-add').addEventListener('click', () => openItemModal());
  document.getElementById('btn-stacks').addEventListener('click', openStacksModal);
  document.getElementById('btn-export').addEventListener('click', exportJson);
  document.getElementById('btn-import').addEventListener('click', triggerImport);

  // Select toggle
  document.getElementById('btn-select').addEventListener('click', toggleSelectMode);
  document.getElementById('bulk-move').addEventListener('click', bulkMove);
  document.getElementById('bulk-delete').addEventListener('click', bulkDelete);
  document.getElementById('bulk-done').addEventListener('click', toggleSelectMode);

  // Import file
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    handleImportFile(file);
  });
  document.getElementById('import-cancel').addEventListener('click', cancelImport);
  document.getElementById('import-merge').addEventListener('click', () => applyImport('merge'));
  document.getElementById('import-replace').addEventListener('click', () => {
    if (confirm('This will erase all current data and replace it with the imported data. Continue?')) {
      applyImport('replace');
    }
  });

  // Item modal
  document.getElementById('item-cancel').addEventListener('click', closeItemModal);
  document.getElementById('item-save').addEventListener('click', saveItem);
  document.getElementById('item-delete').addEventListener('click', deleteItem);
  document.getElementById('item-billing').addEventListener('change', toggleRenewalRow);

  // Stacks modal
  document.getElementById('stacks-close').addEventListener('click', closeStacksModal);
  document.getElementById('new-stack-add').addEventListener('click', addStack);
  document.getElementById('new-stack-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addStack();
  });

  // Settings modal
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('setting-currency').addEventListener('change', (e) => {
    changeCurrency(e.target.value);
  });

  // Live updates if background mutates storage while popup is open.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[KEYS.ITEMS]) {
      state.items = changes[KEYS.ITEMS].newValue || {};
      render();
    }
    if (changes[KEYS.STACKS]) {
      state.stacks = changes[KEYS.STACKS].newValue || [];
      render();
    }
    if (changes[KEYS.LAST_LAUNCHED]) {
      state.lastLaunchedUrl = changes[KEYS.LAST_LAUNCHED].newValue || '';
    }
    if (changes[KEYS.CURRENCY]) {
      state.currency = changes[KEYS.CURRENCY].newValue || '$';
      render();
    }
  });
});
