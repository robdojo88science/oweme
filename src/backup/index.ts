import Dexie from "dexie";
import { db } from "../data/db";
import { today } from "../core/logic";
import type {
  BackupData,
  BackupFile,
  BackupRecord,
  BackupTable,
  ImportPreview,
  ImportSummary,
} from "./format";
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
  emptyBackupData,
  encodeValue,
  mergeBackupData,
  parseBackup,
} from "./format";
export * from "./format";

export async function readBackupData(): Promise<BackupData> {
  const entries = await Promise.all(
    BACKUP_TABLES.map(
      async (name) => [name, await db.table(name).toArray()] as const,
    ),
  );
  return Object.fromEntries(entries) as BackupData;
}

export async function exportBackup(lite = false): Promise<string> {
  const tables = await db.transaction(
    "r",
    BACKUP_TABLES.map((name) => db.table(name)),
    readBackupData,
  );
  return JSON.stringify(
    await encodeValue(
      {
        app: "OweMe",
        schemaVersion: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        lite,
        tables,
      },
      lite,
    ),
  );
}

/** Snapshot history deliberately stays local to avoid exponentially nested backups. */
export async function createSnapshot(reason: string): Promise<void> {
  const data = await exportBackup();
  const now = new Date().toISOString();
  await db.transaction("rw", db.snapshots, async () => {
    await db.snapshots.add({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      reason,
      data,
    });
    const snapshots = await db.snapshots
      .orderBy("createdAt")
      .reverse()
      .toArray();
    if (snapshots.length > 5)
      await db.snapshots.bulkDelete(
        snapshots.slice(5).map((snapshot) => snapshot.id),
      );
  });
}

export async function updateBackupStatus(
  patch: Record<string, unknown>,
): Promise<void> {
  const settings = await db.settings.get("settings");
  if (settings)
    await db.settings.update(settings.id, {
      backup: { ...settings.backup, ...patch },
    });
}

export async function previewImport(json: string): Promise<ImportPreview> {
  const backup = parseBackup(json);
  const local = await readBackupData();
  const { summary } = mergeBackupData(local, backup.tables);
  const dates = backup.tables.transactions
    .map((transaction) => String(transaction.date))
    .sort();
  return {
    backup,
    exportedAt: backup.exportedAt,
    lite: backup.lite,
    counts: Object.fromEntries(
      BACKUP_TABLES.map((table) => [table, backup.tables[table].length]),
    ) as Record<BackupTable, number>,
    conflicts: summary.conflicts,
    from: dates[0],
    to: dates.at(-1),
  };
}

/** Validate again at the write boundary. Snapshot and replacement commit atomically. */
export async function importBackup(
  backup: BackupFile,
  mode: "merge" | "replace",
): Promise<ImportSummary> {
  const validated = parseBackup(JSON.stringify(await encodeValue(backup)));
  return db.transaction(
    "rw",
    [...BACKUP_TABLES.map((name) => db.table(name)), db.snapshots],
    async () => {
      const local = await readBackupData();
      const { tables, summary } = mergeBackupData(
        local,
        validated.tables,
        mode === "replace",
        validated.lite && mode === "merge",
      );
      const now = new Date().toISOString();
      const snapshotJson = JSON.stringify(
        await Dexie.waitFor(
          encodeValue({
            app: "OweMe",
            schemaVersion: BACKUP_VERSION,
            exportedAt: now,
            lite: false,
            tables: local,
          }),
        ),
      );
      await db.snapshots.add({
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        reason: `Before ${mode} import`,
        data: snapshotJson,
      });
      const snapshots = await db.snapshots
        .orderBy("createdAt")
        .reverse()
        .toArray();
      if (snapshots.length > 5)
        await db.snapshots.bulkDelete(
          snapshots.slice(5).map((snapshot) => snapshot.id),
        );
      for (const table of BACKUP_TABLES) {
        await db.table(table).clear();
        if (tables[table].length)
          await db.table<BackupRecord>(table).bulkPut(tables[table]);
      }
      return summary;
    },
  );
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  createWritable(): Promise<{
    write(blob: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}>;
let rememberedHandle: Awaited<ReturnType<SavePicker>> | undefined;

export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A completed share/file write is verified; a download still needs the admin to retain it. */
export async function saveLocalBackup(lite = false): Promise<void> {
  try {
    const json = await exportBackup(lite);
    const filename = `OweMe-backup${lite ? "-lite" : ""}-${today()}.json`;
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], filename, { type: blob.type });
    const browser = window as Window & { showSaveFilePicker?: SavePicker };
    if (
      browser.showSaveFilePicker &&
      !/Android|iPhone|iPad/i.test(navigator.userAgent)
    ) {
      rememberedHandle ??= await browser.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "OweMe JSON backup",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writer = await rememberedHandle.createWritable();
      await writer.write(blob);
      await writer.close();
    } else if (navigator.canShare?.({ files: [file] }))
      await navigator.share({ title: "OweMe backup", files: [file] });
    else downloadFile(blob, filename);
    await updateBackupStatus({
      lastSuccess: new Date().toISOString(),
      lastError: undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    await updateBackupStatus({
      lastError: error instanceof Error ? error.message : "Local backup failed",
    });
    throw error;
  }
}

/** Explicit restore entry point; no import runs simply because a file was selected. */
export async function restoreSnapshot(id: string): Promise<ImportPreview> {
  const snapshot = await db.snapshots.get(id);
  if (!snapshot) throw new Error("That local snapshot is no longer available.");
  return previewImport(snapshot.data);
}

export const noData: BackupData = emptyBackupData();
