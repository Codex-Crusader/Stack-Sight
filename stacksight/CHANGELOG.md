# Changelog

All notable changes to StackSight are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely. Versions follow [Semantic Versioning](https://semver.org/) loosely.

---

## [1.3.0] — 2026-05-09

### Added
- **JSON Import** — file picker with merge-or-replace dialog. Sanitises against malicious URLs (`javascript:`, `data:`, `file:`, etc.) and reports skipped entries. Caps long fields on import.
- **Bulk select** — toggle "Select" mode in the items list to multi-select. Bulk Move (with stack picker) and Delete actions.
- **Renewal date tracking** — optional date field on paid items, auto-rolls forward when past, banner appears for renewals in the next 7 days, inline indicator for further-out renewals.
- **Custom currency** — settings dropdown with $, €, £, ¥, ₹, A$, C$.
- **Welcome page** — opens automatically on first install (`reason === 'install'`). Three-step orientation, four feature cards, privacy callout, full disclaimer in expandable section.
- **First-run launcher coach mark** — one-time tooltip showing keyboard shortcuts. Dismissed on click or first keystroke.
- **Settings + About modal** — gear icon in header. Currency picker, expandable disclaimer, version, author credit.
- **Footer credit** — persistent line below actions bar with author name and version.

### Fixed
- Silenced `chrome.runtime.lastError: The message port closed before a response was received` warnings when tabs close mid-prompt. All `tabs.sendMessage` and `runtime.sendMessage` calls wrapped in safe helpers.
- HTML5 `hidden` attribute being overridden by explicit `display: flex/block` on bulk bar and renewal banner. Added global `[hidden]` override.

### Changed
- All storage writes routed through guarded `safeSet` / `safeStorageSet` helpers.
- Content script's `onMessage` listener now explicitly returns `false` to close the response channel cleanly.

---

## [1.2.0]

### Added
- **Visit throttle (30s)** — refresh-bombs and rapid reloads no longer inflate counts.
- **Rolling visit log** — last 30 visits per item kept, enabling accurate "visits this month" stats.
- **Cost-per-visit** — paid items show `$X.XX/visit` based on real recent usage, or "unused this month" in red.
- **Last-launched memory** — site you most recently opened from the popup floats to the top with empty search.
- **Empty-state tour** — first-run shows a 3-step inline guide.

### Security
- **Page title capped** at 80 chars + visual hierarchy swapped (origin dominant, title subordinate). Prevents misleading titles from impersonating site identity.
- **Length caps** at every entry point: name ≤ 200, stack name ≤ 40, note ≤ 2000.
- **Storage quota errors** caught and surfaced with a clear message.

---

## [1.1.0]

### Added
- **Quick launcher** — auto-focused search, ↑↓ navigation, Enter to open, Esc to clear. Bound to `Ctrl+Shift+S` / `Cmd+Shift+S`.
- **Cancellation candidates tab** — appears automatically as `💸 Stale ($X)` when there are stale paid items, sorted by cost.
- **Visit counter** — increments on every completed page load.
- **Yearly cost projection** in the header.
- **Right-click context menu** "Add to StackSight" with current-stack pre-selection for already-tracked sites.

### Security
- `event.isTrusted` guards on prompt clicks — page JS can't programmatically click buttons.
- URL scheme allowlist — only `http(s)` URLs reach storage.

---

## [1.0.0]

Initial release.

- MV3 Chrome extension.
- First-visit prompt with stack picker.
- Background timestamp tracking.
- `chrome.storage.local`-only persistence.
- Search across all stacks.
- Stack tabs.
- Monthly cost total.
- 30-day stale flag.
- Add / edit / delete items.
- Create / rename / delete stacks.
- JSON export.
