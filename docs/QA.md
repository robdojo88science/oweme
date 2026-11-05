# Validation record

Checks use disposable test data and separate browser contexts. No borrower records from a personal browser are committed or uploaded.

On 2026-11-05, the production build passed the following local checks:

- ESLint and strict TypeScript.
- Vitest business logic, IndexedDB mutations, backups, search, media processing, and document generation.
- Seven Playwright workflows for loan creation, payments, PDFs, fuzzy search, history retention after deletion, advance recalculation/undo, responsive layout, backup/clear/restore safeguards, and a 5,000-borrower / 50,000-transaction notebook. The large-notebook test verifies exact identifiers, misspellings, manual notes, keyboard navigation, a maximum of 14 rendered list rows, and phone payment entry.
- Offline production reload, calculator navigation, persisted borrower records, an offline payment, and an offline PDF download with the embedded peso-capable font. Run `node scripts/offline-smoke.mjs` while the production preview serves port 4173.
- Signature photo compression to 1600 pixels, crop/rotation/perspective, transparent cleanup, draw/undo/save. Generated PDF pages were rendered and visually reviewed.
- Lighthouse 13.6.0 mobile accessibility: **100/100** on the local production Home screen. This is a measured screen-specific result, not a guarantee for every screen or physical device. Lighthouse [removed its former PWA scoring category in version 12](https://developers.google.com/speed/docs/insights/release_notes); install metadata, active service worker, precached assets, and offline behavior were checked directly.
- `npm audit --omit=dev`: **0 vulnerabilities**. The full audit retains four low-severity entries through a single Workbox build-tool dependency advisory, documented in the README.

The ignored `artifacts/` directory contains local Lighthouse JSON, browser screenshots, PDF render fixtures, and the offline smoke report. Re-run the checks to reproduce them; generated reports are not application data or shipped assets.

Real Google OAuth/Drive/Gmail verification requires the lender's configured Google client ID and consent. Physical iPhone/iPad/Android installation, camera permissions, haptics, printing, and system share-sheet behavior need a device check. Reliable closed-app background reminders or backups are not claimed.

GitHub Pages setup is blocked by the private repository's current GitHub plan (HTTP 422). Repository visibility has not been changed. The GitHub Actions workflow and static build are ready for Pages once repository eligibility is resolved.
