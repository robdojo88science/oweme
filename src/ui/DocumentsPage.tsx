import { useState } from "react";
import {
  Check,
  Download,
  FileSignature,
  FileText,
  Search,
  Upload,
} from "lucide-react";
import type { Actions, AppData } from "./types";
import { dateLabel } from "./types";
import { Empty, Money } from "./primitives";
import { borrowerNumber } from "../core/logic";
import { downloadFile, loanSlipPDF } from "../exports";
import LoanDocuments from "./LoanDocuments";

export default function DocumentsPage({
  data,
  actions,
}: {
  data: AppData;
  actions: Actions;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("Agreements");
  const [busy, setBusy] = useState("");
  const matches = (text: string) =>
    text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const loans = data.loans
    .filter(
      (l) =>
        l.status !== "voided" &&
        matches(
          `${l.loanNo} ${l.borrowerSnapshot.fullName} ${borrowerNumber(l.borrowerSnapshot.numericId)} ${(l.documents || []).map((document) => document.name).join(" ")}`,
        ),
    )
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const receipts = data.transactions
    .filter((t) =>
      matches(
        `${t.txnNo} ${t.borrowerSnapshot.fullName} ${t.referenceNo || ""}`,
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const borrowers = data.borrowers.filter((b) =>
    matches(`${b.fullName} ${borrowerNumber(b.numericId)}`),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Agreements & receipts</h1>
          <p>Every document, connected to the right record.</p>
        </div>
        <span className="status">Available offline</span>
      </div>
      <div className="search-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search documents"
            placeholder="Search borrower, loan, receipt or reference…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <section className="panel document-panel">
        <div className="tabs">
          {["Agreements", "Receipts", "Statements"].map((t) => (
            <button
              className={`tab ${tab === t ? "active" : ""}`}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "Agreements" &&
          (loans.length ? (
            <div className="document-list">
              {loans.slice(0, 100).map((loan) => (
                <article
                  key={loan.id}
                  className="document-row"
                  style={{ flexWrap: "wrap" }}
                >
                  <span className="more-icon purple">
                    <FileSignature size={21} />
                  </span>
                  <div className="document-main">
                    <b>{loan.loanNo}</b>
                    <p>
                      {loan.borrowerSnapshot.fullName} · Released{" "}
                      {dateLabel(loan.releaseDate)}
                    </p>
                    <span
                      className={`status ${loan.signatures.borrower ? "paid" : "upcoming"}`}
                    >
                      {loan.signatures.borrower ? (
                        <>
                          <Check size={12} />
                          Signature attached
                        </>
                      ) : (
                        "Signature pending"
                      )}
                    </span>
                  </div>
                  <Money amount={loan.faceAmount} />
                  <div className="document-actions">
                    <button
                      className="button small"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setBusy(loan.id);
                        const release = data.transactions.find(
                          (t) =>
                            t.loanId === loan.id &&
                            (t.type === "RELEASE" || t.type === "ADVANCE"),
                        );
                        if (!release) {
                          setBusy("");
                          actions.toast(
                            "The release record is missing. Restore the complete backup to print this agreement.",
                          );
                          return;
                        }
                        void loanSlipPDF(loan, release, data.settings)
                          .then((file) => downloadFile(file))
                          .catch((error) =>
                            actions.toast(
                              error instanceof Error
                                ? error.message
                                : "Could not create agreement.",
                            ),
                          )
                          .finally(() => setBusy(""));
                      }}
                    >
                      <Download size={14} />
                      {busy === loan.id ? "Preparing…" : "Agreement"}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Attach signed document to ${loan.loanNo}`}
                      onClick={() => actions.signature(loan)}
                    >
                      <Upload size={17} />
                    </button>
                  </div>
                  <details
                    className="document-evidence-details"
                    style={{ flexBasis: "100%" }}
                  >
                    <summary>
                      Signed paper & attachments ({loan.documents?.length || 0})
                    </summary>
                    <LoanDocuments loan={loan} onToast={actions.toast} />
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={<FileSignature />}
              title="Paperwork, ready when you are"
              body="Create a loan to print its agreement. Capture the signed paper and attach it to that exact loan."
            />
          ))}
        {tab === "Receipts" &&
          (receipts.length ? (
            <div className="document-list">
              {receipts.slice(0, 100).map((t) => (
                <button
                  key={t.id}
                  className="document-row"
                  onClick={() => actions.receipt(t)}
                >
                  <span className="more-icon green">
                    <FileText size={21} />
                  </span>
                  <span className="document-main">
                    <b>{t.txnNo}</b>
                    <p>
                      {t.borrowerSnapshot.fullName} · {dateLabel(t.date)}
                    </p>
                    <span className="caption">
                      {t.type === "VOID"
                        ? "Reversal"
                        : t.type === "PAYMENT"
                          ? "Payment receipt"
                          : "Cash release acknowledgement"}
                    </span>
                  </span>
                  <Money amount={t.amount} />
                  <Download size={17} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon={<FileText />}
              title="A receipt for every cash movement"
              body="Releases, repayments and reversals stay linked to their original ledger entry."
            />
          ))}
        {tab === "Statements" &&
          (borrowers.length ? (
            <div className="document-list">
              {borrowers.slice(0, 100).map((b) => (
                <button
                  key={b.id}
                  className="document-row"
                  onClick={() => actions.export(b)}
                >
                  <span className="more-icon amber">
                    <FileText size={21} />
                  </span>
                  <span className="document-main">
                    <b>{b.fullName}</b>
                    <p>
                      #
                      {borrowerNumber(
                        b.numericId,
                        data.settings.borrowerPrefix,
                      )}
                      {b.status === "archived" ? " · Archived account" : ""}
                    </p>
                    <span className="caption">
                      Choose all history or a date range
                    </span>
                  </span>
                  <Download size={17} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon={<FileText />}
              title="A clear account statement"
              body="Borrower statements include loan releases, payment dates, schedules and current balances."
            />
          ))}
      </section>
      <p className="caption" style={{ marginTop: 15 }}>
        Print an agreement for a real paper signature. Signing on screen is
        optional. Documents contain personal information; review before sharing.
      </p>
    </>
  );
}
