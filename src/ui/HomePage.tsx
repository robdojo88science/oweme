import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CircleCheck,
  Clock3,
  FileSignature,
  Inbox,
  Plus,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  addDays,
  addMonthsClamped,
  borrowerNumber,
  formatMoney,
  installmentStatus,
  today,
} from "../core/logic";
import type { Borrower, Installment, Loan } from "../core/model";
import type { AppData, Actions } from "./types";
import { Avatar, Empty, Help, Money, SectionTitle } from "./primitives";
import { Status } from "./forms";
import { liveTransactions, summarize } from "./dashboard";

export interface DueRow {
  borrower: Borrower;
  loan: Loan;
  item: Installment;
  status: string;
  deletedAccount?: boolean;
}
export function dueRows(data: AppData) {
  const date = today(),
    bmap = new Map(data.borrowers.map((b) => [b.id, b]));
  return data.loans
    .filter((l) => l.status === "active")
    .flatMap((loan) =>
      loan.installments
        .filter((i) => i.amountPaid < i.amountDue && i.status !== "rolled_over")
        .map((item) => ({
          loan,
          item,
          status: installmentStatus(item, date),
          deletedAccount: !bmap.has(loan.borrowerId),
          borrower:
            bmap.get(loan.borrowerId) ||
            ({
              ...loan.borrowerSnapshot,
              id: loan.borrowerId,
              address: "Anonymized account",
              monthlyIncome: 0,
              status: "archived",
              createdAt: loan.createdAt,
              updatedAt: loan.updatedAt,
            } as Borrower),
        })),
    )
    .sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate));
}
export function ReminderRow({
  row,
  actions,
  prefix = "",
}: {
  row: DueRow;
  actions: Actions;
  prefix?: string;
}) {
  const nav = useNavigate();
  return (
    <div className="reminder-row">
      <button
        className="person"
        onClick={() =>
          nav(row.deletedAccount ? "/history" : `/borrowers/${row.borrower.id}`)
        }
        title="Open borrower account"
      >
        <Avatar borrower={row.borrower} />
        <div>
          <b>{row.borrower.fullName}</b>
          <p>
            #{borrowerNumber(row.borrower.numericId, prefix)} ·{" "}
            {row.item.dueDate}
          </p>
        </div>
      </button>
      <Money amount={row.item.amountDue - row.item.amountPaid} />
      <span className="status-cell">
        <Status status={row.status} />
      </span>
      <button
        className="receive-small"
        onClick={() => actions.payment(row.loan.id)}
      >
        Receive
      </button>
    </div>
  );
}

