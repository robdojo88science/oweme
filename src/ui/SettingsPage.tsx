import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  Cloud,
  Download,
  HardDrive,
  LoaderCircle,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import type { Settings } from "../core/model";
import { db, metadata, saveSettings } from "../data/db";
import {
  previewImport,
  restoreSnapshot,
  saveLocalBackup,
  updateBackupStatus,
} from "../backup";
import type { ImportPreview } from "../backup";
import {
  connectGoogle,
  disconnectGoogle,
  isGoogleConnected,
  restoreDrive,
  sendEmailBackup,
  syncDrive,
} from "../backup/google";
import { SignatureCapture } from "../components/SignatureCapture";
import { compressImage } from "../media/images";
import { ErrorBox, Help } from "./primitives";
import { haptic } from "./store";

interface Props {
  settings: Settings;
  onImport: (preview: ImportPreview, source?: "drive" | "file") => void;
  onClear: () => void;
  onToast: (message: string) => void;
}
const timestamp = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "No backup yet";
const bytes = (value = 0) => `${(value / 1024 / 1024).toFixed(1)} MB`;
function Card({
  title,
  topic,
  children,
}: {
  title: string;
  topic: Parameters<typeof Help>[0]["topic"];
  children: ReactNode;
}) {
  return (
    <section className="panel settings-card">
      <div className="section-title">
        <h2>
          {title} <Help topic={topic} />
        </h2>
      </div>
      {children}
    </section>
  );
}

