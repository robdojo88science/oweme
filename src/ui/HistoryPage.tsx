import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import type { AppData, Actions } from "./types";
import { borrowerNumber } from "../core/logic";
import { Empty, Money } from "./primitives";
import { Field, Status } from "./forms";
export default function HistoryPage({
  data,
  actions,
}: {
  data: AppData;
  actions: Actions;
}) {
  const [query, setQuery] = useState(""),
    [type, setType] = useState("All types"),
    [method, setMethod] = useState("All methods"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [bid, setBid] = useState(""),
    [showVoided, setShowVoided] = useState(true),
    [limit, setLimit] = useState(60);
  const voided = useMemo(
    () =>
      new Set(
        data.transactions.filter((t) => t.type === "VOID").map((t) => t.voidOf),
      ),
    [data.transactions],
  );
  const borrowerIds = new Set(data.borrowers.map((b) => b.id));
  const loanMap = new Map(data.loans.map((l) => [l.id, l]));
  const filtered = useMemo(
    () =>
      data.transactions
        .filter(
          (t) =>
            (!query ||
              [
                t.txnNo,
                t.borrowerSnapshot.fullName,
                String(t.borrowerSnapshot.numericId),
                t.referenceNo || "",
                t.notes || "",
              ]
                .join(" ")
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (type === "All types" || t.type === type) &&
            (method === "All methods" || t.method === method) &&
            (!from || t.date >= from) &&
            (!to || t.date <= to) &&
            (!bid || t.borrowerId === bid) &&
            (showVoided || !voided.has(t.id)),
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    [data.transactions, query, type, method, from, to, bid, showVoided, voided],
  );
  const valid = filtered.filter((t) => !voided.has(t.id) && t.type !== "VOID");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Transactions</h1>
          <p>Every release, repayment and correction. Clearly recorded.</p>
        </div>
        <span className="status">Permanent ledger</span>
      </div>
      <div className="search-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search transaction history"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(60);
            }}
            placeholder="Search transaction number, borrower, reference…"
          />
        </div>
        <select
          aria-label="Transaction type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {[
            "All types",
            "RELEASE",
            "ADVANCE",
            "PAYMENT",
            "VOID",
            "ADJUSTMENT",
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Payment method filter"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {["All methods", "cash", "bank", "gcash", "maya", "other"].map(
            (m) => (
              <option key={m}>{m}</option>
            ),
          )}
        </select>
      </div>
      <div
        className="form-grid"
        style={{
          gridTemplateColumns: "repeat(4, minmax(0,1fr))",
          marginBottom: 20,
        }}
      >
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
        <Field label="Borrower">
          <select value={bid} onChange={(e) => setBid(e.target.value)}>
            <option value="">All borrowers</option>
            {data.borrowers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fullName}
              </option>
            ))}
          </select>
        </Field>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
          />
          Include voided originals
        </label>
      </div>
      <div className="history-totals">
        <div>
          <small>COLLECTED IN RANGE</small>
          <b>
            <Money
              amount={valid
                .filter((t) => t.type === "PAYMENT")
                .reduce((s, t) => s + t.amount, 0)}
            />
          </b>
        </div>
        <div>
          <small>CASH RELEASED IN RANGE</small>
          <b>
            <Money
              amount={valid
                .filter((t) => ["RELEASE", "ADVANCE"].includes(t.type))
                .reduce((s, t) => s + t.amount, 0)}
            />
          </b>
        </div>
        <div>
          <small>TRANSACTIONS</small>
          <b>{filtered.length}</b>
        </div>
      </div>
      <div className="panel table-panel">
        {filtered.length ? (
          <div className="table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>TRANSACTION / DATE</th>
                  <th>BORROWER</th>
                  <th>TYPE</th>
                  <th>METHOD</th>
                  <th>AMOUNT</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((t) => (
                  <tr key={t.id} onClick={() => actions.receipt(t)}>
                    <td>
                      <button
                        className="transaction-id"
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.receipt(t);
                        }}
                      >
                        {t.txnNo}
                      </button>
                      <small>
                        {t.date} · {loanMap.get(t.loanId)?.loanNo}
                      </small>
                    </td>
                    <td>
                      {t.borrowerSnapshot.fullName}
                      <small>
                        {!borrowerIds.has(t.borrowerId) && "Deleted account · "}
                        #
                        {borrowerNumber(
                          t.borrowerSnapshot.numericId,
                          data.settings.borrowerPrefix,
                        )}
                      </small>
                    </td>
                    <td>
                      <Status status={voided.has(t.id) ? "Voided" : t.type} />
                    </td>
                    <td style={{ textTransform: "capitalize" }}>
                      {t.method || "—"}
                      <small>{t.referenceNo}</small>
                    </td>
                    <td>
                      <Money amount={t.amount} />
                    </td>
                    <td>
                      <FileText size={14} color="#a5a0c9" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<FileText />}
            title="A clear record from day one"
            body={
              query || type !== "All types"
                ? "No transactions match these filters."
                : "Your first release or payment will appear here, with its own permanent transaction number."
            }
          />
        )}
        <div className="table-footer">
          <span>
            Showing {Math.min(limit, filtered.length)} of {filtered.length}{" "}
            records
          </span>
          {filtered.length > limit && (
            <button
              className="text-button"
              onClick={() => setLimit((l) => l + 60)}
            >
              Show 60 more
            </button>
          )}
        </div>
      </div>
    </>
  );
}
