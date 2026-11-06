import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  DatabaseBackup,
  FileCheck2,
  LoaderCircle,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { Borrower } from "../core/model";
import { canClearAll, canDeleteBorrower } from "../core/logic";
import { db, initDB } from "../data/db";
import { anonymizeBorrower, archiveBorrower } from "../data/service";
import { createSnapshot, importBackup, saveLocalBackup } from "../backup";
import type { ImportPreview, ImportSummary } from "../backup";
import {
  isGoogleConnected,
  mergeDriveBackup,
  sendEmailBackup,
  syncDrive,
} from "../backup/google";
import type { DriveSyncResult } from "../backup/google";
import { ErrorBox, Modal, Money } from "./primitives";
import { haptic } from "./store";

type CommonProps = { onClose(): void; onToast(message: string): void };
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The operation could not finish. Your current data is unchanged.";

export function DeleteBorrowerDialog({
  borrower,
  onClose,
  onDeleted,
  onToast,
}: CommonProps & { borrower: Borrower; onDeleted(): void | Promise<void> }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secondConfirm, setSecondConfirm] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [retentionReviewed, setRetentionReviewed] = useState(false);
  useEffect(() => {
    void db.settings
      .get("settings")
      .then((settings) => haptic("warning", settings?.haptics));
  }, []);
  const allowed = canDeleteBorrower(borrower.fullName, confirmation);
  const remove = async () => {
    if (!allowed || !secondConfirm || !retentionReviewed || busy) return;
    setBusy(true);
    setError("");
    try {
      await anonymizeBorrower(borrower.id, confirmation, retentionReviewed);
      onToast(
        "Borrower personal details anonymized. Financial amounts remain in history.",
      );
      await onDeleted();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!allowed || !secondConfirm || busy) return;
    setBusy(true);
    setError("");
    try {
      await archiveBorrower(borrower.id, confirmation);
      onToast(
        "Borrower archived. You can find the account with the Archived filter.",
      );
      await onDeleted();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  return (
    <Modal
      title={privacy ? "Privacy erasure review" : "Archive borrower"}
      subtitle={
        privacy
          ? "Separate action after reviewing retention obligations"
          : "Keep every loan, receipt, and document"
      }
      onClose={close}
    >
      <div className="modal-body">
        <div className={`alert ${privacy ? "error" : ""}`}>
          {privacy ? (
            <>
              Review applicable retention and legal obligations before
              proceeding. This removes the profile, contact details, notes,
              signatures, and proof images, and anonymizes loan and receipt
              names. Financial amounts and numbering remain. Local recovery
              snapshots are removed. Existing downloaded or cloud backups and
              documents must be reviewed separately.
            </>
          ) : (
            <>
              <Archive size={16} aria-hidden="true" />{" "}
              <strong>{borrower.fullName}</strong> will leave the active
              directory. All history stays available, and you can restore the
              account from the Archived filter.
            </>
          )}
        </div>
        {privacy && (
          <label className="checkbox-row" style={{ marginTop: 18 }}>
            <input
              type="checkbox"
              checked={retentionReviewed}
              onChange={(e) => setRetentionReviewed(e.target.checked)}
            />
            I have reviewed retention obligations and confirmed that
            anonymization is appropriate.
          </label>
        )}
        <label className="field" style={{ marginTop: 24 }}>
          <span>
            Type <strong>Delete {borrower.fullName}</strong> exactly
          </span>
          <input
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
              setSecondConfirm(false);
            }}
            disabled={busy}
            aria-label="Delete confirmation"
          />
        </label>
        <label className="checkbox-row" style={{ marginTop: 16 }}>
          <input
            type="checkbox"
            checked={secondConfirm}
            disabled={!allowed || busy}
            onChange={(e) => setSecondConfirm(e.target.checked)}
          />
          {privacy
            ? "I confirm this personal-data erasure cannot be undone in this notebook."
            : "I confirm I want to archive this borrower and preserve their history."}
        </label>
        <ErrorBox error={error} />
        <div className="form-actions">
          <button className="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            className="button danger"
            disabled={
              !allowed ||
              !secondConfirm ||
              (privacy && !retentionReviewed) ||
              busy
            }
            onClick={() => void (privacy ? remove() : archive())}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : privacy ? (
              <Trash2 size={16} />
            ) : (
              <Archive size={16} />
            )}
            {privacy ? "Anonymize personal data" : "Archive borrower"}
          </button>
        </div>
        <button
          type="button"
          className="text-button"
          style={{ marginTop: 20 }}
          disabled={busy}
          onClick={() => {
            setPrivacy(!privacy);
            setSecondConfirm(false);
            setConfirmation("");
          }}
        >
          {privacy ? "Back to archive" : "Review a privacy erasure request"}
        </button>
      </div>
    </Modal>
  );
}

