import { liveQuery } from "dexie";
import { db } from "../data/db";
import { today } from "../core/logic";
import {
  exportBackup,
  importBackup,
  previewImport,
  updateBackupStatus,
} from "./index";
import { bytesToBase64 } from "./format";
import type { ImportPreview, ImportSummary } from "./format";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const FILE_NAME = "OweMe-backup.json";
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        callback(response: TokenResponse): void;
        error_callback(error: { type: string }): void;
      }): { requestAccessToken(options: { prompt: string }): void };
      revoke(token: string, callback: () => void): void;
    };
  };
}
type GoogleWindow = Window & { google?: GoogleIdentity };
let accessToken: string | undefined;
let tokenExpiresAt = 0;
let scopes = new Set<string>();
let libraryPromise: Promise<void> | undefined;

function loadIdentity(): Promise<void> {
  if ((window as GoogleWindow).google?.accounts.oauth2)
    return Promise.resolve();
  libraryPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-oweme-google]",
    );
    const script = existing ?? document.createElement("script");
    const timer = setTimeout(() => {
      libraryPromise = undefined;
      reject(
        new Error(
          "Google sign-in could not load. Check your connection and try again.",
        ),
      );
    }, 20_000);
    script.addEventListener(
      "load",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        libraryPromise = undefined;
        script.remove();
        reject(new Error("Google sign-in could not load."));
      },
      { once: true },
    );
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.dataset.owemeGoogle = "true";
      document.head.append(script);
    }
  });
  return libraryPromise;
}

/** Call from a deliberate button press. Google tokens live in memory only. */
export async function connectGoogle(
  clientId: string,
  includeEmail = false,
): Promise<void> {
  if (!clientId.trim().endsWith(".apps.googleusercontent.com"))
    throw new Error(
      "Enter a Google Web Client ID first. See the Google setup guide.",
    );
  await loadIdentity();
  const identity = (window as GoogleWindow).google;
  if (!identity)
    throw new Error("Google sign-in is unavailable in this browser.");
  await new Promise<void>((resolve, reject) => {
    const client = identity.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: [DRIVE_SCOPE, ...(includeEmail ? [GMAIL_SCOPE] : [])].join(" "),
      callback(response) {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                "Google did not grant access.",
            ),
          );
          return;
        }
        accessToken = response.access_token;
        tokenExpiresAt =
          Date.now() +
          Math.max(0, Number(response.expires_in || 3600) - 30) * 1000;
        scopes = new Set((response.scope || "").split(" "));
        if (!scopes.has(DRIVE_SCOPE)) {
          reject(
            new Error(
              "Drive file access was not granted. Reconnect and allow Drive backup.",
            ),
          );
          return;
        }
        resolve();
      },
      error_callback(error) {
        reject(
          new Error(
            error.type === "popup_closed"
              ? "Google connection was cancelled."
              : "Allow the Google sign-in popup, then try again.",
          ),
        );
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
  await updateBackupStatus({ lastError: undefined });
}

export function isGoogleConnected(): boolean {
  return Boolean(
    accessToken && Date.now() < tokenExpiresAt && scopes.has(DRIVE_SCOPE),
  );
}
export function disconnectGoogle(): void {
  if (accessToken)
    (window as GoogleWindow).google?.accounts.oauth2.revoke(
      accessToken,
      () => undefined,
    );
  accessToken = undefined;
  tokenExpiresAt = 0;
  scopes = new Set();
}

