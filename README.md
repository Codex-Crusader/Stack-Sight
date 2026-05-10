# StackSight 1.3

A Chrome extension that organises sites you use into self-defined **stacks**, tracks how often you actually use them, and surfaces what you're paying for but not using. Local only — no accounts, no backend, no telemetry.

Created by **Bhargavaram Krishnapur** as a personal/educational project.

<p align="center">
  <img src="https://github.com/user-attachments/assets/1a53814a-2647-41f8-8900-5ddcf12c2a64" alt="home" width="45%" />
  <img src="https://github.com/user-attachments/assets/585e55ab-6f4c-4b31-b19f-ed837739867f" alt="settings" width="45%" />
</p>

## Install

1. Unzip this folder somewhere stable (not Downloads — Chrome reads the folder live).
2. Open `chrome://extensions` in Chrome and toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select the `stacksight` folder.
4. Pin the extension from the puzzle-piece menu.

A welcome page opens automatically on first install. After that, the extension is silent until you visit a site you haven't seen before.

## What's new in 1.3

- **JSON Import** with merge-or-replace choice, sanitised against malicious URLs.
- **Bulk select** — multi-select items, move them between stacks, or delete in batch.
- **Renewal date tracking** with a banner when something renews in the next 7 days, plus an inline indicator for further-out renewals.
- **Custom currency** ($, €, £, ¥, ₹, A$, C$).
- **Welcome page** on first install with the keyboard shortcut, three-step orientation, and disclaimer.
- **First-run coach mark** showing the launcher keys.
- **Settings + About modal** with the full disclaimer accessible at any time.
- **Bug fix:** silenced "message port closed" warnings when tabs close mid-prompt.

## Features

### Tracking
- **First-visit prompt** in the bottom-right with the verified origin shown above the page-controlled title.
- **Auto-tracking** with a rolling visit log (last 30 visits per item).
- **Visit throttle** — refresh-bombs and rapid reloads don't inflate counts.
- **Stale flag** — no visits in the last 30 days.

### Quick launcher
- **Ctrl+Shift+S** (Cmd+Shift+S on Mac) opens the popup.
- Search auto-focused; `↑` `↓` to navigate; `Enter` to open; `Esc` to clear.
- The site you most recently launched floats to the top of an empty search.

### Cost insight
- Header shows **monthly total + yearly projection** in your chosen currency.
- Per paid item: **$X/visit** based on real recent usage, or **unused this month** in red.
- A **💸 Stale (cost)** tab appears automatically when stale paid items exist, sorted by cost descending.

### Renewal alerts
- Set an optional next-renewal date on any paid item.
- A banner appears in the popup if anything renews in the next 7 days.
- The renewal date auto-rolls forward by month or year as time passes.

### Right-click menu
Anywhere on a page → **Add to StackSight**. If the site's already tracked, the prompt pre-selects its current stack so you can re-categorise.

### Bulk operations
Click **Select** at the top of the items list to enter select mode. Tap items to select them, then **Move** to a stack or **Delete**.

### Import / Export
- **Export**: one-click JSON download of all stacks, items, costs, and visit history.
- **Import**: choose a previously exported JSON file. Decide whether to **add to existing** items (preserves what you have) or **replace everything**. Malicious URLs (`javascript:`, `file:`, etc.) are filtered out automatically and reported as skipped.

## Security model

This extension was reviewed deliberately, not just "no obvious bugs."

- **No external network calls.** Verified by source audit. All data is local.
- **All HTML insertions escaped.** Every `innerHTML` site uses `escapeHtml`/`escapeAttr` on user-controllable strings.
- **`event.isTrusted` guard.** The on-page prompt ignores synthetic clicks from the underlying page.
- **URL scheme allowlist.** Only `http(s)` reaches storage. `javascript:`, `data:`, `file:`, `chrome:`, `about:`, `vbscript:` rejected at every entry point including imports.
- **Length caps.** Names ≤ 200, stack names ≤ 40, notes ≤ 2000 chars. Enforced at popup, content, background, and import.
- **Storage quota errors handled.** Every write is wrapped; popup surfaces a clear message if storage is full.
- **Page-controlled title is subordinate.** Origin (verified by Chrome) is the primary identity in the prompt; the title is shown smaller, capped at 80 chars.
- **Visit-throttle.** Also serves as a hostile-page mitigation: an auto-reloading page can't grow your storage.
- **Message-port hardening.** All `tabs.sendMessage` and `runtime.sendMessage` calls wrapped against rejected promises from closed tabs / unloaded content scripts.
- **No `eval`, no inline scripts, no `Function` constructor.**

