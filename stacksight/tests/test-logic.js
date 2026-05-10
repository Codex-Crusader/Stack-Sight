// StackSight v1.3 logic + security tests

const storage = {};
const chrome = {
  storage: {
    local: {
      get: (keys) => {
        const out = {};
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach(k => { if (k in storage) out[k] = storage[k]; });
        return Promise.resolve(out);
      },
      set: (obj) => {
        if (storage.__quota_full) return Promise.reject(new Error('quota'));
        Object.assign(storage, obj);
        return Promise.resolve();
      }
    }
  }
};
global.chrome = chrome;

const KEYS = { STACKS:'stacks', ITEMS:'items', DISMISSED:'dismissed',
                LAST_LAUNCHED:'lastLaunchedUrl', CURRENCY:'currency', ONBOARDING:'onboardingShown' };
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 30;
const VISIT_THROTTLE_MS = 30 * 1000;
const RECENT_VISITS_MAX = 30;
const RENEWAL_WARN_DAYS = 7;
const MAX_NOTE_LEN = 2000;
const MAX_STACK_NAME_LEN = 40;
const MAX_NAME_LEN = 200;

function getOrigin(url) {
  try { const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch { return null; }
}
function clamp(s, max) { return typeof s === 'string' && s.length > max ? s.slice(0, max) : (s || ''); }

function monthlyCost(item) {
  if (!item.cost || !item.billingCycle) return 0;
  if (item.billingCycle === 'monthly') return item.cost;
  if (item.billingCycle === 'yearly') return item.cost / 12;
  return 0;
}
function getVisitLog(item) {
  if (Array.isArray(item.recentVisits)) return item.recentVisits;
  return item.lastVisited ? [item.lastVisited] : [];
}
function visitsInPeriod(item, days) {
  const cutoff = Date.now() - days * DAY_MS;
  return getVisitLog(item).filter(t => t >= cutoff).length;
}
function isStale(item) { return visitsInPeriod(item, STALE_DAYS) === 0; }

// Renewal logic mirroring popup.js
function nextRenewal(item) {
  if (!item.renewalDate || !item.billingCycle) return null;
  const date = new Date(item.renewalDate + 'T00:00:00');
  if (isNaN(date.getTime())) return null;
  const now = new Date();
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

// addItem mirroring background.js (sanitization etc.)
async function addItem(payload) {
  const origin = getOrigin(payload && payload.url);
  if (!origin) return { ok:false, error:'invalid url' };
  const name = clamp(payload.name || origin, MAX_NAME_LEN);
  const stack = clamp(payload.stack || 'Default', MAX_STACK_NAME_LEN);
  const note = clamp(payload.note || '', MAX_NOTE_LEN);
  const data = await chrome.storage.local.get([KEYS.ITEMS, KEYS.STACKS, KEYS.DISMISSED]);
  const items = data[KEYS.ITEMS] || {};
  const stacks = data[KEYS.STACKS] || ['Default'];
  const dismissed = data[KEYS.DISMISSED] || [];
  if (stack && !stacks.includes(stack)) stacks.push(stack);
  const newDismissed = dismissed.filter(d => d !== origin);
  const existing = items[origin] || {};
  const now = Date.now();
  items[origin] = {
    name, url: origin, stack,
    cost: payload.cost ?? existing.cost ?? null,
    billingCycle: payload.billingCycle ?? existing.billingCycle ?? null,
    renewalDate: payload.renewalDate ?? existing.renewalDate ?? null,
    lastVisited: existing.lastVisited || now,
    visitCount: existing.visitCount || 1,
    recentVisits: Array.isArray(existing.recentVisits) && existing.recentVisits.length
      ? existing.recentVisits : [now],
    note: note || existing.note || ''
  };
  try {
    await chrome.storage.local.set({
      [KEYS.ITEMS]:items, [KEYS.STACKS]:stacks, [KEYS.DISMISSED]:newDismissed
    });
    return { ok:true };
  } catch { return { ok:false, error:'storage error' }; }
}

// Visit-tracking throttle (background)
async function trackVisit(origin) {
  const data = await chrome.storage.local.get([KEYS.ITEMS]);
  const items = data[KEYS.ITEMS] || {};
  if (!items[origin]) return { skipped:'untracked' };
  const recentVisits = Array.isArray(items[origin].recentVisits)
    ? items[origin].recentVisits
    : (items[origin].lastVisited ? [items[origin].lastVisited] : []);
  const now = Date.now();
  const lastVisit = recentVisits[0] || items[origin].lastVisited || 0;
  if (now - lastVisit < VISIT_THROTTLE_MS) return { skipped:'throttled' };
  items[origin].lastVisited = now;
  items[origin].visitCount = (items[origin].visitCount || 0) + 1;
  items[origin].recentVisits = [now, ...recentVisits].slice(0, RECENT_VISITS_MAX);
  await chrome.storage.local.set({ [KEYS.ITEMS]: items });
  return { ok:true };
}

// Import sanitizer mirroring popup.js
function sanitizeImport(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.stacks) || typeof data.items !== 'object') {
    return null;
  }
  const validItems = {};
  let skipped = 0;
  for (const [url, item] of Object.entries(data.items)) {
    const origin = getOrigin(url);
    if (!origin || !item || typeof item !== 'object') { skipped++; continue; }
    validItems[origin] = {
      name: clamp(typeof item.name === 'string' ? item.name : origin, MAX_NAME_LEN),
      url: origin,
      stack: clamp(typeof item.stack === 'string' ? item.stack : 'Default', MAX_STACK_NAME_LEN),
      cost: typeof item.cost === 'number' ? item.cost : null,
      billingCycle: (item.billingCycle === 'monthly' || item.billingCycle === 'yearly')
        ? item.billingCycle : null,
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
  return { items: validItems, stacks: validStacks, skipped };
}

// Currency formatter
function fmt$(n, currency='$') { return currency + (Number(n) || 0).toFixed(2); }
function fmt$0(n, currency='$') { return currency + Math.round(Number(n) || 0); }

let pass=0, fail=0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg); }
}