async function googleFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!isGoogleConnected())
    throw new Error(
      "Reconnect Google to renew backup access. Your local data is safe.",
    );
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    accessToken = undefined;
    throw new Error(
      "Google access expired. Tap Connect Google to continue backups.",
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message || "";
    } catch {
      /* Google can return an empty error response. */
    }
    if (response.status === 412)
      throw new Error(
        "The Drive backup changed on another device. Check Drive again before backing up.",
      );
    throw new Error(
      `Google backup failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  return response;
}

interface DriveMetadata {
  id: string;
  modifiedTime: string;
  etag?: string;
}
async function findDriveFile(): Promise<DriveMetadata | undefined> {
  const settings = await db.settings.get("settings");
  const id = settings?.backup.driveFileId;
  if (id) {
    const response = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,modifiedTime,trashed`,
    );
    const metadata = (await response.json()) as DriveMetadata & {
      trashed?: boolean;
    };
    if (metadata.trashed)
      throw new Error(
        "The linked Drive backup is in Trash. Restore it in Drive before syncing.",
      );
    return { ...metadata, etag: response.headers.get("ETag") || undefined };
  }
  const query = new URLSearchParams({
    q: `name = '${FILE_NAME}' and trashed = false`,
    fields: "files(id,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "100",
  });
  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?${query}`,
  );
  const { files } = (await response.json()) as { files: DriveMetadata[] };
  const found = files[0];
  if (found) {
    await updateBackupStatus({ driveFileId: found.id });
    return found;
  }
  return undefined;
}

async function uploadDrive(
  json: string,
  existing?: DriveMetadata,
): Promise<DriveMetadata> {
  const blob = new Blob([json], { type: "application/json" });
  const suffix = existing ? `/${encodeURIComponent(existing.id)}` : "";
  const headers = new Headers();
  if (existing?.etag) headers.set("If-Match", existing.etag);
  if (blob.size > 5 * 1024 * 1024) {
    headers.set("Content-Type", "application/json");
    headers.set("X-Upload-Content-Type", "application/json");
    headers.set("X-Upload-Content-Length", String(blob.size));
    const initial = await googleFetch(
      `https://www.googleapis.com/upload/drive/v3/files${suffix}?uploadType=resumable&fields=id,modifiedTime`,
      {
        method: existing ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(
          existing ? {} : { name: FILE_NAME, mimeType: "application/json" },
        ),
      },
    );
    const location = initial.headers.get("Location");
    if (!location || !location.startsWith("https://www.googleapis.com/"))
      throw new Error("Google did not return a valid backup upload address.");
    const uploaded = await googleFetch(location, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: blob,
    });
    return uploaded.json() as Promise<DriveMetadata>;
  }
  if (existing) {
    headers.set("Content-Type", "application/json");
    const response = await googleFetch(
      `https://www.googleapis.com/upload/drive/v3/files${suffix}?uploadType=media&fields=id,modifiedTime`,
      { method: "PATCH", headers, body: blob },
    );
    return response.json() as Promise<DriveMetadata>;
  }
  const boundary = `oweme_${crypto.randomUUID().replaceAll("-", "")}`;
  headers.set("Content-Type", `multipart/related; boundary=${boundary}`);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE_NAME, mimeType: "application/json" })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const response = await googleFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime",
    { method: "POST", headers, body },
  );
  return response.json() as Promise<DriveMetadata>;
}

export type DriveSyncResult =
  | { kind: "backed-up"; modifiedTime: string }
  | { kind: "remote-newer"; modifiedTime: string; preview: ImportPreview };
let pendingSync: Promise<DriveSyncResult> | undefined;