What we **don't** protect against (and shouldn't pretend to):
- Local file access. Anyone with your Chrome profile folder can read `chrome.storage.local`. True of every extension.
- Sensitive info you voluntarily put in the notes field. Don't.

## Data shape

```js
{
  stacks: ["Default", "Work", ...],
  items: {
    "https://github.com": {
      name: "GitHub",
      url: "https://github.com",
      stack: "Work",
      cost: 4.0,
      billingCycle: "monthly",
      renewalDate: "2026-06-15",
      lastVisited: 1700000000000,
      visitCount: 142,
      recentVisits: [t1, t2, ...],
      note: ""
    }
  },
  dismissed: ["https://example.com", ...],
  lastLaunchedUrl: "https://github.com",
  currency: "$",
  onboardingShown: true
}
```

URLs normalise to **origin**. All paths on the same site share one entry.

## Permissions

- `storage` — local persistence.
- `contextMenus` — for the right-click "Add to StackSight" entry.
- `host_permissions: <all_urls>` — to detect navigation. **Never sent anywhere.**

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Service worker — tracking, context menu, welcome page |
| `content.js` | Injected prompt |
| `content.css` | Prompt styling |
| `popup.html` / `popup.js` / `popup.css` | Toolbar popup UI + launcher |
| `welcome.html` / `welcome.css` / `welcome.js` | First-install orientation page |
| `LEGAL.md` | Full disclaimer & terms |
| `icons/` | 16/48/128 PNG icons |

## Customising

Things hardcoded that you might want to change:
- **Stale threshold** (30 days): `STALE_DAYS` in `popup.js`.
- **Visit throttle** (30s): `VISIT_THROTTLE_MS` in `background.js`.
- **Renewal warning window** (7 days): `RENEWAL_WARN_DAYS` in `popup.js`.
- **Brand colour** (`#ff6b35`): `popup.css`, `content.css`, `welcome.css`.
- **Keyboard shortcut**: rebind at `chrome://extensions/shortcuts`.
- **Length caps**: `MAX_NAME_LEN`, `MAX_NOTE_LEN`, `MAX_STACK_NAME_LEN`.

## Development

Clone the repo, then load it directly into Chrome as an unpacked extension — there's no build step. Edit any file, save, and click the refresh icon on the extension card in `chrome://extensions` to reload.

Run the test suite:

```bash
node tests/test-logic.js
```

The tests are dependency-free and run in plain Node. They mirror the pure logic from `background.js` and `popup.js` against a mock `chrome.storage.local`. Exits 0 on all-pass, 1 on any failure. See `tests/README.md` for what's covered.

## Repository structure

```
stacksight/
├── manifest.json                 MV3 manifest
├── background.js                 Service worker
├── content.js / content.css      Injected on-page prompt
├── popup.html / popup.js / popup.css    Toolbar popup
├── welcome.html / welcome.css / welcome.js   First-install page
├── icons/                        16/48/128 PNG icons
├── tests/
│   ├── test-logic.js             50+ logic and security tests
│   └── README.md
├── README.md                     This file
├── INSTALL.txt                   End-user install guide (in release zip)
├── CHANGELOG.md                  Version history
├── LEGAL.md                      Full disclaimer & terms
├── LICENSE                       Personal-use license
└── .gitignore
```

## Legal

See `LEGAL.md` for the full disclaimer and terms of use. Same text is accessible in-extension via Settings (gear icon).

The `LICENSE` file is a custom personal-use license:

> Personal and educational use is permitted. Redistribution, sale, sublicensing, hosting as a service, or any commercial deployment requires the express written permission of the author.

This is a **source-available** license, not an OSI-approved open-source license. If that's important to you, fork it and ask first.