export function SettingsPage({ settings, onImport, onClear, onToast }: Props) {
  const fieldId = useId();
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(isGoogleConnected());
  const [storage, setStorage] = useState<{
    persisted?: boolean;
    usage?: number;
    quota?: number;
  }>({});
  const [logoURL, setLogoURL] = useState("");
  const loadedVersion = useRef(settings.updatedAt);
  const profiles =
    useLiveQuery(() => db.signerProfiles.orderBy("name").toArray(), []) ?? [];
  const snapshots =
    useLiveQuery(
      () => db.snapshots.orderBy("createdAt").reverse().toArray(),
      [],
    ) ?? [];
  const counts = useLiveQuery(
    async () => ({
      borrowers: await db.borrowers.count(),
      loans: await db.loans.count(),
      transactions: await db.transactions.count(),
    }),
    [],
  );
  useEffect(() => {
    if (loadedVersion.current !== settings.updatedAt) {
      loadedVersion.current = settings.updatedAt;
      setDraft(structuredClone(settings));
    }
  }, [settings]);
  useEffect(() => {
    if (!draft.business.logo) {
      setLogoURL("");
      return;
    }
    const url = URL.createObjectURL(draft.business.logo);
    setLogoURL(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.business.logo]);
  useEffect(() => {
    void Promise.all([
      navigator.storage?.persisted?.(),
      navigator.storage?.estimate?.(),
    ])
      .then(([persisted, estimate]) =>
        setStorage({
          persisted,
          usage: estimate?.usage,
          quota: estimate?.quota,
        }),
      )
      .catch(() => undefined);
  }, []);

  const edit = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const editBackup = (patch: Partial<Settings["backup"]>) =>
    setDraft((current) => ({
      ...current,
      backup: { ...current.backup, ...patch },
    }));
  const editDefaults = (patch: Partial<Settings["defaults"]>) =>
    setDraft((current) => ({
      ...current,
      defaults: { ...current.defaults, ...patch },
    }));
  const editScoring = (key: keyof Settings["scoring"], value: number) =>
    setDraft((current) => ({
      ...current,
      scoring: { ...current.scoring, [key]: value },
    }));
  async function persist(): Promise<void> {
    if (!draft.business.name.trim()) throw new Error("Enter a business name.");
    if (
      !Number.isFinite(draft.defaults.rate) ||
      draft.defaults.rate < 0 ||
      draft.defaults.rate >= 1
    )
      throw new Error("Default interest must be from 0% to below 100%.");
    if (
      !Number.isInteger(draft.defaults.maxTerm) ||
      draft.defaults.maxTerm < 1 ||
      draft.defaults.maxTerm > 120
    )
      throw new Error("Maximum term must be from 1 to 120 months.");
    if (
      !Number.isInteger(draft.defaults.graceDays) ||
      draft.defaults.graceDays < 0 ||
      draft.defaults.graceDays > 365
    )
      throw new Error("Mercy days must be from 0 to 365.");
    if (
      Object.entries(draft.scoring).some(
        ([key, value]) =>
          !Number.isFinite(value) ||
          (key === "recency"
            ? value <= 0 || value > 1
            : value < 0 || value > 100),
      )
    )
      throw new Error(
        "Score values must be from 0 to 100. Recency weight must be above 0 and at most 1.",
      );
    if (draft.scoring.minimum > draft.scoring.lateBase)
      throw new Error(
        "Minimum late score cannot exceed the starting late score.",
      );
    if (
      draft.backup.email &&
      !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(draft.backup.email)
    )
      throw new Error("Enter a valid backup email address.");
    if (
      [draft.agreementText, draft.reminderTemplate, draft.receiptFooter].some(
        (text) =>
          /\b(?:(?:mercy|grace)\s+(?:period|days?|until|window)|graceDays|graceUntil)\b/i.test(
            text,
          ),
      )
    )
      throw new Error(
        "Borrower-facing agreement, reminder, and footer text must not mention the private mercy period.",
      );
    const latest = await db.settings.get("settings");
    const { googleClientId, email, emailEnabled, autoDrive, emailFrequency } =
      draft.backup;
    const next: Settings = {
      ...draft,
      business: { ...draft.business, name: draft.business.name.trim() },
      backup: {
        ...latest?.backup,
        googleClientId,
        email,
        emailEnabled,
        autoDrive,
        emailFrequency,
      },
    };
    await saveSettings(next);
    const name = next.defaultReceivedBy.trim();
    if (name) {
      const existing = await db.signerProfiles
        .where("name")
        .equals(name)
        .first();
      await db.signerProfiles.put(
        existing
          ? {
              ...existing,
              defaultSignature: next.adminSignature,
              updatedAt: new Date().toISOString(),
            }
          : { ...metadata(), name, defaultSignature: next.adminSignature },
      );
    }
  }
  async function run(
    key: string,
    action: () => Promise<void>,
    success?: string,
  ) {
    setBusy(key);
    setError("");
    try {
      await action();
      if (success) onToast(success);
      haptic("success", draft.haptics);
    } catch (problem) {
      if (!(problem instanceof DOMException && problem.name === "AbortError")) {
        setError(
          problem instanceof Error
            ? problem.message
            : "The action could not finish.",
        );
        haptic("error", draft.haptics);
      }
    } finally {
      setBusy("");
      setConnected(isGoogleConnected());
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void run("save", persist, "Settings saved");
  }
  async function sync() {
    await persist();
    const result = await syncDrive();
    if (result.kind === "remote-newer") {
      await updateBackupStatus({
        pendingDriveModifiedTime: result.modifiedTime,
      });
      onImport(result.preview, "drive");
    } else onToast("Google Drive backup saved");
  }
  const buttonIcon = (key: string, icon: ReactNode) =>
    busy === key ? <LoaderCircle size={16} className="spin" /> : icon;
  const clientId =
    draft.backup.googleClientId ||
    String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "");
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>Settings</h1>
          <p>A little setup. A more personal notebook.</p>
        </div>
        <span className="date-pill">
          <ShieldCheck size={14} /> Local-first · v1.0.0
        </span>
      </div>
      <ErrorBox error={error} />
      <div className="settings-layout">
        <form onSubmit={save}>
          <Card title="Business profile" topic="privacy">
            <div className="form-grid">
              <label
                htmlFor={`${fieldId}-business-name`}
                className="field full"
              >
                <span>
                  Business name <Help topic="privacy" />
                </span>
                <input
                  id={`${fieldId}-business-name`}
                  aria-label="Business name"
                  required
                  value={draft.business.name}
                  onChange={(event) =>
                    edit("business", {
                      ...draft.business,
                      name: event.target.value,
                    })
                  }
                />
              </label>
              <label
                htmlFor={`${fieldId}-business-address`}
                className="field full"
              >
                <span>Business address</span>
                <textarea
                  id={`${fieldId}-business-address`}
                  aria-label="Business address"
                  rows={2}
                  value={draft.business.address}
                  onChange={(event) =>
                    edit("business", {
                      ...draft.business,
                      address: event.target.value,
                    })
                  }
                />
              </label>
              <div className="photo-edit">
                {logoURL && (
                  <img
                    src={logoURL}
                    alt="Business logo preview"
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 12,
                      objectFit: "contain",
                    }}
                  />
                )}
                <label htmlFor={`${fieldId}-business-logo`} className="field">
                  <span>Business logo</span>
                  <input
                    id={`${fieldId}-business-logo`}
                    aria-label="Business logo"
                    type="file"
                    accept="image/*"
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void run("logo", async () =>
                          edit("business", {
                            ...draft.business,
                            logo: await compressImage(file),
                          }),
                        );
                    }}
                  />
                  <small>
                    Compressed on this device. Appears on receipts and
                    statements.
                  </small>
                </label>
                {draft.business.logo && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove business logo"
                    onClick={() =>
                      edit("business", { ...draft.business, logo: undefined })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <label htmlFor={`${fieldId}-borrower-prefix`} className="field">
                <span>
                  Borrower ID prefix <Help topic="prefix" />
                </span>
                <input
                  id={`${fieldId}-borrower-prefix`}
                  aria-label="Borrower ID prefix"
                  value={draft.borrowerPrefix}
                  maxLength={20}
                  placeholder="Optional, e.g. BR-"
                  onChange={(event) =>
                    edit("borrowerPrefix", event.target.value)
                  }
                />
              </label>
              <label htmlFor={`${fieldId}-admin-email`} className="field">
                <span>
                  Admin email <Help topic="backup" />
                </span>
                <input
                  id={`${fieldId}-admin-email`}
                  aria-label="Admin email"
                  type="email"
                  value={draft.adminEmail}
                  placeholder="you@example.com"
                  onChange={(event) => edit("adminEmail", event.target.value)}
                />
              </label>
              <label htmlFor={`${fieldId}-received-by`} className="field full">
                <span>
                  Default issued / received by <Help topic="receivedBy" />
                </span>
                <input
                  id={`${fieldId}-received-by`}
                  aria-label="Default issued / received by"
                  list="saved-signer-profiles"
                  value={draft.defaultReceivedBy}
                  placeholder="Any name"
                  onChange={(event) =>
                    edit("defaultReceivedBy", event.target.value)
                  }
                />
                <datalist id="saved-signer-profiles">
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.name} />
                  ))}
                </datalist>
              </label>
              {profiles.some((profile) => profile.defaultSignature) && (
                <label
                  htmlFor={`${fieldId}-saved-signer`}
                  className="field full"
                >
                  <span>Apply a saved signer</span>
                  <select
                    id={`${fieldId}-saved-signer`}
                    aria-label="Apply a saved signer"
                    value=""
                    onChange={(event) => {
                      const profile = profiles.find(
                        (item) => item.id === event.target.value,
                      );
                      if (profile)
                        setDraft((current) => ({
                          ...current,
                          defaultReceivedBy: profile.name,
                          adminSignature: profile.defaultSignature,
                        }));
                    }}
                  >
                    <option value="">Choose a signer profile…</option>
                    {profiles
                      .filter((profile) => profile.defaultSignature)
                      .map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            <SignatureCapture
              label="Default lender signature"
              signerName={draft.defaultReceivedBy || "Lender"}
              value={draft.adminSignature}
              onChange={(value) => edit("adminSignature", value)}
            />
          </Card>
          <Card title="Loan defaults" topic="defaults">
            <div className="form-grid">
              <label htmlFor={`${fieldId}-interest-rate`} className="field">
                <span>
                  Interest rate (%) <Help topic="rate" />
                </span>
                <input
                  id={`${fieldId}-interest-rate`}
                  aria-label="Interest rate (%)"
                  type="number"
                  min={0}
                  max={99.99}
                  step="0.01"
                  required
                  value={Number((draft.defaults.rate * 100).toFixed(2))}
                  onChange={(event) =>
                    editDefaults({ rate: Number(event.target.value) / 100 })
                  }
                />
              </label>
              <label htmlFor={`${fieldId}-maximum-term`} className="field">
                <span>
                  Maximum term (months) <Help topic="term" />
                </span>
                <input
                  id={`${fieldId}-maximum-term`}
                  aria-label="Maximum term (months)"
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  required
                  value={draft.defaults.maxTerm}
                  onChange={(event) =>
                    editDefaults({ maxTerm: Number(event.target.value) })
                  }
                />
              </label>
              <label htmlFor={`${fieldId}-mercy-days`} className="field">
                <span>
                  Mercy days · admin only <Help topic="mercy" />
                </span>
                <input
                  id={`${fieldId}-mercy-days`}
                  aria-label="Mercy days ? admin only"
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  required
                  value={draft.defaults.graceDays}
                  onChange={(event) =>
                    editDefaults({ graceDays: Number(event.target.value) })
                  }
                />
              </label>
              <label htmlFor={`${fieldId}-interest-mode`} className="field">
                <span>
                  Interest mode <Help topic="face" />
                </span>
                <select
                  id={`${fieldId}-interest-mode`}
                  aria-label="Interest mode"
                  value={draft.defaults.interestMode}
                  onChange={(event) =>
                    editDefaults({
                      interestMode: event.target.value as "upfront" | "added",
                    })
                  }
                >
                  <option value="upfront">Deducted upfront</option>
                  <option value="added">Added on top</option>
                </select>
              </label>
            </div>
            <p className="caption" style={{ marginTop: 15 }}>
              These apply to new agreements. Borrower account overrides take
              priority.
            </p>
          </Card>
          <Card title="Performance rating" topic="rating">
            <div className="form-grid">
              {(
                [
                  ["onTime", "Paid by due date"],
                  ["withinGrace", "Paid within mercy"],
                  ["lateBase", "Late starting score"],
                  ["latePerDay", "Deduction per late day"],
                  ["minimum", "Minimum late score"],
                ] as const
              ).map(([key, label]) => (
                <label
                  htmlFor={`${fieldId}-scoring-${key}`}
                  key={key}
                  className="field"
                >
                  <span>
                    {label} <Help topic="scoring" />
                  </span>
                  <input
                    id={`${fieldId}-scoring-${key}`}
                    aria-label={label}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    required
                    value={draft.scoring[key]}
                    onChange={(event) =>
                      editScoring(key, Number(event.target.value))
                    }
                  />
                </label>
              ))}
              <label htmlFor={`${fieldId}-recency-weight`} className="field">
                <span>
                  Recency weight <Help topic="rating" />
                </span>
                <input
                  id={`${fieldId}-recency-weight`}
                  aria-label="Recency weight"
                  type="number"
                  min={0.01}
                  max={1}
                  step={0.01}
                  required
                  value={draft.scoring.recency}
                  onChange={(event) =>
                    editScoring("recency", Number(event.target.value))
                  }
                />
                <small>
                  0.90 gives each older installment 90% of the next one's
                  weight.
                </small>
              </label>
            </div>
          </Card>
          <Card title="Your words, on every slip" topic="agreement">
            <label htmlFor={`${fieldId}-acknowledgement`} className="field">
              <span>
                Loan acknowledgement <Help topic="agreement" />
              </span>
              <textarea
                id={`${fieldId}-acknowledgement`}
                aria-label="Loan acknowledgement"
                rows={5}
                value={draft.agreementText}
                onChange={(event) => edit("agreementText", event.target.value)}
              />
            </label>
            <label htmlFor={`${fieldId}-receipt-footer`} className="field">
              <span>
                Receipt footer <Help topic="agreement" />
              </span>
              <textarea
                id={`${fieldId}-receipt-footer`}
                aria-label="Receipt footer"
                rows={2}
                value={draft.receiptFooter}
                onChange={(event) => edit("receiptFooter", event.target.value)}
              />
            </label>
            <label htmlFor={`${fieldId}-payment-reminder`} className="field">
              <span>
                Payment reminder <Help topic="reminder" />
              </span>
              <textarea
                id={`${fieldId}-payment-reminder`}
                aria-label="Payment reminder"
                rows={4}
                value={draft.reminderTemplate}
                onChange={(event) =>
                  edit("reminderTemplate", event.target.value)
                }
              />
              <small>
                Use {"{name}"}, {"{amount}"}, {"{dueDate}"}, {"{loanNo}"}, and{" "}
                {"{business}"}. Only official due dates belong in borrower
                messages.
              </small>
            </label>
          </Card>
          <Card title="Device preferences" topic="haptics">
            <div className="setting-row">
              <div>
                <b>
                  Gentle haptics <Help topic="haptics" />
                </b>
                <p>
                  Small feedback for taps and saved changes, where supported.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.haptics}
                aria-label="Gentle haptics"
                className={`toggle ${draft.haptics ? "on" : ""}`}
                onClick={() => {
                  haptic("select", !draft.haptics);
                  edit("haptics", !draft.haptics);
                }}
              />
            </div>
            <p className="caption" style={{ marginTop: 15 }}>
              No account or app lock is required. Secure this device with its
              own screen lock.
            </p>
          </Card>
          <div className="settings-save">
            <button
              className="button primary"
              type="submit"
              disabled={Boolean(busy)}
            >
              {buttonIcon("save", <Save size={16} />)} Save settings
            </button>
          </div>
        </form>
        <div>
          <Card title="Backup & sync" topic="backup">
            <div className="backup-status-card">
              <ShieldCheck size={28} />
              <div>
                <b>
                  {settings.backup.lastSuccess
                    ? "Your notebook has a backup"
                    : "Give your notebook a safety net"}
                </b>
                <p>{timestamp(settings.backup.lastSuccess)}</p>
                <p>
                  {connected
                    ? "Google connected for this session"
                    : "Saved on this device · Google not connected"}
                </p>
              </div>
            </div>
            {settings.backup.lastError && (
              <div className="alert error" role="status">
                {settings.backup.lastError}
                <button
                  className="text-button"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run(
                      "retry",
                      connected && draft.backup.autoDrive
                        ? sync
                        : async () => {
                            await persist();
                            await saveLocalBackup();
                          },
                      "Backup retried",
                    )
                  }
                >
                  Retry backup <RefreshCw size={13} />
                </button>
              </div>
            )}
            <h3 className="form-section-title">01 / Local JSON file</h3>
            <p className="caption">
              Full backups include photos, signatures, and payment proof. Lite
              backups leave images out.
            </p>
            <div className="backup-buttons">
              <button
                type="button"
                className="button primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run(
                    "full",
                    async () => {
                      await persist();
                      await saveLocalBackup();
                    },
                    "Full backup saved. Keep the file outside this browser.",
                  )
                }
              >
                {buttonIcon("full", <Download size={15} />)} Full backup
              </button>
              <button
                type="button"
                className="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run(
                    "lite",
                    async () => {
                      await persist();
                      await saveLocalBackup(true);
                    },
                    "Lite backup saved without images",
                  )
                }
              >
                {buttonIcon("lite", <Download size={15} />)} Lite
              </button>
            </div>
            <label htmlFor={`${fieldId}-import-backup`} className="field">
              <span>
                <Upload size={13} /> Import a backup <Help topic="backup" />
              </span>
              <input
                id={`${fieldId}-import-backup`}
                aria-label="Import a backup"
                type="file"
                accept="application/json,.json"
                disabled={Boolean(busy)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file)
                    void run("import", async () => {
                      onImport(await previewImport(await file.text()), "file");
                    });
                }}
              />
              <small>
                Review counts and conflicts before choosing Merge or Replace.
              </small>
            </label>
            <h3 className="form-section-title">02 / Google Drive</h3>
            <label htmlFor={`${fieldId}-google-client-id`} className="field">
              <span>
                Google Web Client ID <Help topic="backup" />
              </span>
              <input
                id={`${fieldId}-google-client-id`}
                aria-label="Google Web Client ID"
                value={draft.backup.googleClientId ?? ""}
                placeholder={String(
                  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
                    "…apps.googleusercontent.com",
                )}
                onChange={(event) =>
                  editBackup({ googleClientId: event.target.value.trim() })
                }
              />
              <small>
                Use your own Google Cloud project. Setup instructions are in the
                README.
              </small>
            </label>
            <label htmlFor={`${fieldId}-auto-drive`} className="checkbox-row">
              <input
                id={`${fieldId}-auto-drive`}
                aria-label="Automatically back up to Drive"
                type="checkbox"
                checked={Boolean(draft.backup.autoDrive)}
                onChange={(event) =>
                  editBackup({ autoDrive: event.target.checked })
                }
              />{" "}
              Automatically back up to Drive <Help topic="backup" />
            </label>
            <div className="backup-buttons">
              <button
                className="button primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run(
                    "connect",
                    async () => {
                      await persist();
                      await connectGoogle(
                        clientId,
                        Boolean(draft.backup.emailEnabled),
                      );
                      setConnected(true);
                      const result = await syncDrive();
                      if (result.kind === "remote-newer") {
                        await updateBackupStatus({
                          pendingDriveModifiedTime: result.modifiedTime,
                        });
                        onImport(result.preview, "drive");
                      }
                    },
                    "Google connected",
                  )
                }
              >
                {buttonIcon("connect", <Cloud size={15} />)}{" "}
                {connected ? "Reconnect Google" : "Connect Google"}
              </button>
              {connected && (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    disconnectGoogle();
                    setConnected(false);
                    onToast(
                      "Google disconnected. Your local notebook is unchanged.",
                    );
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
            <div className="backup-buttons">
              <button
                type="button"
                className="button"
                disabled={Boolean(busy) || !connected}
                onClick={() => void run("drive", sync)}
              >
                {buttonIcon("drive", <RefreshCw size={15} />)} Back up / sync
                now
              </button>
              <button
                type="button"
                className="button"
                disabled={Boolean(busy) || !connected}
                onClick={() =>
                  void run("restore-drive", async () => {
                    await persist();
                    onImport(await restoreDrive(), "drive");
                  })
                }
              >
                {buttonIcon("restore-drive", <Archive size={15} />)} Restore
                from Drive
              </button>
            </div>
            {settings.backup.driveFileId && (
              <p className="caption">
                One linked OweMe-backup.json file. Last sync:{" "}
                {timestamp(settings.backup.lastSync)}
              </p>
            )}
            <div className="alert">
              <Help topic="backup" /> Automatic backup runs while the app is
              open, online, and connected to Google. A quick reconnect may be
              needed after access expires.
            </div>
            <h3 className="form-section-title">03 / Email backup</h3>
            <label htmlFor={`${fieldId}-backup-email`} className="field">
              <span>
                Backup email address <Help topic="backup" />
              </span>
              <input
                id={`${fieldId}-backup-email`}
                aria-label="Backup email address"
                type="email"
                value={draft.backup.email || ""}
                placeholder={draft.adminEmail || "you@example.com"}
                onChange={(event) => editBackup({ email: event.target.value })}
              />
            </label>
            <label
              htmlFor={`${fieldId}-email-enabled`}
              className="checkbox-row"
            >
              <input
                id={`${fieldId}-email-enabled`}
                aria-label="Enable Gmail sending permission"
                type="checkbox"
                checked={Boolean(draft.backup.emailEnabled)}
                onChange={(event) =>
                  editBackup({ emailEnabled: event.target.checked })
                }
              />{" "}
              Enable Gmail sending permission <Help topic="backup" />
            </label>
            <label htmlFor={`${fieldId}-email-frequency`} className="field">
              <span>Send automatically</span>
              <select
                id={`${fieldId}-email-frequency`}
                aria-label="Send automatically"
                value={draft.backup.emailFrequency || "daily"}
                onChange={(event) =>
                  editBackup({
                    emailFrequency: event.target.value as "daily" | "changes",
                  })
                }
              >
                <option value="daily">Daily, when the app opens</option>
                <option value="changes">After changes while open</option>
              </select>
            </label>
            <p className="caption">
              Email comes from your own Gmail. Enable permission, then reconnect
              Google. Backups above 20 MB use Lite.
            </p>
            <div className="backup-buttons">
              <button
                className="button"
                type="button"
                disabled={
                  Boolean(busy) || !connected || !draft.backup.emailEnabled
                }
                onClick={() =>
                  void run(
                    "email",
                    async () => {
                      await persist();
                      await sendEmailBackup();
                    },
                    "Backup email sent from your Gmail",
                  )
                }
              >
                {buttonIcon("email", <Mail size={15} />)} Send backup email
              </button>
              <button
                className="button"
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("email-fallback", async () => {
                    await persist();
                    await saveLocalBackup();
                    const recipient = draft.backup.email || draft.adminEmail;
                    window.location.href = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent("OweMe backup")}&body=${encodeURIComponent("My OweMe backup is attached. Please keep this file private.\n\nAttach the downloaded OweMe JSON file before sending.")}`;
                  })
                }
              >
                <Mail size={15} /> Email manually
              </button>
            </div>
            <p className="caption">
              Manual email opens your mail app. Attach the saved JSON file
              yourself before sending.
            </p>
          </Card>
          <Card title="Local recovery snapshots" topic="backup">
            <p className="caption">
              The last five safety snapshots stay in this browser. A snapshot is
              created before an import, restore, or clear.
            </p>
            {snapshots.length ? (
              snapshots.map((item) => (
                <div className="setting-row" key={item.id}>
                  <div>
                    <b>{item.reason}</b>
                    <p>{timestamp(item.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run(`snapshot-${item.id}`, async () =>
                        onImport(await restoreSnapshot(item.id), "file"),
                      )
                    }
                  >
                    Review restore
                  </button>
                </div>
              ))
            ) : (
              <div className="alert">
                <Archive size={15} /> No snapshots yet. Your first import or
                restore will create one.
              </div>
            )}
          </Card>
          <Card title="Storage & privacy" topic="storage">
            <div className="setting-row">
              <div>
                <b>
                  <HardDrive size={14} /> Browser storage{" "}
                  <Help topic="storage" />
                </b>
                <p>
                  {storage.usage === undefined
                    ? "Storage estimate is unavailable on this browser."
                    : `${bytes(storage.usage)} used${storage.quota ? ` of ${bytes(storage.quota)}` : ""}`}
                </p>
              </div>
              <span className="status">
                {storage.persisted ? "Persistent" : "Best effort"}
              </span>
            </div>
            {!storage.persisted && (
              <button
                className="button"
                type="button"
                style={{ marginTop: 14 }}
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("persist", async () => {
                    const persisted = await navigator.storage?.persist?.();
                    setStorage((current) => ({ ...current, persisted }));
                    onToast(
                      persisted
                        ? "Persistent storage enabled"
                        : "This browser may clear data. Keep a regular backup.",
                    );
                  })
                }
              >
                {buttonIcon("persist", <ShieldCheck size={15} />)} Request
                persistent storage
              </button>
            )}
            <p className="privacy" style={{ marginTop: 16 }}>
              OweMe stores borrower names, contact details, photos, and
              signatures on this device. Keep your device and backups private,
              share only what is needed, and handle personal information with
              care under the Philippine Data Privacy Act.{" "}
              <Help topic="privacy" />
            </p>
            <p className="caption" style={{ marginTop: 12 }}>
              Asia/Manila · Philippine peso · No backend · No borrower login
            </p>
          </Card>
          <section className="panel settings-card">
            <div className="section-title">
              <h2>Start over carefully</h2>
            </div>
            <p className="caption">
              {counts
                ? `${counts.borrowers} borrower accounts, ${counts.loans} loans, and ${counts.transactions} transactions on this device.`
                : "Your current notebook is stored on this device."}{" "}
              A backup and exact confirmation are required before clearing.
            </p>
            <button
              className="button danger"
              type="button"
              style={{ marginTop: 16 }}
              onClick={() => {
                haptic("warning", draft.haptics);
                onClear();
              }}
            >
              <Trash2 size={15} /> Clear all data
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
export default SettingsPage;
