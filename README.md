# OweMe

A private, offline-first lending notebook for one owner. Borrowers do not register, log in, install an app, or provide an identity document. The notebook opens without a password/PIN. Each browser has its own IndexedDB data; GitHub Pages serves public application code, not borrower records.

## Run and check

Use Node 22.12+ or Node 24. Direct dependency versions are pinned and the lockfile is committed.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/oweme/`. In Windows PowerShell use `npm.cmd` if the execution policy blocks `npm.ps1`.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Browser tests use installed Chrome on Windows and Playwright Chromium in CI. Install the CI browser with `npx playwright install --with-deps chromium`. For production offline verification, build, start `npm run preview -- --port 4173`, then run `node scripts/offline-smoke.mjs`. Tests use isolated records; the app inserts no demo borrowers. Previous production checks do not certify unpushed changes or physical-device behavior.

## Start your notebook

1. Set business details and the default operator in **More → Settings**. Defaults are one 10% face deduction, three months, five internal courtesy days, and a conservative 30% affordability guideline.
2. Add a borrower. Only the full name is required; address, contact, income, photo, alias, barangay and remarks are optional.
3. Use **Calculator** without saving, or open **New loan**. Review actual cash, charge, total repayable, every due date and warnings. Above-guideline amounts require an override reason.
4. Preview/print the agreement before releasing money. Save a draft if needed. Confirm the actual funds release when issuing the loan.
5. Print for a real paper signature; photograph/upload the complete signed paper or PDF under the exact loan’s **Documents**. On-screen signatures are optional; earlier captures remain in revision history.
6. Record payments with date, method, reference, typed operator and optional proof. Download the numbered receipt or review the privacy preview before sharing.
7. Keep a full backup outside the browser. Find the saved file before relying on it.

Desktop search opens with `/` or `Ctrl/Cmd+K` and remains local. Main destinations are Home, Borrowers, Calculator, Transactions and More. More includes reports, documents, activity, reminders, backups and settings.

## Loan definitions

At 100% affordability, ₱1,000 estimated monthly income × three months suggests ₱3,000 **face value**, with a warning that committing all income may be unaffordable. This is an editable guideline, not mandatory approval. The default 30% factor suggests ₱900. Global/per-loan settings can use another percentage.

| For a ₱3,000 face loan     |      Amount |
| -------------------------- | ----------: |
| Total repayable            |      ₱3,000 |
| One-time 10% deduction     |        ₱300 |
| Actual cash released       |      ₱2,700 |
| Three monthly installments | ₱1,000 each |

The deduction is not a monthly rate or a 10% APR. Disclosures show cost relative to cash received and an estimated effective annual cash-flow yield when calculable. It uses actual calendar days/365 and is not a statutory APR or legal-compliance assertion. Zero charge uses 0%; add-on mode clearly adds a one-time charge to requested cash.

Release on November 5, 2026 creates dues on December 5, January 5 and February 5. Dates remain anchored: January 31 clamps to February 28/29, then March 31 and April 30. Courtesy days are internal servicing reminders; they do not shift contractual dates or turn late payments into on-time payments. Late fees are zero.

Money is integer centavos. Partial payments fill oldest dues. Excess above the entire balance requires acknowledgment and remains explicit unapplied credit. Corrections create numbered reversals with reasons; original receipts remain unchanged. Atomic database transactions and submission guards prevent double-tap payments and inconsistent balances.

Issued loans retain agreement text, borrower details, business identity and pricing snapshots. Settings apply to new agreements. Multiple independent loans and audited linked advances are supported. Merge advances carry remaining obligations into a new schedule while preserving source history. Reverse later dependent advances/payments before undoing an advance.

## Reliability and reports

An account is **Not rated** until an installment is due. An installment is on time only when fully covered by its contractual due date. Two partial payments qualify only if both settle it by that date. A due-today installment still has today to be paid; unpaid dues count after their due day. Default thresholds are 95/85/70/50% on-time for 5/4/3/2 stars, otherwise 1. Thresholds are configurable. Profiles show due/on-time/late counts and average days late. Courtesy labels and owner remarks remain separate; stars do not guarantee future repayment.

Home/Reports distinguish outstanding repayment obligations, face value, actual released cash, collections, expected collections and finance charges. Reports include ranges, payment channels, contractual overdue aging, reversals, PDF and CSV. Archived accounts remain in history.

Charges are recognized proportionally to applied repayments, with cumulative centavo rounding. Merged advances carry the previous loan’s unrecognized charge into the new recognition basis, without charging it again. Unapplied credit is excluded. Collections and net cash flow are not profit: expenses/tax are not tracked. Reversed originals are excluded from restated cash totals even if reversed after the range; reversal totals separately show corrections dated in range. Current balances/aging use today; cash activity uses the selected range.

## Documents and privacy

PDF receipts, agreements and all-history/date-range statements embed bundled Noto Sans, including ₱, and paginate. They work offline after assets are cached. A4/compact formats are available. Whole signed agreements support image/PDF evidence, timestamps, previews and download. Signature capture supports crop, rotate, perspective correction and compression. Sharing requires review/permission for the intended recipient. System sharing is used where supported; fallbacks download for manual attachment. A website cannot silently attach files to Messenger or mailto.

An empty layout sample is at `output/pdf/oweme-report-layout.pdf`, containing no borrower records. Test PDF/PNG previews are in ignored `artifacts/pdf/`.

**Archive** hides the borrower from the active directory while retaining loans, receipts and audit history. It requires exact case-sensitive `Delete Full Name` using the stored name, plus second confirmation. Restore from the Archived filter. Historic IDs are never reused.

**Privacy anonymization** is separate, for appropriate erasure requests after retention/legal review. Identifying profile/attachment data is removed and retained financial snapshots are anonymized. Do not assume indefinite personal retention is always allowed.

**Clear all app data** requires a new retained full backup, affected counts, exact `CLEAR ALL OWEME DATA`, and second confirmation. Backup failure prevents clear. Only this browser is cleared; cloud copies/downloads remain unless separately deleted. Wiped records are not automatically restored.

## Backup and recovery

Full JSON includes schema version, creation time, table counts, base64 attachments and CRC32 integrity checksum. CRC32 detects accidental changes; it is not encryption/authentication. Legacy version-1 files without checksums remain accepted and identified as legacy. Lite export omits binary evidence. No OAuth tokens/secrets are exported.

Import validates files and replays the ledger before writes. Review preview counts, conflicts and before/after accounting totals before **Merge** or **Replace**. Writes are atomic; pre-import recovery snapshots retain the newest five locally. Those snapshots are not independent backups and are excluded from exports to avoid recursive growth. Merge preserves UUIDs, checks immutable financial terms, repairs display-number collisions and retains counter maxima. Divergent payment branches on the same loan are blocked rather than silently combined; retain both backups and review the authoritative history before replacing. Incomplete settings/counters or inconsistent balances are rejected without modifying the notebook. New IDs include `OWM-DIS-2026-000001`/`OWM-PAY-2026-000001`; legacy numbers remain valid. This is not conflict-free two-way sync.

Desktop File System Access can update a user-selected file during that session. Other browsers share/download. Download initiation is an export request, not a verified saved file. Check the file exists.

### Optional Google Drive and email

See [Google setup/recovery](docs/GOOGLE-SETUP.md) for detailed OAuth instructions and official references. The owner supplies a public OAuth **Web Client ID**. No client secret, service-account key, backend or paid core service is needed.

1. Create a Google Cloud project; enable Drive API and optionally Gmail API.
2. Configure consent/audience; in Testing, add your Google account as a test user.
3. Create a **Web application** OAuth client. Origins contain scheme/host/port only, such as `https://USERNAME.github.io` or `http://127.0.0.1:5173`. Do not append `/oweme/`.
4. Save the public `.apps.googleusercontent.com` ID in Settings, or set build variable `VITE_GOOGLE_CLIENT_ID`.
5. Connect with `https://www.googleapis.com/auth/drive.file`. Optional Gmail requires separate `https://www.googleapis.com/auth/gmail.send`; email is off by default.
6. Use **Back up / sync now** and verify API-confirmed status and `OweMe-backup.json`. A newer remote file first produces a restore/merge preview.

