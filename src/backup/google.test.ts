import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, initDB } from "../data/db";
import { exportBackup } from "./index";
import {
  connectGoogle,
  disconnectGoogle,
  isGoogleConnected,
  googleAccount,
  readGoogleAccount,
  mergeDriveBackup,
  sendEmailBackup,
  syncDrive,
} from "./google";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const remoteDate = "2026-11-05T00:00:00.000Z";
const clientId = "test-client.apps.googleusercontent.com";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initDB();
  vi.stubGlobal("window", {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: ({
            scope,
            callback,
          }: {
            scope: string;
            callback(value: unknown): void;
          }) => ({
            requestAccessToken() {
              callback({
                access_token: "test-only-token",
                expires_in: 3600,
                scope,
              });
            },
          }),
          revoke: vi.fn(),
        },
      },
    },
  });
});
afterEach(() => {
  disconnectGoogle();
  vi.unstubAllGlobals();
});

describe("Google browser backups", () => {
  it("shows account identity only from the authorized Drive API and clears it on disconnect", async () => {
    await connectGoogle(clientId);
    expect(googleAccount()).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          user: { displayName: "Owner", emailAddress: "owner@example.com" },
        }),
      ),
    );
    expect(await readGoogleAccount()).toBe("owner@example.com");
    expect(googleAccount()).toBe("owner@example.com");
    disconnectGoogle();
    expect(googleAccount()).toBeUndefined();
  });
  it("creates one named file then PATCHes the remembered file without creating duplicates", async () => {
    await connectGoogle(clientId);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ files: [] }))
      .mockResolvedValueOnce(
        response({ id: "drive-file", modifiedTime: remoteDate }),
      )
      .mockResolvedValueOnce(
        response({ id: "drive-file", modifiedTime: remoteDate }),
      )
      .mockResolvedValueOnce(
        response({
          id: "drive-file",
          modifiedTime: "2026-11-05T00:01:00.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const first = syncDrive(),
      concurrent = syncDrive();
    expect(first).toBe(concurrent);
    expect((await first).kind).toBe("backed-up");
    expect((await db.settings.get("settings"))?.backup.pendingDrive).toBe(
      false,
    );
    expect(
      (await db.settings.get("settings"))?.backup.lastDriveSuccess,
    ).toBeTruthy();
    expect((await db.settings.get("settings"))?.backup.driveFileId).toBe(
      "drive-file",
    );
    expect((await syncDrive()).kind).toBe("backed-up");
    const calls = fetchMock.mock.calls;
    expect(
      calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
    expect(
      calls.filter(([, options]) => options?.method === "PATCH"),
    ).toHaveLength(1);
    expect(calls[3][0]).toContain("/drive-file?uploadType=media");
    expect(new Headers(calls[3][1].headers).get("Authorization")).toBe(
      "Bearer test-only-token",
    );
    expect(await exportBackup()).not.toContain("test-only-token");
  });

  it("previews a newer remote file before any upload and merges only on explicit invocation", async () => {
    await connectGoogle(clientId);
    const remote = await exportBackup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ files: [{ id: "drive-file", modifiedTime: remoteDate }] }),
      )
      .mockResolvedValueOnce(new Response(remote));
    vi.stubGlobal("fetch", fetchMock);
    const result = await syncDrive();
    expect(result.kind).toBe("remote-newer");
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => !options?.method || options.method === "GET",
      ),
    ).toBe(true);
    expect(await db.snapshots.count()).toBe(0);
    if (result.kind !== "remote-newer") throw new Error("Expected a preview");
    await mergeDriveBackup(result);
    expect(await db.snapshots.count()).toBe(1);
    expect((await db.settings.get("settings"))?.backup.lastSync).toBe(
      remoteDate,
    );
  });

  it("queues offline changes without making a request or reporting a successful backup", async () => {
    await connectGoogle(clientId);
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncDrive()).rejects.toThrow("Offline");
    expect(fetchMock).not.toHaveBeenCalled();
    const backup = (await db.settings.get("settings"))?.backup;
    expect(backup?.pendingDrive).toBe(true);
    expect(backup?.lastDriveSuccess).toBeUndefined();
  });

  it("keeps edits made during an upload pending for the next confirmed backup", async () => {
    await connectGoogle(clientId);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ files: [] }))
        .mockImplementationOnce(async () => {
          const at = new Date().toISOString();
          await db.notes.add({
            id: "during-upload",
            borrowerId: "b1",
            createdAt: at,
            updatedAt: at,
            kind: "manual",
            text: "Saved while uploading",
          });
          return response({ id: "drive-file", modifiedTime: remoteDate });
        }),
    );
    expect((await syncDrive()).kind).toBe("backed-up");
    expect((await db.settings.get("settings"))?.backup.pendingDrive).toBe(true);
  });

  it("uses ETag preconditions and records conflicts without claiming success", async () => {
    await connectGoogle(clientId);
    await db.settings.update("settings", {
      backup: { driveFileId: "drive-file", lastSync: remoteDate },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "drive-file", modifiedTime: remoteDate }),
          { headers: { ETag: "revision-a" } },
        ),
      )
      .mockResolvedValueOnce(response({}, 412));
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncDrive()).rejects.toThrow("changed on another device");
    expect(
      new Headers(fetchMock.mock.calls[1][1].headers).get("If-Match"),
    ).toBe("revision-a");
    expect(
      (await db.settings.get("settings"))?.backup.lastDriveSuccess,
    ).toBeUndefined();
    expect((await db.settings.get("settings"))?.backup.pendingDrive).toBe(true);
  });

  it("does not claim success for an incomplete Drive upload response", async () => {
    await connectGoogle(clientId);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ files: [] }))
        .mockResolvedValueOnce(response({})),
    );
    await expect(syncDrive()).rejects.toThrow("did not confirm");
    expect(
      (await db.settings.get("settings"))?.backup.lastDriveSuccess,
    ).toBeUndefined();
  });

  it("does not create a replacement when an already-linked Drive file becomes inaccessible", async () => {
    await connectGoogle(clientId);
    await db.settings.update("settings", {
      backup: { driveFileId: "missing-file" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ error: { message: "File not found" } }, 404),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncDrive()).rejects.toThrow("404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db.settings.get("settings"))?.backup.lastError).toContain(
      "404",
    );
  });

  it("expires authorization on a 401 and retains the local database", async () => {
    await connectGoogle(clientId);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 401)));
    await expect(syncDrive()).rejects.toThrow("expired");
    expect(isGoogleConnected()).toBe(false);
    expect(await db.settings.count()).toBe(1);
  });

  it("sends a MIME JSON attachment through Gmail from the authorized account", async () => {
    await connectGoogle(clientId, true);
    await db.settings.update("settings", {
      backup: { email: "owner@example.com" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ id: "sent-message" }));
    vi.stubGlobal("fetch", fetchMock);
    await sendEmailBackup();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    const { raw } = JSON.parse(options.body) as { raw: string };
    const mime = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    expect(mime).toContain("To: owner@example.com");
    expect(mime).toContain(
      'Content-Disposition: attachment; filename="OweMe-backup.json"',
    );
    expect(mime).not.toContain("\r\nFrom:");
    expect(
      (await db.settings.get("settings"))?.backup.lastEmailSuccess,
    ).toBeTruthy();
  });

  it("requires explicit Gmail permission and validates a client ID before loading anything", async () => {
    await expect(
      connectGoogle("client-secret-is-not-a-client-id"),
    ).rejects.toThrow("Web Client ID");
    await connectGoogle(clientId);
    expect(isGoogleConnected()).toBe(true);
    await expect(sendEmailBackup()).rejects.toThrow("Email backup enabled");
  });
});
