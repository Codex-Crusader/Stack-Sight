# StackSight tests

A standalone logic + security test suite. Mirrors the pure logic from `background.js` and `popup.js` and runs without Chrome.

## Run

```bash
node tests/test-logic.js
```

Exits with code `0` if all tests pass, `1` if any fail.

## What's covered

- URL scheme rejection (security)
- Length caps at every entry point
- Storage quota error handling
- Visit throttle behaviour
- Rolling visit log management
- Lazy migration for legacy items
- `isStale` accuracy
- Cost-per-visit math
- Renewal date auto-roll (monthly + yearly)
- Renewal urgency detection
- Import shape validation
- Import URL filtering
- Import length cap enforcement
- Import garbage handling
- Currency formatting (multi-currency)
- Bulk move + delete logic
- Onboarding flag persistence
- `event.isTrusted` gating
- Title display cap
- Active-tab self-correction
- Last-launched ordering

## Notes

Tests use a hand-rolled mock of `chrome.storage.local` and run in plain Node with no dependencies. No `npm install` required.