export function ClearDataDialog({
  onClose,
  onCleared,
  onToast,
}: CommonProps & { onCleared(): void | Promise<void> }) {
  const [counts, setCounts] = useState({
    borrowers: 0,
    loans: 0,
    transactions: 0,
  });
  const [backupComplete, setBackupComplete] = useState(false);
  const [savedCopy, setSavedCopy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const enabled = useRef(true);
  const startedAt = useRef<number | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const busyRef = useRef(false);
  const ready =
    backupComplete &&
    savedCopy &&
    confirmation === "CLEAR ALL OWEME DATA" &&
    !busy;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const confirmationRef = useRef(confirmation);
  confirmationRef.current = confirmation;
  const copyRef = useRef(savedCopy);
  copyRef.current = savedCopy;

  const cancelHold = useCallback(() => {
    clearInterval(interval.current);
    interval.current = undefined;
    startedAt.current = null;
    setProgress(0);
  }, []);
  useEffect(() => {
    void Promise.all([
      db.borrowers.count(),
      db.loans.count(),
      db.transactions.count(),
      db.settings.get("settings"),
    ]).then(([borrowers, loans, transactions, settings]) => {
      setCounts({ borrowers, loans, transactions });
      enabled.current = settings?.haptics ?? true;
      haptic("warning", enabled.current);
    });
    window.addEventListener("blur", cancelHold);
    const visibility = () => {
      if (document.hidden) cancelHold();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(interval.current);
      window.removeEventListener("blur", cancelHold);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [cancelHold]);

  const runBackup = async () => {
    if (busy) return;
    cancelHold();
    setBusy(true);
    setError("");
    setBackupMessage("");
    setSavedCopy(false);
    setBackupComplete(false);
    try {
      await saveLocalBackup();
      setBackupComplete(true);
      const settings = await db.settings.get("settings");
      const notices: string[] = [
        "Full local backup handed to your browser. Confirm below that you saved it outside this browser.",
      ];
      if (navigator.onLine && isGoogleConnected()) {
        if (settings?.backup.autoDrive || settings?.backup.driveFileId) {
          try {
            const result = await syncDrive();
            notices.push(
              result.kind === "remote-newer"
                ? "Drive contains a newer backup. It was preserved; review and merge it in Backup & Sync."
                : "Google Drive backup completed.",
            );
          } catch (cause) {
            notices.push(`Drive: ${errorText(cause)}`);
          }
        }
        if (settings?.backup.emailEnabled) {
          try {
            await sendEmailBackup();
            notices.push("Email backup sent.");
          } catch (cause) {
            notices.push(`Email: ${errorText(cause)}`);
          }
        }
      } else if (
        settings?.backup.autoDrive ||
        settings?.backup.driveFileId ||
        settings?.backup.emailEnabled
      )
        notices.push(
          "Google backup needs an online connection and renewed Google access. Keep the full local file before continuing.",
        );
      setBackupMessage(notices.join(" "));
      haptic("success", enabled.current);
    } catch (cause) {
      setError(errorText(cause));
      setBackupMessage(
        "The new backup failed. Clearing is blocked. Save a new full backup successfully before continuing.",
      );
    } finally {
      setBusy(false);
    }
  };

  const finishClear = async (actualHoldMs: number) => {
    if (
      !readyRef.current ||
      busyRef.current ||
      !canClearAll(
        confirmationRef.current,
        copyRef.current && backupComplete,
        actualHoldMs,
      )
    ) {
      cancelHold();
      return;
    }
    busyRef.current = true;
    clearInterval(interval.current);
    interval.current = undefined;
    startedAt.current = null;
    setProgress(100);
    setBusy(true);
    setError("");
    try {
      await createSnapshot("Before clear all data");
      await db.transaction("rw", db.tables, async () => {
        if (
          !canClearAll(
            confirmationRef.current,
            copyRef.current && backupComplete,
            actualHoldMs,
          )
        )
          throw new Error("The clear confirmation is incomplete.");
        for (const table of db.tables) await table.clear();
      });
      await initDB();
      haptic("success", enabled.current);
      onToast(
        "All local data cleared. Your downloaded backup is your recovery copy.",
      );
      await onCleared();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
      busyRef.current = false;
      setProgress(0);
    }
  };
  const startHold = () => {
    if (!readyRef.current || busyRef.current || startedAt.current !== null)
      return;
    haptic("warning", enabled.current);
    startedAt.current = performance.now();
    interval.current = setInterval(() => {
      if (startedAt.current === null || !readyRef.current) {
        cancelHold();
        return;
      }
      const elapsed = performance.now() - startedAt.current;
      setProgress(Math.min(100, elapsed / 30));
      if (elapsed >= 3000) void finishClear(elapsed);
    }, 40);
  };
  const close = useCallback(() => {
    if (!busy) {
      cancelHold();
      onClose();
    }
  }, [busy, cancelHold, onClose]);
  return (
    <Modal
      title="Clear all local data"
      subtitle="Make a full backup before starting again"
      onClose={close}
    >
      <div className="modal-body">
        <div className="alert error">
          <ShieldAlert size={17} aria-hidden="true" /> This erases{" "}
          <strong>
            {counts.borrowers} borrowers, {counts.loans} loans, and{" "}
            {counts.transactions} transactions
          </strong>
          , plus photos, signatures, settings, counters, and local recovery
          snapshots from this browser. Keep an independent full backup.
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => void runBackup()}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <DatabaseBackup size={17} />
          )}{" "}
          {backupComplete
            ? "Save another full backup"
            : "Save a full backup first"}
        </button>
        {backupMessage && (
          <div className={`alert ${backupComplete ? "success" : "amber"}`}>
            {backupMessage}
          </div>
        )}
        <label className="checkbox-row" style={{ marginTop: 18 }}>
          <input
            type="checkbox"
            disabled={!backupComplete || busy}
            checked={savedCopy}
            onChange={(event) => {
              cancelHold();
              setSavedCopy(event.target.checked);
            }}
          />
          I saved a full backup outside this browser and can find the file.
        </label>
        <label className="field" style={{ marginTop: 20 }}>
          <span>
            Type <strong>CLEAR ALL OWEME DATA</strong> exactly
          </span>
          <input
            value={confirmation}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            aria-label="Clear all confirmation"
            onChange={(event) => {
              cancelHold();
              setConfirmation(event.target.value);
            }}
          />
        </label>
        <p className="caption" style={{ marginTop: 15 }}>
          Then hold the button continuously for 3 seconds. Keyboard: focus the
          button and hold Space or Enter. Releasing early cancels.
        </p>
        <ErrorBox error={error} />
        <div className="form-actions">
          <button className="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="button danger hold-button"
            disabled={!ready}
            aria-label="Hold for 3 seconds to clear all local data"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              startHold();
            }}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            onLostPointerCapture={cancelHold}
            onBlur={cancelHold}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                cancelHold();
            }}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                if (!event.repeat) startHold();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                cancelHold();
              }
            }}
          >
            <span className="hold-progress" style={{ width: `${progress}%` }} />
            <Trash2 size={16} />
            {progress > 0
              ? `Keep holding… ${Math.max(0, 3 - Math.floor(progress * 0.03))}s`
              : "Hold 3 seconds to clear"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ImportPreviewDialog({
  preview,
  source,
  onClose,
  onImported,
  onToast,
}: CommonProps & {
  preview: ImportPreview;
  source?: Extract<DriveSyncResult, { kind: "remote-newer" }>;
  onImported(summary: ImportSummary): void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const runImport = async (mode: "merge" | "replace") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const summary =
        source && mode === "merge"
          ? await mergeDriveBackup(source)
          : await importBackup(preview.backup, mode, preview.accounting?.local);
      // A reviewed Drive replacement also acknowledges the exact remote version.
      if (source && mode === "replace") {
        const settings = await db.settings.get("settings");
        if (settings)
          await db.settings.update("settings", {
            backup: { ...settings.backup, lastSync: source.modifiedTime },
          });
      }
      await initDB();
      onToast(
        `Import complete: ${summary.added} added, ${summary.updated} updated${summary.conflicts.length ? `, ${summary.conflicts.length} numbering conflicts resolved` : ""}.`,
      );
      await onImported(summary);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  return (
    <Modal
      title={source ? "Review Google Drive backup" : "Review backup import"}
      subtitle="Your local data stays unchanged until you choose an import mode"
      onClose={close}
    >
      <div className="modal-body">
        <div className="backup-status-card">
          <FileCheck2 size={23} />
          <div>
            <b>
              Version 1 ·{" "}
              {preview.lite ? "Lite backup without images" : "Full backup"}
            </b>
            <p>
              Exported{" "}
              {new Intl.DateTimeFormat("en-PH", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Manila",
              }).format(new Date(preview.exportedAt))}
            </p>
            {preview.from && (
              <p>
                Transaction dates: {preview.from} to {preview.to}
              </p>
            )}
          </div>
        </div>
        <table className="schedule">
          <thead>
            <tr>
              <th>Records in this backup</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(preview.counts).map(([table, count]) => (
              <tr key={table}>
                <td>
                  {(
                    {
                      borrowers: "Borrowers",
                      loans: "Loans",
                      transactions: "Transactions",
                      settings: "Settings",
                      counters: "Numbering counters",
                      auditLogs: "Audit records",
                      tombstones: "Deletion markers",
                      signerProfiles: "Signer profiles",
                      notes: "Notes",
                    } as Record<string, string>
                  )[table] || table}
                </td>
                <td>{count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.conflicts.length > 0 && (
          <div className="alert amber">
            <strong>
              {preview.conflicts.length} numbering conflicts will be resolved.
            </strong>
            <ul>
              {preview.conflicts.slice(0, 12).map((conflict, index) => (
                <li key={index}>{conflict}</li>
              ))}
            </ul>
            {preview.conflicts.length > 12 && (
              <p>
                And {preview.conflicts.length - 12} more. Both records are kept.
              </p>
            )}
          </div>
        )}
        <div className="alert">
          A local recovery snapshot is saved first. <strong>Safe Merge</strong>{" "}
          combines compatible histories. Financial UUIDs cannot be overwritten,
          and divergent same-loan activity is blocked for review.{" "}
          <strong>Replace</strong> restores the incoming dataset and removes
          current records absent from it. Previously used numbering stays
          reserved.
        </div>
        {preview.accounting && (
          <>
            <h3 className="form-section-title">Compare accounting totals</h3>
            <table className="schedule">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Current</th>
                  <th>Replace</th>
                  <th>Safe merge</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Outstanding", "outstanding"],
                    ["Cash released", "released"],
                    ["Cash collected", "collected"],
                  ] as const
                ).map(([label, key]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>
                      <Money amount={preview.accounting!.local[key]} />
                    </td>
                    <td>
                      <Money amount={preview.accounting!.incoming[key]} />
                    </td>
                    <td>
                      {preview.accounting!.merged ? (
                        <Money amount={preview.accounting!.merged[key]} />
                      ) : (
                        "Blocked"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="caption" style={{ marginTop: 10 }}>
              Cash totals exclude reversed original entries. Outstanding is the
              current repayment obligation. Replace uses the incoming file as
              the complete authoritative notebook.
            </p>
          </>
        )}
        {preview.mergeBlocked && (
          <div className="alert error" role="alert">
            {preview.mergeBlocked}
          </div>
        )}
        {preview.lite && (
          <div className="alert amber">
            This backup excludes photos and signatures. Merge keeps existing
            local images for the same record and signature capture. Replace
            removes local images.
          </div>
        )}
        <ErrorBox error={error} />
        <div className="form-actions">
          <button className="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => void runImport("replace")}
          >
            Replace
          </button>
          <button
            className="button primary"
            disabled={busy || Boolean(preview.mergeBlocked)}
            onClick={() => void runImport("merge")}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <DatabaseBackup size={16} />
            )}
            Merge backup
          </button>
        </div>
      </div>
    </Modal>
  );
}
