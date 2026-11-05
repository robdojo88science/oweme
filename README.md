# OweMe

A local-first lending notebook for one barangay lender. Borrowers never log in. Agreements, payment history, paper signatures, reminders, and backups live in the lender's browser.

**GitHub Pages target:** [robdojo88science.github.io/oweme](https://robdojo88science.github.io/oweme/). **Not yet live:** GitHub rejected Pages setup with HTTP 422 because this private repository is not eligible for Pages under the account's current plan. Use a plan that supports private-repository Pages, or explicitly choose to make the repository public, then enable the workflow below. Repository visibility has not been changed. The deployment workflow is included and deployment is not claimed as verified.

OweMe has no server database and requires no account, password, or PIN. Connecting Google is optional and only authorizes backup access. Browser storage is the primary dataset; make a backup before clearing site data, moving devices, or uninstalling a browser.

## Run locally

Use Node **22.12 or later in the 22.x line, 24.x, or 26+**. Node 24 is recommended. Install dependencies from the lockfile:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/oweme/`. On Windows PowerShell, use `npm.cmd` instead of `npm` if your execution policy blocks `npm.ps1`.

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run check` runs those four checks in order. `npm run preview` serves the production `dist/` folder. Vite and Vitest use their runner config loader because bundling config files can trigger restricted ancestor-directory reads on managed Windows machines.

For the browser smoke tests:

```sh
npx playwright install chromium
npm run test:e2e
```

The tests own port 5174 and use a separate Vite dependency cache from the interactive development server on port 5173. On Windows, local tests use installed Google Chrome; CI uses Playwright Chromium. To test the production PWA offline, start `npm run preview -- --port 4173` after building, then run `node scripts/offline-smoke.mjs` in another terminal.

Tests use isolated browser/database data. Unit tests use `fake-indexeddb`; they do not access your real browser's notebook. Generated QA files belong in the ignored `artifacts/` directory.

## Start your notebook

1. Open **Settings**. Set the business name, address, optional logo, default lender name, and receipt footer. A lender signature can be saved once and reused.
2. Choose the default interest rate, maximum term, and private mercy days. Defaults start at 10%, three months, and five days. Changes apply to new agreements; they do not rewrite existing loans.
3. Add a borrower with their name, address, and estimated monthly income (Sahod). Photo and contact information are optional. Sequential borrower IDs are assigned automatically.
4. Open the borrower account and choose **New loan**. Check the live face amount, interest, cash release, and official schedule. Capture signatures now or save without one and add it to the loan later.
5. Use **Receive payment** on the account or reminder row. The next installment is prefilled. Select the method, enter any reference/proof, and save. The resulting transaction number is also the receipt number.
6. Export a **Full backup** in Settings and keep the JSON file outside the browser. Check that you can find the downloaded file.

On desktop, `/` or `Ctrl/Cmd+K` focuses search. Search accepts `1`, `001`, `#001`, names, addresses, contact numbers, loan numbers, transaction numbers, and notes. Name search is accent-insensitive and tolerant of spelling errors. Filter and sort borrowers to find accounts needing attention.

### Loans and advances

Money is stored as whole centavos. A ₱1,000 monthly income over three months permits a ₱3,000 face amount. At 10% deducted upfront, ₱300 is interest and ₱2,700 is handed over. The installments are ₱1,000 each.

Interest is a single charge, rather than a monthly compounding charge. In **Added on top** mode the entered cash amount becomes the net release and interest is added to obtain the face amount. The final installment absorbs any centavo remainder. Every due date is computed from the original release day, independently, with month-end clamping.

An **Advance loan** starts from an active loan. Record today's payment first so the carried balance is current. Merge mode carries the old unpaid face balance into a new schedule and charges interest only on the advance. Separate mode leaves the original loan untouched and creates a linked loan. Both show the cap check, current exposure, and rating; a deliberate cap override creates an audit record.

Example: an old ₱3,000 loan has ₱2,000 remaining. A ₱1,000 face advance at 10% hands over ₱900 and creates a merged ₱3,000 loan over three months. Asking for ₱450 cash instead produces a ₱500 advance and a ₱2,500 merged face amount, with installments of ₱833.33, ₱833.33, and ₱833.34. Auto notes record the amounts, links, dates, and new terms in the loan, transaction, and borrower timeline.

Merged loans remain in history. Their paid installments remain intact; their unpaid installments become `rolled_over`. To undo an advance, void payments recorded on its new loan first, then void the advance with a reason. The old schedule is restored from its saved snapshot. Later advances in a chain must be undone first.

### Payments, receipts, and history

Payments fill the oldest unpaid installment, then continue into the next. Partial and early payments are supported. Excess above the entire face balance is retained as an explicitly labelled **unapplied credit** on the transaction and receipt. It is not silently discarded or automatically lent to another loan.

Payment amounts, references, allocations, and before/after balances are append-only. Correct a mistake by **voiding** the payment with a reason; the original transaction remains visible and a numbered reversal is added. Remaining valid payments are reapplied to reconstruct the correct schedule. A receipt's next due date is captured when its transaction is created, so later payments do not change that historical date.

Receive payments in date order. If an earlier payment needs to be entered, void any later payments first and re-enter them in order. A void cannot predate its original transaction. This protects the meaning of immutable receipt histories.

Receipts, loan agreements, statement PDFs, shared summaries, and calendar files use official due dates. They do not export the private mercy period, internal scoring fields, or internal grace dates. Statements offer date ranges and show the **current** outstanding balance separately from the selected period's cash activity.

### Signatures and documents

Print an A4, A5, or notebook-style agreement, have it signed on paper, and photograph or upload it. The capture tool supports drag cropping, rotation, and four-corner perspective correction. Adaptive cleanup removes the paper background and creates a dark transparent PNG. Both the compressed original evidence and processed signature are retained.

Drawing on screen supports pointer/pen input, undo, and clear. Skipping signatures is allowed. Frequently used issued/received-by names are saved as signer profiles, optionally with a reusable signature.

PDFs embed Noto Sans so the Philippine peso glyph and accented names render correctly. Font licensing is in `src/exports/fonts/OFL.txt`. Keep **Include signatures** enabled when documents should contain them. A document can be downloaded, printed, or shared through the system share sheet where supported. On browsers without file sharing, OweMe downloads the document and offers text/mail fallbacks. Attaching a file in Messenger or mail requires the system share sheet or a manual attachment; a website cannot silently attach a local file to those apps.

### Reminders and ratings

Reminders group official dues into due today, upcoming, private mercy, and overdue admin views. Call/text links use the device's installed apps; OweMe does not send SMS. Copy or share a polite reminder, or export an `.ics` file and import it into Calendar.

Reminder checks run when OweMe opens. Web browsers cannot reliably schedule future notifications while an app is closed on every platform. Calendar export is the reliable device-level fallback. App badge counts are used only where the browser supports them.

With the default scoring settings, a fully paid installment earns 100 by its due date, 85 within the private mercy period, or `max(10, 70 − 4 × days beyond mercy)` afterwards. An unpaid installment beyond mercy earns zero. Installments are ordered by official due date, newest first, with each earlier installment weighted by another factor of 0.9. Stars are the average divided by 20, rounded to the nearest half star, bounded to 0.5–5. Accounts with no scored installments show **New**. Scoring parameters can be changed in Settings.

## Back up and restore

### Local JSON

**Full backup** includes all app tables and embedded compressed images. **Lite** omits images. The format is a single JSON envelope with `app: "OweMe"`, `schemaVersion: 1`, an export timestamp, and the tables. Google access tokens are held in memory and are never included in backups.

Desktop Chrome/Edge can save through a chosen file handle and update it during that browser session. Other browsers download a file. Mobile browsers offer the system share sheet when supported, so the file can be saved to Files or Drive. Treat a download as complete only after confirming the file exists somewhere you can find again.

To restore:

1. Select a JSON file in **Settings → Backup & sync → Import a backup**.
2. Review record counts, date range, and numbered-record conflicts. Selecting the file alone does not change data.
3. Choose **Merge** to combine devices or **Replace** to use the incoming dataset.
4. Review the resulting summary and keep the original JSON file.

Validation rejects unsupported versions, malformed records, invalid money, missing loan references, and corrupt embedded images before a write. Imports are committed atomically. Before every import, restore, or clear, a full local snapshot is saved; the last five are retained in IndexedDB. Snapshot history itself is excluded from exported backups to prevent nested, expanding backup files. A snapshot inside the same browser is a recovery aid, not an independent backup.

Merge matches UUIDs and selects the newer `updatedAt` version. Deletion tombstones prevent older deleted borrower accounts from being restored by another device. Loans and transactions are retained as financial history. Distinct records that collide on borrower, loan, or transaction numbers are preserved and renumbered, with conflicts reported. Counters are reconstructed from history and retain their highest values. Avoid editing the same active loan offline on two devices at the same time: record-level last-write-wins is not a transaction-aware distributed ledger.

### Connect your own Google project

Cloud backup is optional. It needs a Google Cloud OAuth Web Client ID created by the lender; no shared project, paid service, client secret, or application backend is required.

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project named OweMe.
2. In **APIs & Services → Library**, enable **Google Drive API** and **Gmail API**. Gmail is needed only for email backups.
3. Open **Google Auth Platform** / **OAuth consent screen**. Set the application name, support email, and developer contact. Choose **External** for a personal Gmail account, keep it in **Testing** for personal use, and add the lender's Gmail account under **Audience → Test users**.
4. In **Data Access / Scopes**, declare `https://www.googleapis.com/auth/drive.file` and, if email backup is wanted, `https://www.googleapis.com/auth/gmail.send`. Only enable Gmail sending in OweMe when wanted. Google can require extra review for broader publication or sensitive scopes; personal testing and public app verification are different states. [Google consent-screen guidance](https://developers.google.com/workspace/guides/configure-oauth-consent).
5. Under **Clients / Credentials**, create an **OAuth client ID → Web application**. In **Authorized JavaScript origins**, add **`https://robdojo88science.github.io`**. An origin contains only scheme and hostname: do **not** append `/oweme/` or a hash route. For development, add `http://localhost`, `http://localhost:5173`, and the actual loopback origin used by your browser, such as `http://127.0.0.1:5173`. This implementation uses the popup token flow and does not require an app callback route. [Google web client setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).
6. Copy the public Client ID ending in `.apps.googleusercontent.com`. Paste it into **Settings → Google Web Client ID**, or set the build-time variable below. Never put a client secret in this app.
7. Set the backup email address if needed; check **Enable Gmail sending permission** before connecting when email backup is wanted. Tap **Connect Google**, sign in as the configured test user, and grant the requested access.
8. Tap **Back up / sync now**. Check that one `OweMe-backup.json` appears in Drive. For another device, use the same Google account and OAuth client, connect, and review the offered merge before recording new activity.

For a local build, an ignored `.env.local` may contain:

```dotenv
VITE_BASE_PATH=/oweme/
VITE_GOOGLE_CLIENT_ID=your-public-web-client-id.apps.googleusercontent.com
```

For GitHub Actions, create the repository **Actions variable** `VITE_GOOGLE_CLIENT_ID` under **Settings → Secrets and variables → Actions → Variables**. It is a public client identifier, not a secret token. Rebuild after changing build variables.

Drive uses the narrow `drive.file` scope to access files created/opened by this application. It remembers the file ID and updates the same file, checks for a newer remote version before uploading, and offers a merge for review. Large uploads use Drive's resumable upload endpoint. [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive upload methods](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

Email backup sends a MIME attachment from the connected user's own Gmail through `users.messages.send`. Above approximately 20 MB of JSON, it switches to Lite; an oversized Lite file requires local/Drive backup instead. The manual fallback downloads the file and opens a mail draft with instructions to attach it. [Gmail sending API](https://developers.google.com/workspace/gmail/api/guides/sending).

Automatic cloud backup is debounced after data changes and retried on open/focus or reconnection while the app is open. It is not an unattended background service. Access tokens are short-lived and kept in memory only; reconnect after expiry or a full reload when prompted. Silent, permanent access is not promised by this client-only token model. [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

### Delete and clear safely

**Archive** keeps an account visible under the Archived filter. To delete a borrower, type `Delete ` plus their exact stored full name, including case and spaces. Their account/photo and private notes are removed; loan and transaction snapshots remain in History as a deleted account. Their numeric ID is never reused.

**Clear all data** requires a full backup first, confirmation that you have retained a copy where needed, the exact text `DELETE ALL DATA`, and a three-second press-and-hold confirmation. It resets this browser's notebook. Exported files and the Google Drive copy are not automatically deleted. Import the retained backup to restore afterwards.

## Install on your device

First load OweMe online and allow its service worker to finish caching. Use the production site or `npm run build` followed by `npm run preview` when checking offline behavior; development mode is not an offline acceptance test.

- **iPhone/iPad:** Open in Safari, use **Share → Add to Home Screen**, and launch from the new icon. On iPad, the Share control may be in the toolbar/menu. Camera capture and document sharing require device permission.
- **Android:** Open in Chrome, choose **Install app** / **Add to Home screen** from the browser menu, then launch from the app icon.
- **Desktop:** Chrome/Edge offer an install control when the manifest/service worker requirements are met. The app also works in an ordinary browser tab.

Core records, cached app files, images, and the PDF font remain available offline after a successful initial cache. Google backup, Gmail, and external messaging apps require their own connectivity. OweMe requests persistent storage and displays a gentle backup reminder if it is denied. iOS and other browsers can still evict storage; private browsing may discard it at the end of a session. Keep an independent backup even when persistence is granted.

Updates show **New version available · Reload**. Finish and save an open form before reloading.

## GitHub Pages deployment

The static app uses `HashRouter`, so routes such as `/oweme/#/borrowers` work without an SPA fallback. The Vite base defaults to `/oweme/` and is configurable with `VITE_BASE_PATH`.

1. Push this repository to `https://github.com/robdojo88science/oweme` on branch `main`.
2. In **Repository Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. Ensure Actions is enabled for the repository.
3. Run or wait for **Validate and deploy OweMe**. Its build job installs the lockfile, lints, typechecks, runs unit and Chromium smoke tests, builds the PWA, and uploads `dist/`. A separate job deploys with Pages and OIDC permissions.
4. Check the run's deployment URL and open [https://robdojo88science.github.io/oweme/](https://robdojo88science.github.io/oweme/).
5. Add the deployed hostname as the OAuth authorized origin if Google backup is enabled.

For a fork, the URL pattern is `https://<username>.github.io/oweme/`; change the repository/base name and OAuth origin if hosting at a different path or domain. No secrets or borrower data should be committed. [GitHub's Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Architecture and assumptions

| Area      | Implementation                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| UI        | React, strict TypeScript, Vite, Tailwind and responsive app CSS; Zustand UI state                                             |
| Data      | Dexie/IndexedDB, versioned schema, UUIDs, atomic mutations, tombstones, persistent numbering                                  |
| Money     | Whole centavos, integer BigInt multiplication/division with half-up rounding; decimal rates converted to integer basis points |
| Calendar  | `YYYY-MM-DD` values; original-date month clamping and explicit Asia/Manila “today”                                            |
| Search    | In-memory MiniSearch, normalized names/IDs/linked record text, bounded list rendering                                         |
| Documents | jsPDF/autotable, bundled Noto Sans Unicode font, public-field exports, ICS                                                    |
| Offline   | `vite-plugin-pwa`/Workbox, install manifest, local icons and fonts, update prompt                                             |
| Tests     | Vitest, fake-indexeddb, pure calculation/media/export tests and Playwright smoke tests                                        |

The suggested stack is retained. Date-only arithmetic is implemented as small UTC calendar helpers, rather than converting business dates into local timestamps. This avoids device-timezone drift; the date-fns dependency is available for expansion. Styling combines Tailwind integration with a dedicated CSS design system to keep the desktop/tablet layout fluid.

Assumptions made where the prompt left behavior open:

- `Delete + full name` means `Delete ` followed by the exact stored name, case-sensitive. No trimming is applied to the confirmation.
- Rates use basis points (two decimal places in percent). Centavos are rounded half-up at interest/reverse calculations; the final installment absorbs the schedule remainder. Upfront interest must stay below 100%.
- Default maximum term is three months. An implementation safety ceiling of 120 months and 365 mercy days prevents accidental enormous schedules; these do not alter the default business rules.
- Merge cap is selected-loan balance plus new advance, as specified in section 5.7. A separate advance checks all active outstanding exposure plus its new face amount.
- The merge-scoring wording is resolved using section 5.5 as the score source: an **unpaid** installment already past mercy scores **zero**, frozen on the advance date. It does not receive a paid-late score merely because its balance was rolled over. Future rolled installments are unscored. Previously paid installments retain their payment history.
- Recency is based on official installment due-date order, not the date on which someone happened to pay.
- Amount above the whole loan balance is retained as unapplied credit. It does not automatically reduce a different loan. Check the receipt before deciding how to return or apply that credit operationally.
- Payment entry is chronological. Voids rebuild current allocation from valid historical payments while leaving original receipts/transactions unchanged.
- JSON snapshots remain local and only the latest five are kept. Replacing a notebook retains historic counter maxima so IDs are not reused accidentally.
- Cloud merge is record-level last-write-wins, with tombstones and duplicate-number repair. Simultaneous offline edits to one loan require care and are not conflict-free multi-user accounting.
- Haptics are optional, silent, and best-effort. iOS switch-style feedback is browser-dependent; physical feedback cannot be verified by desktop tests.
- There is no optional app-lock feature in this build. The app opens without authentication as required; device security is the available lock.

Source is organized under `src/core`, `src/data`, `src/ui`, `src/components`, `src/media`, `src/exports`, and `src/backup`. Non-obvious UI explanations are centralized in `src/ui/info.ts`. The scaffold and tested financial/data foundation were committed as separate phases before the feature UI. Independent feature modules were then developed in parallel; integration checks and later commits validate their combined state instead of claiming a live deployment for every intermediate empty screen.

### Dependency audit

The initial audit identified 17 affected packages. jsPDF, Vitest, and sharp were upgraded to patched versions; scoped overrides update Workbox's glob and TypeScript ESLint's minimatch without replacing unrelated ESLint glob APIs. As checked on **2026-11-05**, the report contains **four low-severity entries**, all inherited from the same `deepmerge` advisory in the Workbox build dependency chain. No moderate, high, or critical entries remain. The current published deepmerge release is affected; npm's remaining force recommendation downgrades the PWA plugin to an obsolete major version and was not applied. Re-run `npm audit` when updating dependencies; do not blindly use `--force`. [deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).

### Acceptance and verification

Automated unit/data tests cover the required loan and advance examples, centavo remainders, both interest modes, Jan/Nov month-end cases, partial/exact/early/excess payments, current balance rebuilds, advance undo guards, rating/status transitions, frozen rollover scoring, growing IDs, immutable receipt snapshots, JSON/image round-trips, corrupt-import rejection, conflict renumbering, tombstones, and exact deletion matching. Public-export tests check that private policies do not enter borrower documents; PDF tests verify embedded Unicode fonts and long-statement pagination. Media tests exercise threshold cleanup and perspective geometry.

The checklist below distinguishes implementation and tested business rules from real-device/integration checks that need an actual browser/account:

- [x] Required pure loan/payment/advance examples are implemented and unit-tested.
- [x] Atomic borrower/loan/payment/advance/void flows and permanent-history deletion have database tests.
- [x] Full JSON round-trip with embedded images, merge conflicts, snapshots, and invalid import protection have tests.
- [x] Borrower-facing PDF/ICS/summary builders exclude internal mercy/grace fields and embed a peso-capable PDF font.
- [x] Seven Chromium/Chrome UI smoke tests pass: borrower → loan → payment → downloaded PDF; ID/name/address/transaction search; exact account deletion preserving history; merge advance with notes/cap recalculation/undo; a 390px phone layout; backup/exact-phrase/continuous-hold clear and restore; and a large-notebook search test. Browser page-error checks pass.
- [x] Production service worker activates and controls the app. Offline reload, calculator, borrower search, payment, and embedded-font PDF download pass. An offline payment survives another reload.
- [x] Search and responsive UI verified with 5,000 borrowers, 50,000 transactions, 500 active loans, and manual notes. The borrower list renders at most 14 rows; exact identifiers, typo search, keyboard navigation, and phone payment entry pass.
- [x] Signature capture tested in Chrome with a paper-photo fixture, compressed evidence, perspective/crop/rotation, transparent cleanup, draw/undo/save. PDF pages were rendered and visually reviewed.
- [ ] Verify camera crop, paper signature capture, physical haptics, install, print, and share on a real iPhone/iPad and Android device.
- [x] Lighthouse 13.6.0 mobile accessibility measured **100/100** on the local production Home screen. The PWA category was [removed from Lighthouse 12](https://developers.google.com/speed/docs/insights/release_notes); manifest, icons, active service worker, cached font, and offline workflows were checked directly. See [the validation record](docs/QA.md).
- [ ] Verify service-worker update/reload behavior across two deployed versions and run the production checks on the live Pages URL.
- [ ] Connect the lender's real Google project and confirm Drive update/restore and Gmail delivery. API behavior is unit-tested with mocks; no real account credentials were supplied for live validation.
- [ ] Record a successful GitHub Pages deployment and confirm the live URL above.

These remaining verification items are not presented as completed checks. Cloud setup and device permissions are external to the repository. A public hosted application does not publish IndexedDB borrower data: each browser has its own private local store, while deliberately exported backup files contain personal information and should be protected.