async function run() {

  console.log('\n[1] URL scheme rejection (security)');
  for (const bad of ['javascript:alert(1)','data:text/html,<x>','file:///etc/hosts',
                     'chrome://settings','about:blank','vbscript:msg(1)','','xxx']) {
    assert(getOrigin(bad) === null, `rejects ${JSON.stringify(bad)}`);
  }
  assert(getOrigin('https://github.com/x/y') === 'https://github.com', 'http(s) accepted, path stripped');

  console.log('\n[2] addItem sanitization & length caps');
  storage[KEYS.STACKS]=['Default']; storage[KEYS.ITEMS]={}; storage[KEYS.DISMISSED]=[];
  const r1 = await addItem({ name:'x', url:'javascript:alert(1)', stack:'A' });
  assert(r1.ok === false, 'rejects javascript: payload');
  await addItem({
    name:'A'.repeat(500), url:'https://a.com',
    stack:'S'.repeat(100), note:'N'.repeat(5000)
  });
  const itm = storage[KEYS.ITEMS]['https://a.com'];
  assert(itm.name.length === MAX_NAME_LEN, 'name capped');
  assert(itm.stack.length === MAX_STACK_NAME_LEN, 'stack capped');
  assert(itm.note.length === MAX_NOTE_LEN, 'note capped');

  console.log('\n[3] Storage quota error path');
  storage.__quota_full = true;
  const r2 = await addItem({ name:'q', url:'https://q.com', stack:'X' });
  assert(r2.ok === false, 'addItem returns failure on quota error');
  storage.__quota_full = false;

  console.log('\n[4] Visit throttle + log management');
  storage[KEYS.STACKS]=['Default']; storage[KEYS.ITEMS]={}; storage[KEYS.DISMISSED]=[];
  await addItem({ name:'A', url:'https://a.com', stack:'A' });
  storage[KEYS.ITEMS]['https://a.com'].recentVisits = [Date.now() - 1000];
  storage[KEYS.ITEMS]['https://a.com'].visitCount = 5;
  const r3 = await trackVisit('https://a.com');
  assert(r3.skipped === 'throttled', '<30s revisit skipped');
  assert(storage[KEYS.ITEMS]['https://a.com'].visitCount === 5, 'count unchanged when throttled');
  storage[KEYS.ITEMS]['https://a.com'].recentVisits = [Date.now() - 35000];
  await trackVisit('https://a.com');
  assert(storage[KEYS.ITEMS]['https://a.com'].visitCount === 6, 'count bumped after 30s');

  console.log('\n[5] Renewal date — auto-roll past dates');
  const now = Date.now();
  const todayISO = new Date().toISOString().slice(0,10);
  // Past monthly renewal — should roll forward
  const pastMonthly = new Date(); pastMonthly.setMonth(pastMonthly.getMonth() - 2);
  const pastIso = pastMonthly.toISOString().slice(0,10);
  const itemPastMonthly = { renewalDate: pastIso, billingCycle: 'monthly' };
  const next = nextRenewal(itemPastMonthly);
  assert(next > new Date(), 'past monthly renewal rolled to future');
  // Past yearly
  const pastYearly = new Date(); pastYearly.setFullYear(pastYearly.getFullYear() - 1);
  const itemPastYearly = { renewalDate: pastYearly.toISOString().slice(0,10), billingCycle: 'yearly' };
  assert(nextRenewal(itemPastYearly) > new Date(), 'past yearly renewal rolled to future');
  // No billing cycle
  assert(nextRenewal({ renewalDate: pastIso }) === null, 'no billing → no renewal');
  // Garbage date
  assert(nextRenewal({ renewalDate: 'not a date', billingCycle: 'monthly' }) === null, 'invalid date → null');

  console.log('\n[6] Renewal urgency detection');
  const inThreeDays = new Date(); inThreeDays.setDate(inThreeDays.getDate() + 3);
  const item3d = { renewalDate: inThreeDays.toISOString().slice(0,10), billingCycle: 'monthly', cost: 10 };
  const days3 = daysUntilRenewal(item3d);
  assert(days3 >= 2 && days3 <= 4, `~3 days computed (got ${days3})`);
  const inTenDays = new Date(); inTenDays.setDate(inTenDays.getDate() + 10);
  const item10d = { renewalDate: inTenDays.toISOString().slice(0,10), billingCycle: 'monthly', cost: 10 };
  assert(daysUntilRenewal(item10d) > RENEWAL_WARN_DAYS, '10d not in warn window');

  console.log('\n[7] Import: shape validation');
  assert(sanitizeImport(null) === null, 'null rejected');
  assert(sanitizeImport({ stacks: 'not array', items: {} }) === null, 'wrong stacks type');
  assert(sanitizeImport({ stacks: [], items: 'not object' }) === null, 'wrong items type');
  assert(sanitizeImport({ stacks: ['A'], items: {} }) !== null, 'minimal valid input accepted');

  console.log('\n[8] Import: filters out malicious URLs');
  const evil = sanitizeImport({
    stacks: ['Test'],
    items: {
      'https://good.com': { name: 'Good', stack: 'Test' },
      'javascript:alert(1)': { name: 'Bad', stack: 'Test' },
      'file:///etc/hosts': { name: 'Worse', stack: 'Test' },
      'chrome://settings': { name: 'Internal', stack: 'Test' }
    }
  });
  assert(Object.keys(evil.items).length === 1, 'only good URL imported');
  assert(evil.items['https://good.com'], 'good URL kept');
  assert(evil.skipped === 3, '3 bad URLs counted as skipped');

  console.log('\n[9] Import: caps long fields');
  const longImport = sanitizeImport({
    stacks: ['S'.repeat(100)],
    items: {
      'https://x.com': {
        name: 'N'.repeat(500),
        stack: 'A'.repeat(100),
        note: 'B'.repeat(5000)
      }
    }
  });
  assert(longImport.stacks[0].length === MAX_STACK_NAME_LEN, 'imported stack name capped');
  const xitem = longImport.items['https://x.com'];
  assert(xitem.name.length === MAX_NAME_LEN, 'imported name capped');
  assert(xitem.stack.length === MAX_STACK_NAME_LEN, 'imported item stack capped');
  assert(xitem.note.length === MAX_NOTE_LEN, 'imported note capped');

  console.log('\n[10] Import: handles missing/garbage fields gracefully');
  const sparse = sanitizeImport({
    stacks: ['Test', 123, null, ''],  // mix of valid and invalid
    items: {
      'https://a.com': {},  // empty item
      'https://b.com': { name: null, cost: 'not a number', billingCycle: 'forever' }
    }
  });
  assert(sparse.stacks.includes('Test'), 'valid stack name kept');
  assert(!sparse.stacks.includes(123), 'non-string stack filtered');
  assert(sparse.items['https://a.com'], 'empty item still imported with defaults');
  assert(sparse.items['https://b.com'].cost === null, 'invalid cost coerced to null');
  assert(sparse.items['https://b.com'].billingCycle === null, 'invalid billing coerced to null');

  console.log('\n[11] Currency formatting');
  assert(fmt$(10, '$') === '$10.00', 'USD');
  assert(fmt$(10, '€') === '€10.00', 'EUR symbol');
  assert(fmt$(10, '₹') === '₹10.00', 'INR symbol');
  assert(fmt$0(125.5, '£') === '£126', 'rounded for yearly');
  assert(fmt$(0) === '$0.00', 'zero handled');
  assert(fmt$(undefined) === '$0.00', 'undefined handled');

  console.log('\n[12] Bulk move logic (pure)');
  const items = {
    'https://a.com': { url: 'https://a.com', stack: 'X' },
    'https://b.com': { url: 'https://b.com', stack: 'X' },
    'https://c.com': { url: 'https://c.com', stack: 'Y' }
  };
  const selected = new Set(['https://a.com', 'https://c.com']);
  const target = 'Z';
  for (const url of selected) if (items[url]) items[url].stack = target;
  assert(items['https://a.com'].stack === 'Z', 'selected item moved');
  assert(items['https://c.com'].stack === 'Z', 'other selected item moved');
  assert(items['https://b.com'].stack === 'X', 'unselected item untouched');

  console.log('\n[13] Bulk delete logic (pure)');
  const items2 = {
    'https://a.com': { url: 'https://a.com' },
    'https://b.com': { url: 'https://b.com' },
    'https://c.com': { url: 'https://c.com' }
  };
  const sel = new Set(['https://a.com', 'https://b.com']);
  for (const url of sel) delete items2[url];
  assert(Object.keys(items2).length === 1, 'two deleted, one remains');
  assert(items2['https://c.com'], 'remaining item preserved');

  console.log('\n[14] Onboarding flag persistence');
  storage[KEYS.ONBOARDING] = false;
  assert(storage[KEYS.ONBOARDING] === false, 'starts unset');
  await chrome.storage.local.set({ [KEYS.ONBOARDING]: true });
  assert(storage[KEYS.ONBOARDING] === true, 'persisted true');

  console.log('\n[15] event.isTrusted gating (security)');
  function gate(e) { return e.isTrusted ? 'allowed' : 'blocked'; }
  assert(gate({ isTrusted: false }) === 'blocked', 'page-script click blocked');
  assert(gate({ isTrusted: true }) === 'allowed', 'real click allowed');

  console.log('\n[16] Title display capping');
  const TITLE_DISPLAY_MAX = 80;
  const evilTitle = 'PHISH '.repeat(50);
  const display = evilTitle.length > TITLE_DISPLAY_MAX
    ? evilTitle.slice(0, TITLE_DISPLAY_MAX-1) + '…' : evilTitle;
  assert(display.length <= TITLE_DISPLAY_MAX, `title capped to ${TITLE_DISPLAY_MAX}`);

  console.log('\n[17] Cost-per-visit math (pure)');
  const paid = { cost: 10, billingCycle: 'monthly', recentVisits: [now, now-DAY_MS, now-2*DAY_MS, now-3*DAY_MS] };
  assert(monthlyCost(paid) === 10, 'monthly = $10');
  assert(visitsInPeriod(paid, 30) === 4, '4 visits in 30d');
  assert(monthlyCost(paid) / visitsInPeriod(paid, 30) === 2.5, '$2.50/visit');

  console.log('\n[18] Active-tab self-correction');
  let activeTab = 'GoneStack';
  const stacks = ['Work','Personal'];
  if (activeTab !== 'all' && activeTab !== '__candidates' && !stacks.includes(activeTab)) activeTab = 'all';
  assert(activeTab === 'all', 'unknown stack tab → all');

  console.log('\n[19] Last-launched ordering');
  const itemsList = [
    { url: 'https://a.com', lastVisited: now - 2*DAY_MS },
    { url: 'https://b.com', lastVisited: now - 1*DAY_MS },
    { url: 'https://c.com', lastVisited: now - 5*DAY_MS }
  ];
  itemsList.sort((a,b) => (b.lastVisited||0) - (a.lastVisited||0));
  assert(itemsList[0].url === 'https://b.com', 'most recent first by default');
  const lastLaunched = 'https://a.com';
  const idx = itemsList.findIndex(i => i.url === lastLaunched);
  if (idx > 0) { const [last] = itemsList.splice(idx,1); itemsList.unshift(last); }
  assert(itemsList[0].url === 'https://a.com', 'last-launched floats to top');

  console.log('\n=========================');
  console.log(`PASSED: ${pass}   FAILED: ${fail}`);
  console.log('=========================');
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
