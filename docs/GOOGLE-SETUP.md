# Google Drive and Gmail backup

OweMe works without Google. Local JSON export/import needs no account or network. Google backup is optional and runs directly in your browser using your own Google account. There is no OweMe server, client secret, or stored refresh token.

## Configure your Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project such as `OweMe Personal Backup`.
2. Under **APIs & Services → Library**, enable **Google Drive API** and **Gmail API**. Gmail is needed only if you turn on email backup.
3. Open **Google Auth Platform**. Configure **Branding** with the app name, a support email, and your developer contact. Under **Audience**, select **External** if you use a personal Gmail account. Keep the application in **Testing** and add the lender's Google account under **Test users**. A Workspace organization can instead use **Internal**, if its policies permit.
4. Under **Data Access**, add `https://www.googleapis.com/auth/drive.file`. For email backup, also add `https://www.googleapis.com/auth/gmail.send`. OweMe requests Gmail access only when you connect with **Enable Gmail sending permission** selected. These permissions let the app manage files it created or that you explicitly grant to it, and send backup mail as your account. They do not give OweMe general access to read your inbox.
5. Under **Clients**, create an OAuth client with application type **Web application**. Add these **Authorized JavaScript origins** as applicable:
   - `https://YOUR-USERNAME.github.io` for the public Pages site.
   - `http://localhost:5173` and/or `http://127.0.0.1:5173` for local development.
   - Your custom HTTPS domain if you use one.
6. Enter only the origin: scheme, host, and optional port. Do **not** add `/oweme/`, `/#/`, or another path. For example, the app URL `https://ana.github.io/oweme/` uses the authorized origin `https://ana.github.io`. This client uses the GIS popup token flow and does not need a server redirect endpoint.
7. Copy the Web **Client ID**, ending in `.apps.googleusercontent.com`. In OweMe, open **Settings → Backup & Sync**, paste it in **Google Web Client ID**, choose **Save settings**, then tap **Connect Google**. No client secret belongs in this static app or in its repository.
8. Choose your Google account and allow Drive backup. Select **Enable Gmail sending permission** and connect again if you also want Gmail authorization. Enter the **Backup email address**, then test **Back up / sync now** and **Send backup email**.

Google may display an unverified-app notice during personal testing. Only continue if this is the Cloud project and client ID you configured. Publishing to other users can require Google's OAuth verification; follow the console's current requirements for the scopes you select. A personal testing project may require consent again as testing sessions and access tokens expire. Workspace administrators can also restrict consent.

## How backups and multi-device sync behave

- The first successful backup creates `OweMe-backup.json`. OweMe remembers its file ID and updates that same file using `PATCH`. A fresh device searches accessible Drive files for this name before creating anything. If the linked file is missing, inaccessible, or in Trash, OweMe reports the problem instead of creating a replacement silently.
- On another device, configure the same client ID and Google account, then connect. A newer Drive file produces an import preview. Review the counts and conflicts and choose **Merge backup**. Same record IDs use the newest `updatedAt`. Deletion markers prevent deleted borrower accounts from returning. Different borrowers that collide on numeric ID are kept and renumbered; duplicate transaction numbers get a `-B` suffix.
- Automatic means **while the app is open**, on changes, on focus, or when the connection returns. It cannot guarantee jobs while a phone browser or installed web app is closed. Access tokens stay in memory and expire; tap **Connect Google** again when asked. The browser may block or suspend background activity.
- Email is sent **from the Google account you authorize**, using Gmail's API. The backup is a JSON attachment. Files above 20 MB switch to Lite backups without images; keep full images in your local or Drive backup. If even Lite exceeds 20 MB, use local export or Drive instead.
- Daily email scheduling uses the date in **Asia/Manila** and is checked when the app is open. A failed backup leaves the local dataset intact and records an error in Settings.
- The most recent five automatic pre-import/pre-restore/pre-clear snapshots remain in IndexedDB. They are intentionally excluded from exported backups so backup files cannot recursively grow. Download your own independent backup regularly; local snapshots can be evicted with browser data.
- Use one device at a time for lending activity when practical. Last-write-wins merges preserve records but cannot resolve two devices independently changing the same loan's embedded installment state into a transactional ledger automatically. Review conflicts and balances after multi-device work.

## Local backup and restore

Choose **Full backup** for a complete JSON, or **Lite** for text without photos and signatures. Supported desktop browsers can save repeatedly to a selected file; phones use the system share sheet where available, with download as the fallback. Keep the file private: it includes borrower contact information and financial records.

To restore, use **Import a backup** to select the JSON file, inspect the preview, then choose **Merge backup** or **Replace**. Validation runs before writing. Lite Merge retains existing local photos and signature images when the record and signature capture match; it never attaches an old signature to a new signer or capture. Replace restores the incoming dataset, so Lite Replace removes local images. Numeric counters retain the highest already-used values to avoid ID reuse. A local recovery snapshot is saved before either import mode. Intentionally clearing all data also erases those local snapshots, so the separately saved JSON file is the recovery copy after a clear.

## Official references

- [Google Identity Services authorization overview](https://developers.google.com/identity/oauth2/web/guides/overview)
- [GIS browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Client-side OAuth origins and validation rules](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [Drive uploads and updates](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Drive files.update API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
- [Gmail messages and attachments](https://developers.google.com/workspace/gmail/api/guides/sending)
