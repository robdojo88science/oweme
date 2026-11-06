import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Activity, Search, ShieldCheck } from "lucide-react";
import { db } from "../data/db";
import type { AppData } from "./types";
import { Empty } from "./primitives";

const timestamp = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export default function ActivityPage({ data }: { data: AppData }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(60);
  const audit =
    useLiveQuery(() => db.auditLogs.orderBy("at").reverse().toArray(), []) ??
    [];
  const names = new Map(data.borrowers.map((b) => [b.id, b.fullName]));
  const loans = new Map(data.loans.map((l) => [l.id, l.loanNo]));
  const transactions = new Map(data.transactions.map((t) => [t.id, t.txnNo]));
  const filtered = audit.filter((row) =>
    [
      row.action,
      row.entity,
      row.detail,
      names.get(row.entityId),
      loans.get(row.entityId),
      transactions.get(row.entityId),
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Activity</h1>
          <p>A clear trail of the changes that matter.</p>
        </div>
        <span className="status">
          <ShieldCheck size={13} />
          Audit history
        </span>
      </div>
      <div className="search-field" style={{ marginBottom: 20 }}>
        <Search size={16} />
        <input
          aria-label="Search activity"
          placeholder="Search action, borrower, loan or detail…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(60);
          }}
        />
      </div>
      <section className="panel activity-page">
        {filtered.length ? (
          <ol className="audit-list">
            {filtered.slice(0, limit).map((row) => (
              <li key={row.id} className="audit-row">
                <span className="audit-icon">
                  <Activity size={15} />
                </span>
                <div>
                  <b>{row.action.replaceAll("_", " ")}</b>
                  <span className="audit-entity">
                    {names.get(row.entityId) ||
                      loans.get(row.entityId) ||
                      transactions.get(row.entityId) ||
                      row.entity}
                  </span>
                  <p>{row.detail || "Change recorded in this notebook."}</p>
                  <time dateTime={row.at}>
                    {timestamp(row.at)} · Asia/Manila
                  </time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty
            icon={<Activity />}
            title={query ? "No matching activity" : "Your story starts here"}
            body="Borrower changes, releases, repayments, corrections and recovery actions appear here as you work."
          />
        )}
        {filtered.length > limit && (
          <div className="load-more">
            <button className="button" onClick={() => setLimit(limit + 60)}>
              Show 60 more
            </button>
          </div>
        )}
      </section>
    </>
  );
}
