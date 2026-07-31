## Goal

Replace `src/i18n/locales/en.json` and `src/i18n/locales/es.json` with the two attached files, byte-for-byte, no merging or edits.

## Steps

1. Copy `user-uploads://en.json` over `src/i18n/locales/en.json`.
2. Copy `user-uploads://es.json` over `src/i18n/locales/es.json`.
3. Verify both parse as valid JSON and that the app still builds/renders.

## One thing to flag first

Both uploaded files contain **1753 keys**; the current files contain **1786 keys** each. So a full replacement drops 33 keys that exist today. Any component still calling those keys will render the raw key string (the i18n fallback chain can't help — they're missing from both locales).

I'll do the exact replacement as asked. After the swap I'll list which 33 keys disappeared so you can decide whether they were intentionally retired or need re-adding — I won't add anything back without your say-so.

## Technical notes

- Both uploads are valid JSON and key-count-identical across locales, so es/en parity holds.
- No code changes: `src/i18n/index.tsx` imports these JSON files directly, so the swap takes effect on reload.
