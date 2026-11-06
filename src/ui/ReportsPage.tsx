import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Download,
  FileText,
  Info,
} from "lucide-react";
import type { Actions, AppData } from "./types";
import { formatMoney, today } from "../core/logic";
import { Money } from "./primitives";
import { Field } from "./forms";
import { downloadFile, reportPDF } from "../exports";
import { summarize } from "./dashboard";
import { csvRows, reportBreakdown } from "./reporting";

export default function ReportsPage({
  data,
  actions,
}: {
  data: AppData;
  actions: Actions;
}) {
  const asOf = today();
  const [from, setFrom] = useState(`${asOf.slice(0, 7)}-01`);
  const [to, setTo] = useState(asOf);
  const [busy, setBusy] = useState(false);
  const invalid = Boolean(from && to && from > to);
  const start = from || "0000-01-01",
    end = to || "9999-12-31";
  const summary = summarize(data, start, end, asOf);
  const detail = reportBreakdown(data, start, end, asOf);
  const metrics: [string, string][] = [
    ["Cash collected in range", formatMoney(summary.collected)],
    ["Actual cash released in range", formatMoney(summary.released)],
    ["Net cash flow in range", formatMoney(summary.cashFlow)],
    ["Recognized finance charges in range", formatMoney(summary.charges)],
    ["Scheduled collections in range", formatMoney(summary.expected)],
    ["Reversals recorded in range", formatMoney(summary.reversalTotal)],
    ["Unapplied credit received in range", formatMoney(detail.unappliedCredit)],
    ["Current face value of active loans", formatMoney(summary.activeFace)],
    [
      "Current outstanding repayment obligations",
      formatMoney(summary.outstanding),
    ],
    ["Current overdue obligations", formatMoney(summary.overdue)],
    ["Current active loans", String(summary.activeLoans)],
    ["Current active borrowers", String(summary.activeBorrowers)],
    ["Current delinquent borrowers", String(detail.delinquentBorrowers)],
    ["Loans settled in range", String(detail.settledLoans)],
  ];
  const recognition =
    "Finance charges are recognized proportionally to applied repayments, with cumulative centavo rounding. Merged advances carry the prior loan's unrecognized charge into the new recognition basis without charging it again. Unapplied credit is excluded. Collections and cash flow are not profit; expenses and tax are not tracked.";
  const restatement =
    "Reversed original entries are excluded from cash totals, including when reversed after the selected range. Reversal totals show correction entries dated in range. Current balances and aging are as of today; scheduled collections follow contractual due dates.";
  const exportCSV = () => {
    const rows: (string | number)[][] = [
      [
        "OweMe private financial report",
        `${from || "All history"} to ${to || "present"}`,
      ],
      ["Current balance date", asOf],
      ["Metric", "Value"],
      ...metrics,
      [],
      [recognition],
      [restatement],
      [],
      [
        "Transaction",
        "Date",
        "Borrower",
        "Loan",
        "Type",
        "Method",
        "Reference",
        "Amount PHP",
        "Unapplied credit PHP",
      ],
    ];
    const loans = new Map(data.loans.map((l) => [l.id, l.loanNo]));
    rows.push(
      ...detail.transactions.map((t) => [
        t.txnNo,
        t.date,
        t.borrowerSnapshot.fullName,
        loans.get(t.loanId) || t.loanId,
        t.type,
        t.method || "cash",
        t.referenceNo || "",
        (t.amount / 100).toFixed(2),
        ((t.unappliedAmount || 0) / 100).toFixed(2),
      ]),
    );
    downloadFile(
      new Blob(["\ufeff", csvRows(rows)], { type: "text/csv;charset=utf-8" }),
      `OweMe-report-${asOf}.csv`,
    );
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>A clearer view of your money.</h1>
          <p>Collections, obligations and the numbers behind your notebook.</p>
        </div>
        <div className="heading-actions">
          <button className="button" disabled={invalid} onClick={exportCSV}>
            <Download size={15} />
            CSV
          </button>
          <button
            className="button primary"
            disabled={busy || invalid}
            onClick={() => {
              setBusy(true);
              void reportPDF(data.settings, {
                from,
                to,
                asOf,
                metrics,
                channels: detail.channels.map((c) => [
                  c.label,
                  formatMoney(c.amount),
                ]),
                aging: detail.aging.map((a) => [
                  a.label,
                  formatMoney(a.amount),
                ]),
                notes: [recognition, restatement],
              })
                .then((file) => downloadFile(file))
                .catch((error) =>
                  actions.toast(
                    error instanceof Error
                      ? error.message
                      : "Report export failed.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <FileText size={15} />
            {busy ? "Preparing…" : "Export PDF"}
          </button>
        </div>
      </div>
      <div className="panel report-controls">
        <div className="segmented">
          {[
            ["This month", `${asOf.slice(0, 7)}-01`],
            ["This year", `${asOf.slice(0, 4)}-01-01`],
            ["All history", ""],
          ].map(([label, value]) => (
            <button
              key={label}
              className={from === value && to === asOf ? "active" : ""}
              onClick={() => {
                setFrom(value);
                setTo(asOf);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label="From date">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To date">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {invalid && (
        <div className="alert error" role="alert">
          Choose an end date on or after the start date.
        </div>
      )}
      <div className="report-metrics">
        {[
          {
            label: "Cash collected",
            value: summary.collected,
            foot: "Repayments received in range",
            icon: ArrowDownLeft,
            tone: "green",
          },
          {
            label: "Cash released",
            value: summary.released,
            foot: "Money actually handed out",
            icon: ArrowUpRight,
            tone: "purple",
          },
          {
            label: "Net cash flow",
            value: summary.cashFlow,
            foot: "Collections less cash releases",
            icon: BarChart3,
            tone: "purple",
          },
          {
            label: "Finance charges recognized",
            value: summary.charges,
            foot: "Pro rata applied repayments",
            icon: FileText,
            tone: "amber",
          },
        ].map(({ label, value, foot, icon: Icon, tone }) => (
          <section className="panel report-metric" key={label}>
            <span className={`more-icon ${tone}`}>
              <Icon size={18} />
            </span>
            <p>{label}</p>
            <Money amount={value} />
            <small>{foot}</small>
          </section>
        ))}
      </div>
      <div className="report-grid">
        <section className="panel report-section">
          <div className="section-title">
            <h2>Portfolio today</h2>
            <span className="caption">{asOf}</span>
          </div>
          <dl className="report-stats">
            {[
              ["Outstanding repayment obligations", summary.outstanding],
              ["Face value of active loans", summary.activeFace],
              ["Cash released on open loans", summary.openCash],
              ["Overdue contractual obligations", summary.overdue],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>
                  <Money amount={Number(value)} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="report-summary">
            <span>
              <b>{summary.activeLoans}</b> active loans
            </span>
            <span>
              <b>{summary.activeBorrowers}</b> active borrowers
            </span>
            <span>
              <b>{detail.delinquentBorrowers}</b> past due borrowers
            </span>
          </div>
        </section>
        <section className="panel report-section">
          <div className="section-title">
            <h2>Collections by channel</h2>
            <span className="caption">Selected range</span>
          </div>
          {detail.channels.length ? (
            detail.channels.map((channel) => (
              <div className="report-bar-row" key={channel.label}>
                <div>
                  <span>{channel.label}</span>
                  <Money amount={channel.amount} />
                </div>
                <div className="report-bar">
                  <i
                    style={{
                      width: `${summary.collected ? (channel.amount / summary.collected) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <div className="report-quiet">
              <BarChart3 size={24} />
              <p>Recorded payments will build this view.</p>
            </div>
          )}
        </section>
        <section className="panel report-section">
          <div className="section-title">
            <h2>Overdue aging</h2>
            <span className="caption">Contractual dates · today</span>
          </div>
          {detail.aging.map((bucket) => (
            <div className="report-bar-row" key={bucket.label}>
              <div>
                <span>{bucket.label}</span>
                <Money amount={bucket.amount} />
              </div>
              <div className="report-bar amber">
                <i
                  style={{
                    width: `${summary.overdue ? (bucket.amount / summary.overdue) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </section>
        <section className="panel report-section">
          <div className="section-title">
            <h2>Period details</h2>
          </div>
          <dl className="report-stats">
            <div>
              <dt>Scheduled collections</dt>
              <dd>
                <Money amount={summary.expected} />
              </dd>
            </div>
            <div>
              <dt>Reversals recorded</dt>
              <dd>
                <Money amount={summary.reversalTotal} />
              </dd>
            </div>
            <div>
              <dt>Unapplied credit received</dt>
              <dd>
                <Money amount={detail.unappliedCredit} />
              </dd>
            </div>
            <div>
              <dt>Loans fully settled</dt>
              <dd>{detail.settledLoans}</dd>
            </div>
          </dl>
          <p className="caption">
            Archived borrowers remain included in history. Courtesy days do not
            move contractual dates.
          </p>
        </section>
      </div>
      <details className="report-definitions">
        <summary>
          <Info size={14} />
          How these numbers are calculated
        </summary>
        <p>{recognition}</p>
        <p>{restatement}</p>
        <p>
          These private owner reports include personal borrower information in
          detailed CSV exports. Review the file before sharing.
        </p>
      </details>
    </>
  );
}
