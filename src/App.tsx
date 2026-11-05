import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Calculator,
  Check,
  ChevronRight,
  Clock3,
  Cloud,
  Home,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { Borrower, Loan, Transaction } from "./core/model";
import { installmentStatus, today } from "./core/logic";
import { db, initDB } from "./data/db";
import { startAutoBackup } from "./backup/google";
import type { DriveSyncResult } from "./backup/google";
import type { ImportPreview } from "./backup";
import type { Actions, AppData } from "./ui/types";
import { HomePage } from "./ui/HomePage";
import BorrowersPage from "./ui/BorrowersPage";
import HistoryPage from "./ui/HistoryPage";
import RemindersPage from "./ui/RemindersPage";
import { CalculatorPage } from "./ui/CalculatorPage";
import { SettingsPage } from "./ui/SettingsPage";
import {
  AddSignatureDialog,
  BorrowerForm,
  LoanForm,
  PaymentForm,
} from "./ui/forms";
import type { LoanPreset } from "./ui/forms";
import { ReceiptDialog } from "./ui/ReceiptDialog";
import { ExportDialog } from "./ui/ExportDialog";
import {
  ClearDataDialog,
  DeleteBorrowerDialog,
  ImportPreviewDialog,
} from "./ui/DangerDialogs";
import { haptic, useUI } from "./ui/store";

type Dialog =
  | { kind: "borrower"; borrower?: Borrower }
  | { kind: "loan"; preset?: LoanPreset }
  | { kind: "payment"; loanId?: string }
  | { kind: "receipt"; transaction: Transaction }
  | { kind: "export"; borrower: Borrower }
  | { kind: "delete"; borrower: Borrower }
  | { kind: "signature"; loan: Loan }
  | { kind: "clear" }
  | {
      kind: "import";
      preview: ImportPreview;
      source?: Extract<DriveSyncResult, { kind: "remote-newer" }>;
    };
