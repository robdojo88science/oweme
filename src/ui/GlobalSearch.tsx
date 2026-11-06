import { useMemo, useRef, useState, type RefObject } from "react";
import { ArrowUpRight, FileText, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Actions, AppData } from "./types";
import { borrowerNumber, formatMoney } from "../core/logic";
import { buildSearch, Highlight, normalize } from "./search";

export function GlobalSearch({
  data,
  actions,
  query,
  onQuery,
  inputRef,
}: {
  data: AppData;
  actions: Actions;
  query: string;
  onQuery: (q: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const nav = useNavigate(),
    [open, setOpen] = useState(false),
    container = useRef<HTMLDivElement>(null);
  const search = useMemo(
    () =>
      buildSearch(data.borrowers, data.loans, data.transactions, data.notes),
    [data.borrowers, data.loans, data.transactions, data.notes],
  );
  const ids = useMemo(() => search(query), [search, query]);
  const q = normalize(query.trim()),
    match = (text: string) => normalize(text).includes(q);
  const borrowers = ids
    ? [...ids]
        .map((id) => data.borrowers.find((b) => b.id === id))
        .filter((b) => !!b)
        .slice(0, 4)
    : [];
  const loans = q
    ? data.loans
        .filter((l) =>
          match(`${l.loanNo} ${l.borrowerSnapshot.fullName} ${l.notes || ""}`),
        )
        .slice(0, 3)
    : [];
  const transactions = q
    ? data.transactions
        .filter((t) =>
          match(
            `${t.txnNo} ${t.referenceNo || ""} ${t.borrowerSnapshot.fullName} ${t.notes || ""} ${t.method || ""}`,
          ),
        )
        .slice(0, 3)
    : [];
  const docs = q
    ? data.loans
        .filter((l) =>
          match(
            `agreement ${l.loanNo} ${l.borrowerSnapshot.fullName} ${(l.documents || []).map((d) => d.name).join(" ")}`,
          ),
        )
        .slice(0, 2)
    : [];
  const found =
    borrowers.length + loans.length + transactions.length + docs.length;
  const go = (path: string) => {
    nav(path);
    setOpen(false);
    inputRef.current?.blur();
  };
  return (
    <div
      className="global-search"
      ref={container}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          inputRef.current?.focus();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setOpen(true);
          const buttons = [
            ...(container.current?.querySelectorAll<HTMLButtonElement>(
              ".search-result",
            ) || []),
          ];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
          ]?.focus();
        }
      }}
    >
      <Search size={17} />
      <input
        ref={inputRef}
        aria-label="Global search"
        aria-expanded={open && !!q}
        aria-controls="global-results"
        autoComplete="off"
        placeholder="Search your notebook…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go("/borrowers");
          }
        }}
      />
      {q ? (
        <button
          className="search-clear"
          aria-label="Clear global search"
          onClick={() => {
            onQuery("");
            inputRef.current?.focus();
          }}
        >
          <X size={14} />
        </button>
      ) : (
        <kbd>⌘ K</kbd>
      )}
      {open && q && (
        <div
          id="global-results"
          className="search-results"
          role="region"
          aria-label="Notebook search results"
        >
          <div className="search-results-head">
            <b>Search results</b>
            <small>On this device only</small>
          </div>
          {!!borrowers.length && (
            <section>
              <h3>Borrowers</h3>
              {borrowers.map((b) => (
                <button
                  className="search-result"
                  key={b.id}
                  onClick={() => go(`/borrowers/${b.id}`)}
                >
                  <span>
                    <b>
                      <Highlight text={b.fullName} query={query} />
                    </b>
                    <small>
                      #{borrowerNumber(b.numericId)} ·{" "}
                      {b.address || "No address added"}
                    </small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </section>
          )}
          {!!loans.length && (
            <section>
              <h3>Loans</h3>
              {loans.map((l) => (
                <button
                  className="search-result"
                  key={l.id}
                  onClick={() => go(`/borrowers/${l.borrowerId}`)}
                >
                  <span>
                    <b>
                      <Highlight text={l.loanNo} query={query} />
                    </b>
                    <small>
                      {l.borrowerSnapshot.fullName} ·{" "}
                      {formatMoney(l.faceAmount)} · {l.status}
                    </small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </section>
          )}
          {!!transactions.length && (
            <section>
              <h3>Transactions</h3>
              {transactions.map((t) => (
                <button
                  className="search-result"
                  key={t.id}
                  onClick={() => {
                    actions.receipt(t);
                    setOpen(false);
                  }}
                >
                  <span>
                    <b>
                      <Highlight text={t.txnNo} query={query} />
                    </b>
                    <small>
                      {t.borrowerSnapshot.fullName} · {formatMoney(t.amount)} ·{" "}
                      {t.method || t.type}
                    </small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </section>
          )}
          {!!docs.length && (
            <section>
              <h3>Documents</h3>
              {docs.map((l) => (
                <button
                  className="search-result"
                  key={l.id}
                  onClick={() => go("/documents")}
                >
                  <FileText size={15} />
                  <span>
                    <b>Agreement · {l.loanNo}</b>
                    <small>
                      {l.borrowerSnapshot.fullName} ·{" "}
                      {l.signatures.borrower
                        ? "Signature attached"
                        : "Awaiting signature"}
                    </small>
                  </span>
                </button>
              ))}
            </section>
          )}
          {!found && (
            <p className="search-no-results">
              No matching records. Try a name, ID, reference, or address.
            </p>
          )}
          <button
            className="search-result search-all"
            onClick={() => go("/borrowers")}
          >
            View matching borrowers
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