export function syncDrive(): Promise<DriveSyncResult> {
  pendingSync ??= (async () => {
    try {
      const existing = await findDriveFile();
      const settings = await db.settings.get("settings");
      if (
        existing &&
        (!settings?.backup.lastSync ||
          Date.parse(existing.modifiedTime) >
            Date.parse(settings.backup.lastSync))
      ) {
        const response = await googleFetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existing.id)}?alt=media`,
        );
        return {
          kind: "remote-newer" as const,
          modifiedTime: existing.modifiedTime,
          preview: await previewImport(await response.text()),
        };
      }
      const metadata = await uploadDrive(await exportBackup(), existing);
      await updateBackupStatus({
        driveFileId: metadata.id,
        lastSync: metadata.modifiedTime,
        lastSuccess: new Date().toISOString(),
        lastError: undefined,
      });
      return {
        kind: "backed-up" as const,
        modifiedTime: metadata.modifiedTime,
      };
    } catch (error) {
      await updateBackupStatus({
        lastError:
          error instanceof Error ? error.message : "Drive backup failed",
      });
      throw error;
    }
  })().finally(() => {
    pendingSync = undefined;
  });
  return pendingSync;
}

export async function restoreDrive(): Promise<ImportPreview> {
  const file = await findDriveFile();
  if (!file)
    throw new Error("No OweMe backup was found in the connected Drive.");
  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
  );
  return previewImport(await response.text());
}

/** Call after the admin reviews a remote-newer preview. This cannot silently replace data. */
export async function mergeDriveBackup(
  result: Extract<DriveSyncResult, { kind: "remote-newer" }>,
): Promise<ImportSummary> {
  const summary = await importBackup(result.preview.backup, "merge");
  await updateBackupStatus({ lastSync: result.modifiedTime });
  return summary;
}

export async function sendEmailBackup(): Promise<void> {
  try {
    if (!scopes.has(GMAIL_SCOPE))
      throw new Error(
        "Connect Google with Email backup enabled to allow sending from your Gmail.",
      );
    const settings = await db.settings.get("settings");
    const email = settings?.backup.email || settings?.adminEmail;
    if (!email || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email))
      throw new Error("Enter a valid backup email address.");
    let json = await exportBackup();
    let lite = false;
    if (new Blob([json]).size > 20 * 1024 * 1024) {
      json = await exportBackup(true);
      lite = true;
    }
    if (new Blob([json]).size > 20 * 1024 * 1024)
      throw new Error(
        "Even the Lite backup exceeds 20 MB. Use a local file or Google Drive.",
      );
    const boundary = `oweme_${crypto.randomUUID().replaceAll("-", "")}`;
    const encodedFile =
      bytesToBase64(new TextEncoder().encode(json))
        .match(/.{1,76}/g)
        ?.join("\r\n") || "";
    const message = [
      `To: ${email}`,
      `Subject: OweMe ${lite ? "Lite " : ""}backup ${today()}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      lite
        ? "Your OweMe Lite backup is attached. Images are excluded; keep a full local or Drive backup too."
        : "Your OweMe backup is attached. Store this file privately; it contains borrower personal data.",
      `--${boundary}`,
      'Content-Type: application/json; name="OweMe-backup.json"',
      'Content-Disposition: attachment; filename="OweMe-backup.json"',
      "Content-Transfer-Encoding: base64",
      "",
      encodedFile,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const raw = bytesToBase64(new TextEncoder().encode(message))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    await googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      },
    );
    await updateBackupStatus({
      lastEmailSuccess: new Date().toISOString(),
      lastSuccess: new Date().toISOString(),
      lastError: undefined,
    });
  } catch (error) {
    await updateBackupStatus({
      lastError: error instanceof Error ? error.message : "Email backup failed",
    });
    throw error;
  }
}

/** Uses metadata changes, not backup status writes, to avoid self-triggering backup loops. */
export function startAutoBackup(
  onRemoteNewer?: (
    result: Extract<DriveSyncResult, { kind: "remote-newer" }>,
  ) => void,
): () => void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let remotePending = false;
  let lastFingerprint = "";
  const run = async () => {
    if (stopped || !navigator.onLine || !isGoogleConnected() || remotePending)
      return;
    const settings = await db.settings.get("settings");
    try {
      if (settings?.backup.autoDrive) {
        const result = await syncDrive();
        if (result.kind === "remote-newer") {
          remotePending = true;
          onRemoteNewer?.(result);
          return;
        }
      }
      if (settings?.backup.emailEnabled) {
        const lastEmail = String(settings.backup.lastEmailSuccess || "");
        const manilaDay = (value: Date) =>
          new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
            value,
          );
        if (
          settings.backup.emailFrequency === "changes" ||
          !lastEmail ||
          manilaDay(new Date(lastEmail)) !== manilaDay(new Date())
        )
          await sendEmailBackup();
      }
    } catch {
      /* The detailed error is persisted in Settings and surfaced by the backup status chip. */
    }
  };
  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void run(), 2500);
  };
  const subscription = liveQuery(async () => {
    const rows = await Promise.all(
      [
        "borrowers",
        "loans",
        "transactions",
        "notes",
        "signerProfiles",
        "tombstones",
        "settings",
      ].map((table) => db.table(table).toArray()),
    );
    return JSON.stringify(
      rows.map((table, index) =>
        table.map((row) =>
          index === 6
            ? { id: row.id, updatedAt: row.updatedAt }
            : { id: row.id, updatedAt: row.updatedAt },
        ),
      ),
    );
  }).subscribe({
    next(fingerprint) {
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        remotePending = false;
        schedule();
      }
    },
    error() {
      /* IndexedDB availability is handled by the application. */
    },
  });
  window.addEventListener("online", schedule);
  window.addEventListener("focus", schedule);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(debounce);
    subscription.unsubscribe();
    window.removeEventListener("online", schedule);
    window.removeEventListener("focus", schedule);
  };
}