const navItems = [
  { to: "/", label: "Home", icon: Home },
  { to: "/borrowers", label: "Borrowers", icon: Users },
  { to: "/calculator", label: "Calculator", icon: Calculator },
  { to: "/history", label: "History", icon: Clock3 },
  { to: "/settings", label: "Settings", icon: Settings2 },
];
function BorrowerRoute({
  data,
  actions,
  query,
  onQuery,
}: {
  data: AppData;
  actions: Actions;
  query: string;
  onQuery: (q: string) => void;
}) {
  const { id } = useParams();
  return (
    <BorrowersPage
      data={data}
      actions={actions}
      selectedId={id}
      query={query}
      onQuery={onQuery}
    />
  );
}
export default function App() {
  const nav = useNavigate(),
    location = useLocation(),
    [ready, setReady] = useState(false),
    [fatal, setFatal] = useState(""),
    [dialog, setDialog] = useState<Dialog>(),
    [query, setQuery] = useState(""),
    [quick, setQuick] = useState(false),
    [persistent, setPersistent] = useState<boolean | undefined>(),
    [dismissStorage, setDismissStorage] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const searchRef = useRef<HTMLInputElement>(null);
  const { toast, notify } = useUI();
  const close = useCallback(() => setDialog(undefined), []);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("Offline setup failed", error);
    },
  });
  useEffect(() => {
    void initDB()
      .then(() => setReady(true))
      .catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
    if (navigator.storage?.persist)
      void navigator.storage
        .persist()
        .then(setPersistent)
        .catch(() => setPersistent(false));
    const change = () => setOnline(navigator.onLine);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  const data = useLiveQuery(async () => {
    if (!ready) return undefined;
    const [borrowers, loans, transactions, notes, settings] = await Promise.all(
      [
        db.borrowers.toArray(),
        db.loans.toArray(),
        db.transactions.toArray(),
        db.notes.toArray(),
        db.settings.get("settings"),
      ],
    );
    return settings
      ? { borrowers, loans, transactions, notes, settings }
      : undefined;
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    return startAutoBackup((result) =>
      setDialog(
        (current) =>
          current || {
            kind: "import",
            preview: result.preview,
            source: result,
          },
      ),
    );
  }, [ready]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => notify(""), 7000);
    return () => clearTimeout(timer);
  }, [toast, notify]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.key === "/" &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(
            (e.target as HTMLElement).tagName,
          )) ||
        ((e.metaKey || e.ctrlKey) && e.key === "k")
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!data) return;
    const asOf = today();
    const count = data.loans
      .filter((l) => l.status === "active")
      .flatMap((l) => l.installments)
      .filter((i) =>
        ["Due today", "Mercy", "Overdue"].includes(installmentStatus(i, asOf)),
      ).length;
    const api = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count) void api.setAppBadge?.(count).catch(() => undefined);
    else void api.clearAppBadge?.().catch(() => undefined);
  }, [data]);
  if (fatal)
    return (
      <div className="screen-loading">
        <ShieldCheck size={30} />
        <h1>Your notebook needs browser storage</h1>
        <p>{fatal}</p>
        <p>Enable local storage in your browser, then reload OweMe.</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="screen-loading">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="OweMe" />
        <p>Opening your notebook…</p>
        <LoaderCircle className="spin" size={18} />
      </div>
    );
  const actions: Actions = {
    borrower: (borrower) => {
      setDialog({ kind: "borrower", borrower });
      setQuick(false);
    },
    loan: (preset) => {
      if (!data.borrowers.some((b) => b.status === "active")) {
        notify("Add a borrower first, then create their loan.");
        setDialog({ kind: "borrower" });
      } else setDialog({ kind: "loan", preset });
      setQuick(false);
    },
    payment: (loanId) => {
      if (!data.loans.some((l) => l.status === "active")) {
        notify("Create a loan before receiving a payment.");
        nav("/borrowers");
        return;
      }
      setDialog({ kind: "payment", loanId });
      setQuick(false);
    },
    receipt: (transaction) => setDialog({ kind: "receipt", transaction }),
    export: (borrower) => setDialog({ kind: "export", borrower }),
    remove: (borrower) => setDialog({ kind: "delete", borrower }),
    signature: (loan) => setDialog({ kind: "signature", loan }),
    toast: notify,
  };
  const section = location.pathname.startsWith("/borrowers")
    ? "Borrowers"
    : location.pathname.startsWith("/calculator")
      ? "Calculator"
      : location.pathname.startsWith("/history")
        ? "History"
        : location.pathname.startsWith("/settings")
          ? "Settings"
          : location.pathname.startsWith("/reminders")
            ? "Reminders"
            : "Overview";
  const asOf = today();
  const dueCount = data.loans
    .filter((l) => l.status === "active")
    .flatMap((l) => l.installments)
    .filter((i) =>
      ["Overdue", "Due today"].includes(installmentStatus(i, asOf)),
    ).length;
  const saved = (transaction: Transaction) => {
    setDialog({ kind: "receipt", transaction });
    notify(
      transaction.type === "PAYMENT"
        ? "Payment recorded. Your receipt is ready."
        : transaction.type === "ADVANCE"
          ? "Advance saved. The schedule and notes are ready."
          : "Loan released. Print or share the agreement.",
    );
    haptic("success", data.settings.haptics);
  };
  return (
    <div
      className="app-shell"
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("button,a"))
          haptic("tap", data.settings.haptics);
      }}
    >
      <aside className="sidebar">
        <NavLink className="brand" to="/">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <span>
            Owe<span style={{ color: "#5b5cff" }}>Me</span>
          </span>
        </NavLink>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navItems.slice(0, 4).map((n) => (
            <NavLink
              className="nav-link"
              key={n.to}
              to={n.to}
              end={n.to === "/"}
            >
              <n.icon />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="nav-divider" />
        <NavLink className="nav-link" to="/reminders">
          <Bell />
          <span>Reminders</span>
          {dueCount > 0 && <small className="count">{dueCount}</small>}
        </NavLink>
        <div className="sidebar-bottom">
          <NavLink className="nav-link" to="/settings">
            <Settings2 />
            <span>Settings</span>
          </NavLink>
          <button
            className="nav-link"
            style={{ width: "100%" }}
            onClick={() => nav("/settings")}
          >
            <Cloud />
            <span>Backup & Sync</span>
          </button>
          <div className="local-card">
            <ShieldCheck size={19} />
            <h3>Your data, your notebook.</h3>
            <p>
              Private, offline, and always
              <br />
              within reach. Just like it should be.
            </p>
          </div>
          <div className="user-mini">
            <span className="avatar tone-3">
              {(data.settings.defaultReceivedBy || "Me")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <div>
              <b>{data.settings.defaultReceivedBy || "My lending notebook"}</b>
              <p>Lender · Personal workspace</p>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={11} />
            <b>{section}</b>
          </div>
          <div className="top-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="Global search"
                placeholder="Find anything in your notebook…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!location.pathname.startsWith("/borrowers"))
                    nav("/borrowers");
                }}
              />
              <kbd>⌘ K</kbd>
            </div>
            <button
              className="icon-button"
              aria-label="Open reminders"
              onClick={() => nav("/reminders")}
            >
              <Bell size={18} />
              {dueCount > 0 && <i className="notification-dot" />}
            </button>
            <span className="top-avatar">
              {(data.settings.defaultReceivedBy || "ME")
                .slice(0, 2)
                .toUpperCase()}
            </span>
          </div>
        </header>
        {needRefresh && (
          <div className="sw-update">
            <span>New version available · Your data is saved locally.</span>
            <button onClick={() => void updateServiceWorker(true)}>
              Reload
              <ArrowRight size={12} />
            </button>
          </div>
        )}
        {!online && (
          <div className="sw-update">
            <span>
              Offline · Your notebook still works. Google backups resume when
              connected.
            </span>
            <Check size={14} />
          </div>
        )}
        {persistent === false && !dismissStorage && (
          <div className="persistence-banner">
            <span>
              Keep a backup handy. This browser may clear local storage to free
              space.
            </span>
            <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button onClick={() => nav("/settings")}>Save a backup</button>
              <button
                aria-label="Dismiss storage notice"
                onClick={() => setDismissStorage(true)}
              >
                <X size={13} />
              </button>
            </span>
          </div>
        )}
        <main className="content">
          <Routes>
            <Route
              path="/"
              element={<HomePage data={data} actions={actions} />}
            />
            <Route
              path="/borrowers"
              element={
                <BorrowerRoute
                  data={data}
                  actions={actions}
                  query={query}
                  onQuery={setQuery}
                />
              }
            />
            <Route
              path="/borrowers/:id"
              element={
                <BorrowerRoute
                  data={data}
                  actions={actions}
                  query={query}
                  onQuery={setQuery}
                />
              }
            />
            <Route
              path="/calculator"
              element={
                <CalculatorPage
                  borrowers={data.borrowers}
                  loans={data.loans}
                  settings={data.settings}
                  onCreate={actions.loan}
                />
              }
            />
            <Route
              path="/history"
              element={<HistoryPage data={data} actions={actions} />}
            />
            <Route
              path="/reminders"
              element={<RemindersPage data={data} actions={actions} />}
            />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  settings={data.settings}
                  onToast={notify}
                  onClear={() => setDialog({ kind: "clear" })}
                  onImport={async (preview, source) => {
                    const latest = await db.settings.get("settings");
                    const stamp = latest?.backup.pendingDriveModifiedTime;
                    setDialog({
                      kind: "import",
                      preview,
                      source:
                        source === "drive" && typeof stamp === "string"
                          ? {
                              kind: "remote-newer",
                              modifiedTime: stamp,
                              preview,
                            }
                          : undefined,
                    });
                  }}
                />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}>
            <n.icon />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <button
        className="fab"
        aria-label="Quick actions"
        aria-expanded={quick}
        onClick={() => setQuick(!quick)}
      >
        {quick ? <X size={22} /> : <Plus size={23} />}
      </button>
      {quick && (
        <div className="quick-menu">
          <button onClick={() => actions.borrower()}>New borrower</button>
          <button onClick={() => actions.loan()}>New loan</button>
          <button onClick={() => actions.loan({ advance: true })}>
            Advance loan
          </button>
          <button onClick={() => actions.payment()}>Receive payment</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => notify("")}>
            Dismiss
          </button>
        </div>
      )}
      {dialog?.kind === "borrower" && (
        <BorrowerForm
          borrower={dialog.borrower}
          borrowers={data.borrowers}
          onClose={close}
          onSaved={(b) => {
            close();
            nav(`/borrowers/${b.id}`);
            notify(
              dialog.borrower
                ? "Borrower details updated."
                : "Borrower added. Ready for their first loan.",
            );
          }}
        />
      )}
      {dialog?.kind === "loan" && (
        <LoanForm
          borrowers={data.borrowers}
          loans={data.loans}
          settings={data.settings}
          preset={dialog.preset}
          onClose={close}
          onSaved={saved}
        />
      )}{" "}
      {dialog?.kind === "payment" && (
        <PaymentForm
          borrowers={data.borrowers}
          loans={data.loans}
          settings={data.settings}
          loanId={dialog.loanId}
          onClose={close}
          onSaved={saved}
        />
      )}{" "}
      {dialog?.kind === "receipt" && (
        <ReceiptDialog
          transaction={dialog.transaction}
          loan={data.loans.find((l) => l.id === dialog.transaction.loanId)}
          settings={data.settings}
          voided={data.transactions.some(
            (t) => t.voidOf === dialog.transaction.id,
          )}
          onClose={close}
          onVoid={() =>
            notify("Transaction reversed. Original history is preserved.")
          }
          onToast={notify}
        />
      )}{" "}
      {dialog?.kind === "export" && (
        <ExportDialog
          borrower={dialog.borrower}
          loans={data.loans}
          transactions={data.transactions}
          settings={data.settings}
          onClose={close}
          onToast={notify}
        />
      )}{" "}
      {dialog?.kind === "delete" && (
        <DeleteBorrowerDialog
          borrower={dialog.borrower}
          onClose={close}
          onDeleted={() => nav("/history")}
          onToast={notify}
        />
      )}{" "}
      {dialog?.kind === "signature" && (
        <AddSignatureDialog
          loan={dialog.loan}
          onClose={close}
          onSaved={() => {
            close();
            notify("Signature saved with its original evidence.");
          }}
        />
      )}{" "}
      {dialog?.kind === "clear" && (
        <ClearDataDialog
          onClose={close}
          onCleared={() => {
            setQuery("");
            nav("/");
          }}
          onToast={notify}
        />
      )}{" "}
      {dialog?.kind === "import" && (
        <ImportPreviewDialog
          preview={dialog.preview}
          source={dialog.source}
          onClose={close}
          onImported={() => {
            setQuery("");
          }}
          onToast={notify}
        />
      )}
    </div>
  );
}