The first upload creates one file; later uploads PATCH its remembered ID. Modification checks/ETag preconditions detect conflicts. Authorization failures do not produce success. Queued changes stay local offline. Tokens remain in memory and expire; reconnect when prompted. New-device recovery searches accessible OweMe backups before creating another file.

Automatic uploads run after changes/open/focus/reconnection **while running and authorized**. iOS/Safari does not guarantee closed-app sync/reminders. Gmail sends an actual JSON attachment only with authorization. Oversized email exports switch to Lite and disclose the limit. Otherwise use **Download backup + Open email** and manually attach it; mailto does not attach files. Public distribution may require Google OAuth verification. Real-account Drive/Gmail is unverified until configured by the owner.

## Install and deploy

Load production online once and allow caching before offline use. IndexedDB is the sole local record store; loans are not in localStorage.

- iPhone/iPad: Safari → Share → Add to Home Screen.
- Android: Chrome → Install app / Add to Home screen.
- Desktop: Chrome/Edge install control or an ordinary tab.

Storage may be evicted, especially in private browsing; persistent-storage permission is not a backup. Core entry/calculations/records/cached PDFs work offline. Cloud/messaging need connectivity. Haptics/notifications are optional and capability-detected; iPhones do not all support vibration. Reminder lists work whenever opened; closed-app delivery is not guaranteed. Save open work before applying an update.

`.github/workflows/deploy.yml` installs the lockfile, lints, typechecks, tests unit/browser flows, builds, verifies production offline workflows, then deploys `dist/` with GitHub Pages/OIDC. Set repository Settings → Pages → **GitHub Actions**, then push `main` or run the workflow.

Hash routing supports `https://USERNAME.github.io/oweme/#/borrowers`. `VITE_BASE_PATH` defaults to `/oweme/`; change for other repository names. PWA scope/start_url follow that base. Optional `VITE_GOOGLE_CLIENT_ID` is an Actions variable/public identifier. Never commit borrower data, tokens or backups. The existing hosting address is `https://robdojo88science.github.io/oweme/`; local revisions are not published until pushed and deployed. Pages provides no secret server/database.

## Scope and verification limits

Implemented: responsive light UI, borrower profiles, calculator/origination/drafts, payment/reversal ledger, receipt/agreement/statement PDFs, paper attachments, contractual-date reliability, reminders/search, reports/activity, archive/anonymization, checked backup/restore and configurable Google integration.

Optional extensions not included: app privacy lock, encrypted/ZIP exports, custom installment frequencies/schedules, guaranteed closed-app notifications, automatic two-way sync and arbitrary manual allocation. Reverse/re-enter corrections use audited oldest-due allocation. JSON with attachments is the portable format.

Real-device installation/camera/share/haptics, live Google account delivery and service-worker updates across deployed versions need separate validation. The app promises no legal enforceability or lawful default rate. Philippine lending/privacy/disclosure/licensing/fee obligations need appropriate local review. Absence of an ID requirement here does not imply an exemption.
