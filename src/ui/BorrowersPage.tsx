import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  FileText,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AppData, Actions } from "./types";
import type { Loan } from "../core/model";
import { dateLabel } from "./types";
import {
  addDays,
  balance,
  borrowerNumber,
  borrowerRating,
  installmentStatus,
  today,
} from "../core/logic";
import { addNote, updateBorrower } from "../data/service";
import { Avatar, Empty, Help, Money, Stars } from "./primitives";
import { Schedule, Status } from "./forms";
import { buildSearch, Highlight, normalize } from "./search";
export default function BorrowersPage({
  data,
  actions,
  selectedId,
  query,
  onQuery,
}: {
  data: AppData;
  actions: Actions;
  selectedId?: string;
  query: string;
  onQuery: (q: string) => void;
}) {
  const nav = useNavigate();
  const asOf = today();
  const weekEnd = addDays(asOf, 7);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0),
    [transactionLimit, setTransactionLimit] = useState(100);
  const [filter, setFilter] = useState("All borrowers"),
    [sort, setSort] = useState("ID"),
    [tab, setTab] = useState("Overview"),
    [note, setNote] = useState(""),
    [search, setSearch] = useState(query),
    [scrollTop, setScrollTop] = useState(0),
    [recent, setRecent] = useState<string[]>(() => {
      try {
        const saved: unknown = JSON.parse(
          localStorage.getItem("oweme-recent") || "[]",
        );
        return Array.isArray(saved)
          ? saved
              .filter((item): item is string => typeof item === "string")
              .slice(0, 5)
          : [];
      } catch {
        return [];
      }
    });
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 120);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setTab("Overview");
    setTransactionLimit(100);
  }, [selectedId]);
  useEffect(() => {
    setScrollTop(0);
    setFocusedIndex(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query, filter, sort]);
  const lookup = useMemo(() => {
    const map = new Map<string, Loan[]>();
    data.loans.forEach((l) => {
      const arr = map.get(l.borrowerId) || [];
      arr.push(l);
      map.set(l.borrowerId, arr);
    });
    return map;
  }, [data.loans]);
  const searchIndex = useMemo(
    () =>
      buildSearch(data.borrowers, data.loans, data.transactions, data.notes),
    [data.borrowers, data.loans, data.transactions, data.notes],
  );
  const found = useMemo(() => searchIndex(search), [searchIndex, search]);
  const summaries = useMemo(
    () =>
      new Map(
        data.borrowers.map((b) => {
          const loans = lookup.get(b.id) || [],
            active = loans.filter((l) => l.status === "active"),
            items = active
              .flatMap((l) => l.installments)
              .filter((i) => i.amountPaid < i.amountDue),
            next = [...items].sort((a, b) =>
              a.dueDate.localeCompare(b.dueDate),
            )[0];
          return [
            b.id,
            {
              balance: loans.reduce((s, l) => s + balance(l), 0),
              rating: borrowerRating(loans, asOf, data.settings.scoring).stars,
              recentActivity: loans.reduce(
                (latest, loan) =>
                  loan.updatedAt > latest ? loan.updatedAt : latest,
                b.updatedAt,
              ),
              overdue: items.some(
                (i) => installmentStatus(i, asOf) === "Overdue",
              ),
              dueWeek: items.some(
                (i) => i.dueDate >= asOf && i.dueDate <= weekEnd,
              ),
              next: next?.dueDate || "9999",
            },
          ];
        }),
      ),
    [data.borrowers, lookup, data.settings.scoring, asOf, weekEnd],
  );
  const filtered = useMemo(
    () =>
      data.borrowers
        .filter((b) => {
          const s = summaries.get(b.id)!;
          return (
            (!found || found.has(b.id)) &&
            (filter === "Archived"
              ? b.status === "archived"
              : b.status === "active") &&
            (filter === "Overdue"
              ? s.overdue
              : filter === "Due this week"
                ? s.dueWeek
                : filter === "Has balance"
                  ? s.balance > 0
                  : filter === "Fully paid"
                    ? s.balance === 0 && (lookup.get(b.id) || []).length > 0
                    : filter === "4★+"
                      ? s.rating !== null && s.rating >= 4
                      : filter === "Low rating"
                        ? s.rating !== null && s.rating < 3
                        : filter === "New"
                          ? s.rating === null
                          : true)
          );
        })
        .sort((a, b) => {
          const x = summaries.get(a.id)!,
            y = summaries.get(b.id)!;
          return sort === "Name"
            ? a.fullName.localeCompare(b.fullName)
            : sort === "Balance"
              ? y.balance - x.balance
              : sort === "Next due"
                ? x.next.localeCompare(y.next)
                : sort === "Rating"
                  ? (y.rating ?? -1) - (x.rating ?? -1)
                  : sort === "Recently active"
                    ? y.recentActivity.localeCompare(x.recentActivity)
                    : a.numericId - b.numericId;
        }),
    [data.borrowers, filter, found, lookup, sort, summaries],
  );
  const selected = data.borrowers.find((b) => b.id === selectedId);
  const selectedLoans = selected ? lookup.get(selected.id) || [] : [],
    selectedSummary = selected ? summaries.get(selected.id) : undefined;
  const active = selectedLoans.filter((l) => l.status === "active");
  const notes = data.notes
    .filter((n) => n.borrowerId === selected?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const txns = data.transactions
    .filter((t) => t.borrowerId === selected?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const matchTransactions = useMemo(() => {
    const words = normalize(search.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return data.transactions
      .filter((t) => {
        const haystack = normalize(
          [t.txnNo, t.notes || "", t.borrowerSnapshot.fullName].join(" "),
        );
        return (
          words.every((word) => haystack.includes(word)) ||
          !!found?.has(t.borrowerId)
        );
      })
      .slice(0, 8);
  }, [data.transactions, search, found]);
  const start = Math.max(0, Math.floor(scrollTop / 85) - 3),
    end = Math.min(filtered.length, start + 14);
  const saveRecent = () => {
    if (!query.trim()) return;
    const next = [
      query.trim(),
      ...recent.filter((r) => r !== query.trim()),
    ].slice(0, 5);
    setRecent(next);
    try {
      localStorage.setItem("oweme-recent", JSON.stringify(next));
    } catch {
      /* Search remains available when browser storage is restricted. */
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Borrowers</h1>
          <p>People first. Every account, thoughtfully kept.</p>
        </div>
        <button className="button primary" onClick={() => actions.borrower()}>
          <Plus size={15} />
          New borrower
        </button>
      </div>
      <div className="search-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search borrowers"
            value={query}
            onChange={(e) => {
              onQuery(e.target.value);
              setScrollTop(0);
            }}
            onBlur={saveRecent}
            placeholder="Search names, IDs, purok, contact, or transaction…"
          />
          <span style={{ fontSize: 9, whiteSpace: "nowrap" }}>
            {filtered.length} found
          </span>
        </div>
        <select
          aria-label="Sort borrowers"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {[
            "ID",
            "Name",
            "Balance",
            "Next due",
            "Rating",
            "Recently active",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {recent.length > 0 && !query && (
        <div className="recent-searches">
          Recent:
          {recent.map((r) => (
            <button key={r} onClick={() => onQuery(r)}>
              {r}
            </button>
          ))}
        </div>
      )}
      <div className="filter-chips">
        {[
          "All borrowers",
          "Overdue",
          "Due this week",
          "Has balance",
          "Fully paid",
          "4★+",
          "Low rating",
          "New",
          "Archived",
        ].map((f) => (
          <button
            className={`filter-chip ${filter === f ? "active" : ""}`}
            key={f}
            onClick={() => {
              setFilter(f);
              setScrollTop(0);
            }}
          >
            {f}
          </button>
        ))}
      </div>
      <div className={`borrower-grid ${selected ? "has-selection" : ""}`}>
        <div className="panel borrower-list">
          <div className="panel-head">
            <div className="section-title">
              <h2>Your notebook</h2>
              <span className="caption">{filtered.length} accounts</span>
            </div>
          </div>
          {filtered.length ? (
            <div
              ref={listRef}
              tabIndex={0}
              role="listbox"
              aria-label="Borrower accounts"
              aria-activedescendant={
                focusedIndex >= start &&
                focusedIndex < end &&
                filtered[focusedIndex]
                  ? `borrower-option-${filtered[focusedIndex].id}`
                  : undefined
              }
              style={{
                height: Math.min(595, filtered.length * 85),
                overflowY: "auto",
                position: "relative",
              }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  const person =
                    filtered[Math.min(focusedIndex, filtered.length - 1)];
                  if (person) {
                    saveRecent();
                    nav(`/borrowers/${person.id}`);
                  }
                  return;
                }
                const delta =
                  e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                if (!delta && e.key !== "Home" && e.key !== "End") return;
                e.preventDefault();
                const index =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? filtered.length - 1
                      : Math.max(
                          0,
                          Math.min(filtered.length - 1, focusedIndex + delta),
                        );
                setFocusedIndex(index);
                if (listRef.current) {
                  listRef.current.focus();
                  const visible = listRef.current.clientHeight;
                  const y = index * 85;
                  if (y < listRef.current.scrollTop)
                    listRef.current.scrollTop = y;
                  else if (y + 85 > listRef.current.scrollTop + visible)
                    listRef.current.scrollTop = y + 85 - visible;
                  setScrollTop(listRef.current.scrollTop);
                }
              }}
            >
              <div
                style={{ height: filtered.length * 85, position: "relative" }}
              >
                {filtered.slice(start, end).map((b, i) => {
                  const s = summaries.get(b.id)!;
                  return (
                    <button
                      role="option"
                      aria-selected={selectedId === b.id}
                      tabIndex={-1}
                      id={`borrower-option-${b.id}`}
                      className={`borrower-row ${selectedId === b.id ? "selected" : ""}`}
                      style={{
                        position: "absolute",
                        top: (start + i) * 85,
                        height: 85,
                        outline:
                          focusedIndex === start + i
                            ? "1px solid #c9c4ff"
                            : undefined,
                        outlineOffset: -1,
                      }}
                      key={b.id}
                      onClick={() => {
                        setFocusedIndex(start + i);
                        saveRecent();
                        nav(`/borrowers/${b.id}`);
                      }}
                    >
                      <div className="person">
                        <Avatar borrower={b} />
                        <div>
                          <b>
                            <Highlight text={b.fullName} query={query} />
                          </b>
                          <p>
                            #
                            {borrowerNumber(
                              b.numericId,
                              data.settings.borrowerPrefix,
                            )}{" "}
                            · <Highlight text={b.address} query={query} />
                          </p>
                          <div style={{ marginTop: 5 }}>
                            <Stars stars={s.rating} />
                          </div>
                        </div>
                      </div>
                      <div className="row-balance">
                        <Money amount={s.balance} />
                        <div>
                          <Status
                            status={
                              s.overdue
                                ? "Overdue"
                                : s.balance
                                  ? "Active"
                                  : "No balance"
                            }
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <Empty
              icon={<Users />}
              title={
                query ? "No matching accounts" : "Room for your first borrower"
              }
              body={
                query
                  ? "Try a borrower ID, another spelling, an address, or a contact number."
                  : "Start with a name and a conversation. We’ll take care of the numbers."
              }
              action={
                <button
                  className="button small"
                  onClick={() => actions.borrower()}
                >
                  <Plus size={13} />
                  Add borrower
                </button>
              }
            />
          )}
          <div className="table-footer">
            <span>Private records · Saved on this device</span>
            <Users size={12} />
          </div>
          {matchTransactions.length > 0 && (
            <div style={{ padding: 17, borderTop: "1px solid var(--line)" }}>
              <h3 style={{ fontSize: 11, marginBottom: 10 }}>
                Matching transactions
              </h3>
              {matchTransactions.map((t) => (
                <button
                  key={t.id}
                  onClick={() => actions.receipt(t)}
                  style={{
                    display: "flex",
                    width: "100%",
                    justifyContent: "space-between",
                    padding: "11px 0",
                    fontSize: 10,
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <span className="transaction-id">
                    <Highlight text={t.txnNo} query={query} />
                  </span>
                  <Money amount={t.amount} />
                </button>
              ))}
            </div>
          )}
        </div>
        {selected && selectedSummary ? (
          <section className="panel borrower-detail">
            <button
              className="text-button back-to-list"
              onClick={() => nav("/borrowers")}
            >
              <ArrowLeft size={13} />
              All borrowers
            </button>
            <div className="profile-top">
              <Avatar borrower={selected} size="large" />
              <div>
                <h2>{selected.fullName}</h2>
                <p>
                  Borrower account · #
                  {borrowerNumber(
                    selected.numericId,
                    data.settings.borrowerPrefix,
                  )}{" "}
                  {selected.status === "archived" && "· Archived"}
                </p>
                <Stars stars={selectedSummary.rating} />
                <Help topic="rating" />
              </div>
            </div>
            <div className="profile-info">
              <span>
                <MapPin size={13} />
                {selected.address}
              </span>
              {selected.contact && (
                <>
                  <a href={`tel:${selected.contact}`}>
                    <Phone size={12} />
                    {selected.contact}
                  </a>
                  <a href={`sms:${selected.contact}`}>
                    <MessageCircle size={13} />
                    Text
                  </a>
                </>
              )}
            </div>
            <div className="profile-metrics">
              <div>
                <small>
                  Balance remaining <Help topic="balance" />
                </small>
                <b>
                  <Money amount={selectedSummary.balance} />
                </b>
              </div>
              <div>
                <small>Next official due date</small>
                <b style={{ fontSize: 16 }}>
                  {selectedSummary.next === "9999"
                    ? "All clear"
                    : dateLabel(selectedSummary.next)}
                </b>
              </div>
            </div>
            <div className="profile-actions">
              <button
                className="button primary"
                disabled={!active.length}
                onClick={() => actions.payment(active[0]?.id)}
              >
                <Wallet size={13} />
                Receive payment
              </button>
              {active.length > 0 && (
                <button
                  className="button"
                  onClick={() =>
                    actions.loan({ borrowerId: selected.id, advance: true })
                  }
                >
                  <ArrowUpRightIcon />
                  Advance loan
                </button>
              )}
              <button
                className="button"
                onClick={() => actions.loan({ borrowerId: selected.id })}
              >
                <Plus size={13} />
                New loan
              </button>
              <button
                className="button"
                onClick={() => actions.export(selected)}
              >
                <FileText size={13} />
                Statement / Share
              </button>
            </div>
            <div className="tabs detail-tabs">
              {["Overview", "Loans", "Transactions", "Notes"].map((t) => (
                <button
                  className={`tab ${tab === t ? "active" : ""}`}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t}
                  {t === "Loans" && (
                    <span className="count">{selectedLoans.length}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="detail-body">
              {(tab === "Overview" || tab === "Loans") &&
                (selectedLoans.length ? (
                  [...selectedLoans]
                    .sort(
                      (a, b) =>
                        b.releaseDate.localeCompare(a.releaseDate) ||
                        b.createdAt.localeCompare(a.createdAt) ||
                        b.loanNo.localeCompare(a.loanNo, undefined, {
                          numeric: true,
                        }),
                    )
                    .map((l) => (
                      <div className="loan-card" key={l.id}>
                        <div className="loan-card-head">
                          <div>
                            <h3>
                              {l.loanNo}{" "}
                              {l.kind === "advance" && (
                                <Status status="advance" />
                              )}
                            </h3>
                            <p>
                              {l.releaseDate} · {l.termMonths} months ·{" "}
                              {(l.rate * 100).toFixed(2)}% interest
                            </p>
                            {l.parentLoanId && (
                              <p>
                                {
                                  data.loans.find(
                                    (p) => p.id === l.parentLoanId,
                                  )?.loanNo
                                }{" "}
                                → {l.kind === "advance" ? "Advance" : "Loan"} →{" "}
                                {l.loanNo}
                              </p>
                            )}
                            {l.mergedIntoLoanId && (
                              <p>
                                Merged →{" "}
                                {
                                  data.loans.find(
                                    (p) => p.id === l.mergedIntoLoanId,
                                  )?.loanNo
                                }
                              </p>
                            )}
                          </div>
                          <Status status={l.status} />
                        </div>
                        <div className="loan-stats">
                          <div>
                            <small>Face amount</small>
                            <b>
                              <Money amount={l.faceAmount} />
                            </b>
                          </div>
                          <div>
                            <small>Cash released</small>
                            <b>
                              <Money amount={l.netRelease} />
                            </b>
                          </div>
                          <div>
                            <small>Remaining</small>
                            <b>
                              <Money amount={balance(l)} />
                            </b>
                          </div>
                        </div>
                        <div className="table-wrap">
                          <Schedule items={l.installments} />
                        </div>
                        {l.autoNote && (
                          <p className="loan-note">{l.autoNote}</p>
                        )}
                        <div
                          style={{
                            display: "flex",
                            gap: 13,
                            padding: "10px 15px",
                          }}
                        >
                          <button
                            className="text-button"
                            onClick={() => {
                              const t = data.transactions.find(
                                (t) =>
                                  t.loanId === l.id &&
                                  ["RELEASE", "ADVANCE"].includes(t.type),
                              );
                              if (t) actions.receipt(t);
                            }}
                          >
                            <FileText size={12} />
                            Slip & receipt
                          </button>
                          <button
                            className="text-button"
                            onClick={() => actions.signature(l)}
                          >
                            <Camera size={12} />
                            {l.signatures.borrower
                              ? "View / update signature"
                              : "Add signature"}
                          </button>
                          {!l.signatures.borrower && (
                            <span className="status">No signature</span>
                          )}
                        </div>
                      </div>
                    ))
                ) : (
                  <Empty
                    icon={<Wallet />}
                    title="A fresh start"
                    body="This borrower has no loans yet. Create an agreement when they’re ready."
                    action={
                      <button
                        className="button small"
                        onClick={() =>
                          actions.loan({ borrowerId: selected.id })
                        }
                      >
                        Create first loan
                        <ArrowRight size={12} />
                      </button>
                    }
                  />
                ))}
              {tab === "Transactions" &&
                (txns.length ? (
                  <div className="table-wrap">
                    <table className="schedule">
                      <thead>
                        <tr>
                          <th>Transaction</th>
                          <th>Date</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {txns.slice(0, transactionLimit).map((t) => (
                          <tr key={t.id}>
                            <td>
                              <button
                                className="transaction-id"
                                onClick={() => actions.receipt(t)}
                              >
                                {t.txnNo}
                                <br />
                                <small>{t.type}</small>
                              </button>
                            </td>
                            <td>{t.date}</td>
                            <td>
                              <Money amount={t.amount} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {txns.length > transactionLimit && (
                      <div className="load-more">
                        <button
                          className="button small"
                          onClick={() =>
                            setTransactionLimit((limit) => limit + 100)
                          }
                        >
                          Show more transactions
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Empty
                    icon={<FileText />}
                    title="No transactions yet"
                    body="Every release and payment will appear here."
                  />
                ))}
              {tab === "Notes" && (
                <>
                  <form
                    className="note-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await addNote(selected.id, note);
                        setNote("");
                        actions.toast("Note added to the timeline.");
                      } catch (e) {
                        actions.toast(String(e));
                      }
                    }}
                  >
                    <input
                      className="input"
                      aria-label="Borrower note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add a note from your conversation…"
                    />
                    <button className="button primary" disabled={!note.trim()}>
                      Add note
                    </button>
                  </form>
                  {selected.notes && (
                    <div className="note-item">
                      <time>Account notes</time>
                      {selected.notes}
                    </div>
                  )}
                  {notes.map((n) => (
                    <div className="note-item" key={n.id}>
                      <time>
                        {new Intl.DateTimeFormat("en-PH", {
                          dateStyle: "medium",
                          timeZone: "Asia/Manila",
                        }).format(new Date(n.createdAt))}{" "}
                        ·{" "}
                        {n.kind === "advance"
                          ? "Automatic advance note"
                          : "Your note"}
                      </time>
                      {n.text}
                    </div>
                  ))}
                  {!notes.length && !selected.notes && (
                    <Empty
                      icon={<MessageCircle />}
                      title="Every conversation matters"
                      body="Keep useful details here. Advance notes are written for you automatically."
                    />
                  )}
                </>
              )}
            </div>
            <div className="danger-links">
              <button onClick={() => actions.borrower(selected)}>
                Edit account
              </button>
              <button
                onClick={async () => {
                  try {
                    const next =
                      selected.status === "active" ? "archived" : "active";
                    await updateBorrower(selected.id, { status: next });
                    actions.toast(
                      next === "archived"
                        ? "Borrower archived. Use the Archived filter to restore."
                        : "Borrower restored.",
                    );
                  } catch (e) {
                    actions.toast(String(e));
                  }
                }}
              >
                {selected.status === "archived"
                  ? "Restore account"
                  : "Archive account"}
              </button>
              <button onClick={() => actions.remove(selected)}>
                Delete account
              </button>
            </div>
          </section>
        ) : (
          <div className="panel">
            <Empty
              icon={<Users />}
              title="A person behind every number"
              body="Choose an account to see their loans, payment story, and next steps."
            />
          </div>
        )}
      </div>
    </>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={13} style={{ transform: "rotate(-45deg)" }} />;
}