export function HomePage({
  data,
  actions,
}: {
  data: AppData;
  actions: Actions;
}) {
  const nav = useNavigate(),
    [tab, setTab] = useState("Due today"),
    [range, setRange] = useState("This month");
  const date = today(),
    start =
      range === "This month"
        ? `${date.slice(0, 7)}-01`
        : range === "Last 30 days"
          ? addDays(date, -29)
          : "0000-01-01";
  const metrics = summarize(data, start, date, date);
  const rows = useMemo(() => dueRows(data), [data]);
  const tabs = ["Due today", "Next 7 days", "Past due", "Courtesy"];
  const groups = [
    rows.filter((r) => r.item.dueDate === date),
    rows.filter(
      (r) => r.item.dueDate > date && r.item.dueDate <= addDays(date, 7),
    ),
    rows.filter((r) => r.item.dueDate < date),
    rows.filter((r) => r.item.dueDate < date && date <= r.item.graceUntil),
  ];
  const selected = groups[tabs.indexOf(tab)];
  const unsigned = data.loans.filter(
    (l) =>
      l.status === "active" && !l.signatures.borrower && !l.documents?.length,
  ).length;
  const valid = liveTransactions(data.transactions);
  const chart = Array.from({ length: 6 }, (_, i) => {
    const d = addMonthsClamped(date, -5 + i),
      m = d.slice(0, 7);
    return {
      label: new Intl.DateTimeFormat("en", {
        month: "short",
        timeZone: "UTC",
      }).format(new Date(`${d}T00:00:00Z`)),
      collected: valid
        .filter((t) => t.type === "PAYMENT" && t.date.startsWith(m))
        .reduce((s, t) => s + t.amount, 0),
      released: valid
        .filter(
          (t) =>
            ["RELEASE", "ADVANCE"].includes(t.type) && t.date.startsWith(m),
        )
        .reduce((s, t) => s + t.amount, 0),
    };
  });
  const max = Math.max(
    ...chart.flatMap((c) => [c.collected, c.released]),
    10000,
  );
  const recent = [...data.transactions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  const needsBackup =
    !data.settings.backup.lastSuccess ||
    Boolean(data.settings.backup.lastError);
  const attention = [
    ...(metrics.overdue
      ? [
          {
            icon: Clock3,
            tone: "red",
            title: `${groups[2].length} past-due installments`,
            detail: `${formatMoney(metrics.overdue)} remaining · courtesy does not change due dates`,
            to: "/reminders",
          },
        ]
      : []),
    ...(groups[0].length
      ? [
          {
            icon: CalendarDays,
            tone: "amber",
            title: `${groups[0].length} installments due today`,
            detail: `${formatMoney(metrics.dueToday)} expected today`,
            to: "/reminders",
          },
        ]
      : []),
    ...(unsigned
      ? [
          {
            icon: FileSignature,
            tone: "purple",
            title: `${unsigned} agreements awaiting signatures`,
            detail: "Capture the signed paper for each loan",
            to: "/documents",
          },
        ]
      : []),
    ...(needsBackup
      ? [
          {
            icon: ShieldCheck,
            tone: "amber",
            title: data.settings.backup.lastError
              ? "Backup needs attention"
              : "Keep a recovery copy",
            detail: data.settings.backup.lastError
              ? "Review the backup error and retry"
              : "Save your notebook outside this browser",
            to: "/backups",
          },
        ]
      : []),
    ...(groups[1].length
      ? [
          {
            icon: CalendarDays,
            tone: "purple",
            title: `${groups[1].length} installments coming up`,
            detail: `${formatMoney(metrics.upcoming)} in the next 7 days`,
            to: "/reminders",
          },
        ]
      : []),
  ].slice(0, 4);
  return (
    <div className="home-page">
      <div className="page-heading home-heading">
        <div>
          <span className="eyebrow">YOUR LENDING NOTEBOOK</span>
          <h1>A little clarity. A lot of peace of mind.</h1>
          <p>Everything you need to keep your lending in balance.</p>
        </div>
        <div className="heading-actions">
          <button className="button" onClick={() => actions.borrower()}>
            <Plus size={16} />
            Add borrower
          </button>
          <button className="button primary" onClick={() => actions.loan()}>
            <Plus size={16} />
            New loan
          </button>
        </div>
      </div>
      <div className="subheader">
        <span className="date-pill">
          <CalendarDays size={15} />
          {new Intl.DateTimeFormat("en-PH", {
            weekday: "short",
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "Asia/Manila",
          }).format(new Date(`${date}T04:00:00Z`))}
        </span>
        <label className="range-control">
          <span>Cash activity</span>
          <select
            aria-label="Dashboard time range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {["This month", "Last 30 days", "All time"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="overview-grid">
        <section className="portfolio-card">
          <div className="portfolio-top">
            <span className="portfolio-icon">
              <Wallet size={20} />
            </span>
            <span className="status purple">
              <span className="dot" />
              Saved on this device
            </span>
          </div>
          <div className="portfolio-label">
            Outstanding repayments <Help topic="balance" />
          </div>
          <div className="portfolio-amount">
            <Money amount={metrics.outstanding} />
          </div>
          <p className="portfolio-caption">
            The remaining amount borrowers have agreed to repay.
          </p>
          <div className="portfolio-bottom">
            <div>
              <small>Cash released on open loans</small>
              <b>
                <Money amount={metrics.openCash} />
              </b>
            </div>
            <div>
              <small>Active loans</small>
              <b>
                {metrics.activeLoans}
                <span> / {metrics.activeBorrowers} borrowers</span>
              </b>
            </div>
            <button
              className="icon-button"
              aria-label="View borrower accounts"
              onClick={() => nav("/borrowers")}
            >
              <ArrowUpRight size={20} />
            </button>
          </div>
        </section>
        <section className="panel attention-panel">
          <SectionTitle
            title="Needs attention"
            action="View reminders"
            onClick={() => nav("/reminders")}
          />
          {attention.length ? (
            attention.map((a) => (
              <button
                key={a.title}
                className="attention-row"
                onClick={() => nav(a.to)}
              >
                <span className={`attention-icon ${a.tone}`}>
                  <a.icon size={17} />
                </span>
                <span>
                  <b>{a.title}</b>
                  <small>{a.detail}</small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))
          ) : (
            <Empty
              icon={<CircleCheck />}
              title="Everything is in order"
              body="We'll surface due dates and tasks here as they come up."
            />
          )}
        </section>
      </div>
      <div className="home-stats">
        {[
          {
            label: "Cash collected",
            value: metrics.collected,
            icon: ArrowDownLeft,
            tone: "emerald",
            foot: "Repayments received",
            help: "collected",
          },
          {
            label: "Cash released",
            value: metrics.released,
            icon: ArrowUpRight,
            tone: "purple",
            foot: "Actual money handed over",
            help: "released",
          },
          {
            label: "Finance charges earned",
            value: metrics.charges,
            icon: TrendingUp,
            tone: "purple",
            foot: "Proportional to repayments",
            help: "interest",
          },
          {
            label: "Past-due obligations",
            value: metrics.overdue,
            icon: Clock3,
            tone: "red",
            foot: "Includes the courtesy window",
            help: "mercy",
          },
        ].map((k) => (
          <section className={`panel home-stat ${k.tone}`} key={k.label}>
            <div>
              <span className="stat-icon">
                <k.icon size={17} />
              </span>
              <span>{k.label}</span>
              <Help
                topic={
                  k.help as "collected" | "released" | "interest" | "mercy"
                }
              />
            </div>
            <Money amount={k.value} />
            <p>{k.foot}</p>
          </section>
        ))}
      </div>
      <div className="quick-action-strip">
        <span>Quick actions</span>
        <button onClick={() => actions.payment()}>
          <ArrowDownLeft size={16} />
          Record payment
        </button>
        <button onClick={() => nav("/calculator")}>
          <Wallet size={16} />
          Try calculator
        </button>
        <button
          onClick={() =>
            document
              .querySelector<HTMLInputElement>('[aria-label="Global search"]')
              ?.focus()
          }
        >
          <Search size={16} />
          Search records
        </button>
        <button onClick={() => nav("/reports")}>
          <TrendingUp size={16} />
          View reports
          <ArrowRight size={13} />
        </button>
      </div>
      <div className="dashboard-bottom">
        <section className="panel table-panel">
          <div className="panel-head">
            <SectionTitle
              title="Your collection schedule"
              action="View all"
              onClick={() => nav("/reminders")}
            />
          </div>
          <div className="tabs" role="tablist" aria-label="Collection schedule">
            {tabs.map((t, i) => (
              <button
                role="tab"
                aria-selected={tab === t}
                className={`tab ${tab === t ? "active" : ""}`}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
                <span className="count">{groups[i].length}</span>
              </button>
            ))}
          </div>
          <div className="table-head">
            <span>BORROWER / DUE DATE</span>
            <span>REMAINING</span>
            <span>STATUS</span>
            <span>ACTION</span>
          </div>
          {selected.length ? (
            selected
              .slice(0, 5)
              .map((r) => (
                <ReminderRow
                  key={`${r.loan.id}-${r.item.no}`}
                  row={r}
                  actions={actions}
                  prefix={data.settings.borrowerPrefix}
                />
              ))
          ) : (
            <Empty
              icon={<CalendarDays />}
              title={
                tab === "Past due"
                  ? "No past-due installments"
                  : "A clear schedule ahead"
              }
              body={
                data.loans.length
                  ? "There are no unpaid installments in this group."
                  : "Add a borrower and release a loan. Your upcoming collections will appear here."
              }
              action={
                !data.borrowers.length ? (
                  <button
                    className="button small"
                    onClick={() => actions.borrower()}
                  >
                    <Plus size={14} />
                    Add your first borrower
                  </button>
                ) : undefined
              }
            />
          )}
          <div className="table-footer">
            <span>Contractual due dates · Asia/Manila</span>
            <span>
              <Check size={12} />
              Checked when you open OweMe
            </span>
          </div>
        </section>
        <section className="panel chart-panel">
          <SectionTitle
            title="Cash in, cash out"
            action="Reports"
            onClick={() => nav("/reports")}
          />
          <div className="chart-key">
            <span>
              <i />
              Collected
            </span>
            <span>
              <i className="release" />
              Released
            </span>
            <small>Last 6 months</small>
          </div>
          <div
            className="chart"
            role="img"
            aria-label={chart
              .map(
                (c) =>
                  `${c.label}: collected ${formatMoney(c.collected)}, released ${formatMoney(c.released)}`,
              )
              .join(". ")}
          >
            <div className="chart-y">
              {[1, 0.75, 0.5, 0.25, 0].map((n) => (
                <span key={n}>
                  ₱{Math.round((max * n) / 100).toLocaleString("en-PH")}
                </span>
              ))}
            </div>
            <div className="chart-body">
              <div className="chart-grid">
                {[1, 2, 3, 4, 5].map((i) => (
                  <i key={i} />
                ))}
              </div>
              <div className="chart-bars">
                {chart.map((c) => (
                  <div
                    className="bar-group"
                    key={c.label}
                    title={`${c.label}: ${formatMoney(c.collected)} collected, ${formatMoney(c.released)} released`}
                  >
                    <i
                      style={{
                        height: `${(c.collected / max) * 85}%`,
                        minHeight: c.collected ? 2 : 0,
                      }}
                    />
                    <i
                      className="release"
                      style={{
                        height: `${(c.released / max) * 85}%`,
                        minHeight: c.released ? 2 : 0,
                      }}
                    />
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-note">
            <ShieldCheck size={14} />
            <span>
              Collections include repayments of the face amount. They are not
              all profit.
            </span>
          </div>
        </section>
      </div>
      <section className="panel home-recent">
        <SectionTitle
          title="Recent activity"
          action="Full activity"
          onClick={() => nav("/activity")}
        />
        {recent.length ? (
          <div className="recent-grid">
            {recent.map((t) => (
              <button
                className="recent-entry"
                key={t.id}
                onClick={() => actions.receipt(t)}
              >
                <span
                  className={`attention-icon ${t.type === "PAYMENT" ? "emerald" : "purple"}`}
                >
                  {t.type === "PAYMENT" ? (
                    <ArrowDownLeft size={16} />
                  ) : (
                    <ArrowUpRight size={16} />
                  )}
                </span>
                <span>
                  <b>
                    {t.type === "PAYMENT"
                      ? "Payment received"
                      : t.type === "VOID"
                        ? "Transaction reversed"
                        : "Cash released"}
                  </b>
                  <small>
                    {t.borrowerSnapshot.fullName} · {t.date}
                  </small>
                </span>
                <Money amount={t.amount} />
              </button>
            ))}
          </div>
        ) : (
          <div className="recent-empty">
            <Inbox size={20} />
            <span>Your releases, payments, and updates will appear here.</span>
          </div>
        )}
      </section>
      <footer className="page-foot">
        <span>
          <ShieldCheck size={12} />
          Private on your device. Ready when you're offline.
        </span>
        <span>
          Made for your everyday lending <Users size={12} />
        </span>
      </footer>
    </div>
  );
}
