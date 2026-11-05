import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  Clock3,
  Inbox,
  Landmark,
  Plus,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  addDays,
  addMonthsClamped,
  balance,
  borrowerNumber,
  formatMoney,
  installmentStatus,
  today,
} from "../core/logic";
import type { Borrower, Installment, Loan } from "../core/model";
import type { AppData, Actions } from "./types";
import { Avatar, Empty, Help, Money, SectionTitle } from "./primitives";
import { Status } from "./forms";
export interface DueRow {
  borrower: Borrower;
  loan: Loan;
  item: Installment;
  status: string;
  deletedAccount?: boolean;
}
export function dueRows(data: AppData) {
  const asOf = today();
  const bmap = new Map(data.borrowers.map((b) => [b.id, b]));
  return data.loans
    .filter((l) => l.status === "active")
    .flatMap((loan) =>
      loan.installments
        .filter((i) => i.amountPaid < i.amountDue && i.status !== "rolled_over")
        .map((item) => ({
          loan,
          item,
          status: installmentStatus(item, asOf),
          deletedAccount: !bmap.has(loan.borrowerId),
          borrower:
            bmap.get(loan.borrowerId) ||
            ({
              ...loan.borrowerSnapshot,
              id: loan.borrowerId,
              address: "Deleted account",
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
        title={
          row.deletedAccount
            ? "Open permanent history for this deleted account"
            : "Open borrower account"
        }
      >
        <Avatar borrower={row.borrower} />
        <div>
          <b>{row.borrower.fullName}</b>
          <p>
            #{borrowerNumber(row.borrower.numericId, prefix)} ·{" "}
            {row.item.dueDate}
            {row.deletedAccount && " · Deleted account"}
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
    [tab, setTab] = useState("Due today");
  const date = today(),
    month = date.slice(0, 7);
  const voided = new Set(
    data.transactions.filter((t) => t.type === "VOID").map((t) => t.voidOf),
  );
  const valid = data.transactions.filter(
    (t) => t.type !== "VOID" && !voided.has(t.id),
  );
  const outstanding = data.loans.reduce((s, l) => s + balance(l), 0),
    collected = valid
      .filter((t) => t.type === "PAYMENT" && t.date.startsWith(month))
      .reduce((s, t) => s + t.amount, 0),
    released = valid
      .filter(
        (t) =>
          ["RELEASE", "ADVANCE"].includes(t.type) && t.date.startsWith(month),
      )
      .reduce((s, t) => s + t.amount, 0);
  const lmap = new Map(data.loans.map((l) => [l.id, l]));
  const interest = valid
      .filter(
        (t) =>
          ["RELEASE", "ADVANCE"].includes(t.type) && t.date.startsWith(month),
      )
      .reduce(
        (s, t) =>
          s + (t.advance?.interest ?? lmap.get(t.loanId)?.interestAmount ?? 0),
        0,
      ),
    active = data.loans.filter((l) => l.status === "active").length;
  const rows = useMemo(() => dueRows(data), [data]);
  const tabs = ["Due today", "Next 7 days", "Mercy", "Overdue"];
  const groups = tabs.map((t) =>
    rows.filter((r) =>
      t === "Due today"
        ? r.item.dueDate === date
        : t === "Next 7 days"
          ? r.item.dueDate > date && r.item.dueDate <= addDays(date, 7)
          : r.status === t,
    ),
  );
  const selected = groups[tabs.indexOf(tab)];
  const chart = Array.from({ length: 6 }, (_, i) => {
    const d = addMonthsClamped(date, -5 + i),
      m = d.slice(0, 7);
    return {
      label: new Intl.DateTimeFormat("en", {
        month: "short",
        timeZone: "UTC",
      }).format(new Date(d + "T00:00:00Z")),
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
    ...chart.flatMap((d) => [d.collected, d.released]),
    100000,
  );
  const recent = [...data.transactions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Your lending, in balance<span style={{ color: "#c4c1e8" }}>.</span>
          </h1>
          <p>A little more clarity. A little less paperwork.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button desktop-only"
            onClick={() => actions.borrower()}
          >
            <Plus size={15} />
            Add borrower
          </button>
          <button className="button primary" onClick={() => actions.payment()}>
            <ArrowDownLeft size={15} />
            Receive payment
          </button>
        </div>
      </div>
      <div className="subheader">
        <span className="date-pill">
          <CalendarDays size={13} />
          {new Intl.DateTimeFormat("en-PH", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "Asia/Manila",
          }).format(new Date())}
          <ChevronDown size={12} />
        </span>
        <button className="backup-chip" onClick={() => nav("/settings")}>
          <span
            className="dot"
            style={{
              color: data.settings.backup.lastError
                ? "#cf737a"
                : data.settings.backup.lastSuccess
                  ? "#70ae90"
                  : "#c5b685",
            }}
          />
          {data.settings.backup.lastError
            ? "Backup needs attention ? Retry"
            : data.settings.backup.lastSuccess
              ? `Backup saved ${new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(data.settings.backup.lastSuccess))}`
              : "Your notebook is local · Save a backup"}
          <ArrowUpRight size={11} />
        </button>
      </div>
      <div className="kpi-grid">
        {(
          [
            {
              label: "Outstanding balance",
              amount: outstanding,
              topic: "balance",
              icon: <Wallet />,
              foot: "Across your active loans",
            },
            {
              label: "Collected this month",
              amount: collected,
              topic: "collected",
              icon: <ArrowDownLeft />,
              foot: "Every payment accounted for",
              green: true,
            },
            {
              label: "Released this month",
              amount: released,
              topic: "released",
              icon: <ArrowUpRight />,
              foot: "Cash put into your community",
            },
            {
              label: "Interest earned",
              amount: interest,
              topic: "interest",
              icon: <TrendingUp />,
              foot: "From this month’s releases",
            },
            {
              label: "Active loans",
              amount: active,
              topic: "balance",
              icon: <Landmark />,
              foot: `${data.borrowers.filter((b) => b.status === "active").length} borrowers in your notebook`,
              count: true,
            },
          ] as const
        ).map((k) => (
          <div className="kpi" key={k.label}>
            <div className="kpi-label">
              {k.label}
              <Help topic={k.topic} />
              <span className="kpi-icon">{k.icon}</span>
            </div>
            <span className="kpi-value">
              {"count" in k ? k.amount : <Money amount={k.amount} />}
            </span>
            <p className={`kpi-foot ${"green" in k ? "green" : ""}`}>
              {"green" in k && <CircleCheck size={10} />} {k.foot}
            </p>
          </div>
        ))}
      </div>
      <div className="dashboard-top">
        <div className="balance-hero">
          <span className="eyebrow">
            <Wallet size={14} />
            YOUR MONEY AT WORK
          </span>
          <div className="hero-amount">
            <Money amount={outstanding} />
          </div>
          <p className="hero-sub">
            Total outstanding balance <Help topic="balance" />
          </p>
          <div className="hero-footer">
            <div>
              <b>
                {active} active {active === 1 ? "loan" : "loans"} ·{" "}
                {data.borrowers.length}{" "}
                {data.borrowers.length === 1 ? "borrower" : "borrowers"}
              </b>
              <p>Small loans. Stronger communities.</p>
            </div>
            <button className="button" onClick={() => nav("/borrowers")}>
              View accounts
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
        <div className="panel chart-panel">
          <div className="section-title">
            <div>
              <h2>Cash flow</h2>
              <p>The rhythm of your lending notebook</p>
            </div>
            <div className="chart-key">
              <span>
                <i />
                Collected
              </span>
              <span>
                <i className="release" />
                Released
              </span>
            </div>
          </div>
          <div className="chart-total" style={{ marginBottom: 20 }}>
            <strong>
              <Money amount={collected} />
            </strong>
            <small>collected this month</small>
          </div>
          <div
            className="chart"
            role="img"
            aria-label={`Six-month cash flow. This month collected ${formatMoney(collected)}, released ${formatMoney(released)}.`}
          >
            <div className="chart-y">
              {[1, 0.75, 0.5, 0.25, 0].map((n) => (
                <span key={n}>
                  {n
                    ? `₱${Math.round((max * n) / 100).toLocaleString("en")}`
                    : "₱0"}
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
                    title={`${c.label}: collected ${formatMoney(c.collected)}, released ${formatMoney(c.released)}`}
                  >
                    <i style={{ height: `${(c.collected / max) * 85}%` }} />
                    <i
                      className="release"
                      style={{ height: `${(c.released / max) * 85}%` }}
                    />
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="dashboard-bottom">
        <div className="panel table-panel">
          <div className="panel-head">
            <SectionTitle
              title="A gentle nudge, right on time"
              action="All reminders"
              onClick={() => nav("/reminders")}
            />
          </div>
          <div className="tabs">
            {tabs.map((t, i) => (
              <button
                className={`tab ${tab === t ? "active" : ""}`}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
                {groups[i].length > 0 && (
                  <span className="count">{groups[i].length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="table-head">
            <span>BORROWER</span>
            <span>AMOUNT DUE</span>
            <span>STATUS</span>
            <span>ACTION</span>
          </div>
          {selected.length ? (
            selected
              .slice(0, 5)
              .map((r) => (
                <ReminderRow
                  key={r.loan.id + "-" + r.item.no}
                  row={r}
                  actions={actions}
                  prefix={data.settings.borrowerPrefix}
                />
              ))
          ) : (
            <Empty
              icon={<CircleCheck />}
              title={
                tab === "Overdue"
                  ? "No overdue payments"
                  : "You’re all caught up"
              }
              body={
                data.borrowers.length
                  ? "No installments in this group. Your upcoming dues will appear here."
                  : "Add your first borrower and loan. We’ll keep an eye on the dates."
              }
              action={
                !data.borrowers.length ? (
                  <button
                    className="button small"
                    onClick={() => actions.borrower()}
                  >
                    <Plus size={13} />
                    Add your first borrower
                  </button>
                ) : undefined
              }
            />
          )}
          <div className="table-footer">
            <span>
              {selected.length}{" "}
              {selected.length === 1 ? "installment" : "installments"} · checked
              when you open OweMe
            </span>
            <ShieldCheck size={12} />
          </div>
        </div>
        <div className="panel activity-panel">
          <SectionTitle
            title="Recent activity"
            action="View all"
            onClick={() => nav("/history")}
          />
          <div className="activity-list">
            {recent.length ? (
              recent.map((t) => (
                <button
                  className="activity-item"
                  key={t.id}
                  onClick={() => actions.receipt(t)}
                  style={{ width: "100%", textAlign: "left" }}
                >
                  <span
                    className={`activity-icon ${t.type === "PAYMENT" ? "" : t.type === "VOID" ? "void" : "out"}`}
                  >
                    {t.type === "PAYMENT" ? (
                      <ArrowDownLeft size={15} />
                    ) : t.type === "VOID" ? (
                      <Clock3 size={15} />
                    ) : (
                      <ArrowUpRight size={15} />
                    )}
                  </span>
                  <span className="activity-content">
                    <b>
                      {t.type === "PAYMENT"
                        ? "Payment received"
                        : t.type === "ADVANCE"
                          ? "Advance released"
                          : t.type === "VOID"
                            ? "Transaction voided"
                            : "Loan released"}
                    </b>
                    <p>
                      {t.borrowerSnapshot.fullName} · #
                      {borrowerNumber(t.borrowerSnapshot.numericId)}
                    </p>
                  </span>
                  <span
                    className={`activity-money ${t.type !== "PAYMENT" ? "out" : ""}`}
                  >
                    <Money amount={t.amount} />
                    <time>{t.date.slice(5)}</time>
                  </span>
                </button>
              ))
            ) : (
              <Empty
                icon={<Inbox />}
                title="Your story starts here"
                body="Releases, payments, and advances will form a clear timeline."
              />
            )}
          </div>
          <div className="tip-card">
            <Sparkles size={15} />
            <div>
              <b>A notebook you can count on</b>Your records stay on this device
              and work offline. A regular backup keeps them safe.
            </div>
          </div>
        </div>
      </div>
      <div className="page-foot">
        <span>
          <ShieldCheck size={11} />
          Private by design. Stored on your device.
        </span>
        <span>
          Made for your community <span style={{ color: "#aaa4d7" }}>✦</span>{" "}
          OweMe
        </span>
      </div>
      {!data.borrowers.length && (
        <div
          className="dashboard-quick"
          style={{ display: "flex", gap: 10, marginTop: 25 }}
        >
          <button className="text-button" onClick={() => actions.borrower()}>
            <Users size={14} />
            Start your borrower notebook
            <ArrowRight size={13} />
          </button>
          <button className="text-button" onClick={() => nav("/calculator")}>
            <Banknote size={14} />
            Try the loan calculator
          </button>
        </div>
      )}
    </>
  );
}
