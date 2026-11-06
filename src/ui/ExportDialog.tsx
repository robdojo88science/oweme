import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  Mail,
  MessageCircle,
  Printer,
  Share2,
} from "lucide-react";
import type { Borrower, Loan, Settings, Transaction } from "../core/model";
import { addMonthsClamped, today } from "../core/logic";
import {
  borrowerSummary,
  calendarFile,
  copyText,
  downloadFile,
  emailFile,
  printFile,
  shareFile,
  statementPDF,
} from "../exports";
import { ErrorBox, Modal } from "./primitives";

interface Props {
  borrower: Borrower;
  loans: Loan[];
  transactions: Transaction[];
  settings: Settings;
  onClose: () => void;
  onToast: (message: string) => void;
}
type Preset = "month" | "three" | "year" | "all" | "custom";

export function ExportDialog({
  borrower,
  loans,
  transactions,
  settings,
  onClose,
  onToast,
}: Props) {
  const current = today();
  const [preset, setPreset] = useState<Preset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeSignatures, setIncludeSignatures] = useState(true);
  const [file, setFile] = useState<File>();
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [privacyReviewed, setPrivacyReviewed] = useState(false);
  const invalidRange = !!from && !!to && from > to;
  const summary = useMemo(
    () => borrowerSummary(borrower, loans, settings),
    [borrower, loans, settings],
  );
  const ownLoans = loans.filter((loan) => loan.borrowerId === borrower.id);

  function applyPreset(value: Preset) {
    setPreset(value);
    if (value === "all") {
      setFrom("");
      setTo("");
    } else if (value !== "custom") {
      setFrom(
        value === "month"
          ? current.slice(0, 7) + "-01"
          : value === "year"
            ? current.slice(0, 4) + "-01-01"
            : addMonthsClamped(current, -3),
      );
      setTo(current);
    }
  }
  useEffect(() => {
    let cancelled = false;
    setFile(undefined);
    setError("");
    if (invalidRange) {
      setPreparing(false);
      return;
    }
    setPreparing(true);
    void statementPDF(borrower, loans, transactions, settings, {
      from: from || undefined,
      to: to || undefined,
      includeSignatures,
    })
      .then((next) => {
        if (!cancelled) setFile(next);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not prepare the statement.",
          );
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    borrower,
    loans,
    transactions,
    settings,
    from,
    to,
    includeSignatures,
    invalidRange,
  ]);

  async function share() {
    if (!file) return;
    try {
      const outcome = await shareFile(file, summary);
      if (outcome === "shared") onToast("Statement shared.");
      else if (outcome === "downloaded")
        onToast(
          "PDF downloaded. Summary copied when clipboard access is available.",
        );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not share the statement.",
      );
    }
  }
  async function copy() {
    try {
      await copyText(summary);
      setCopied(true);
      onToast("Borrower summary copied.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Select and copy the summary below.",
      );
    }
  }
  return (
    <Modal
      title="Statement & share"
      subtitle={`Prepare a borrower copy for ${borrower.fullName}.`}
      onClose={onClose}
    >
      <div className="modal-body">
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: 16,
            background: "#f6f5ff",
            border: "1px solid #eae7fc",
            borderRadius: 12,
            marginBottom: 22,
          }}
        >
          <FileText size={22} style={{ color: "#8274cd", flexShrink: 0 }} />
          <div>
            <h3 style={{ fontSize: 12 }}>Statement of account</h3>
            <p className="caption" style={{ marginTop: 5 }}>
              Business details, loans and advances, official due dates,
              payments, references, and the current balance.
            </p>
          </div>
        </div>
        <label className="field">
          <span>Statement period</span>
          <select
            value={preset}
            onChange={(event) => applyPreset(event.target.value as Preset)}
          >
            <option value="month">This month</option>
            <option value="three">Last 3 months</option>
            <option value="year">This year</option>
            <option value="all">All time</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        <div className="form-grid" style={{ marginBottom: 18 }}>
          <label className="field">
            <span>From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setPreset("custom");
                setFrom(event.target.value);
              }}
            />
            <small>Leave blank for the first record.</small>
          </label>
          <label className="field">
            <span>Through</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => {
                setPreset("custom");
                setTo(event.target.value);
              }}
            />
            <small>Leave blank for all records.</small>
          </label>
        </div>
        <label
          style={{
            display: "flex",
            gap: 9,
            alignItems: "center",
            fontSize: 11,
            color: "#777d90",
            minHeight: 44,
            marginBottom: 10,
          }}
        >
          <input
            type="checkbox"
            checked={includeSignatures}
            onChange={(event) => setIncludeSignatures(event.target.checked)}
          />
          Include saved signatures
        </label>
        <ErrorBox
          error={
            invalidRange
              ? "The end date must be on or after the start date."
              : error
          }
        />
        {preparing && (
          <p
            className="caption"
            role="status"
            style={{
              display: "flex",
              gap: 7,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <LoaderCircle size={13} className="spin" />
            Preparing your PDF…
          </p>
        )}
        <label className="checkbox-row" style={{ margin: "14px 0" }}>
          <input
            type="checkbox"
            checked={privacyReviewed}
            onChange={(event) => setPrivacyReviewed(event.target.checked)}
          />
          I reviewed this borrower’s details and have permission to share them
          with the intended recipient.
        </label>
        <div className="backup-buttons">
          <button
            className="button primary"
            disabled={!file || preparing}
            onClick={() => {
              if (file) {
                downloadFile(file);
                onToast("Statement PDF downloaded.");
              }
            }}
          >
            <Download size={15} />
            Download PDF
          </button>
          <button
            className="button"
            disabled={!file || preparing}
            onClick={() => {
              if (file) printFile(file);
            }}
          >
            <Printer size={15} />
            Print
          </button>
          <button
            className="button"
            disabled={!file || preparing || !privacyReviewed}
            onClick={() => void share()}
          >
            <Share2 size={15} />
            Share
          </button>
        </div>
        <p className="caption">
          On supported phones and tablets, Share opens the system share sheet
          with the PDF attached. Otherwise the PDF downloads so you can attach
          it yourself.
        </p>
        <div
          style={{
            borderTop: "1px solid var(--line)",
            marginTop: 23,
            paddingTop: 22,
          }}
        >
          <h3 style={{ fontSize: 12, marginBottom: 12 }}>
            Quick borrower summary
          </h3>
          <textarea
            className="input"
            readOnly
            aria-label="Borrower summary for sharing"
            value={summary}
            style={{
              minHeight: 135,
              resize: "vertical",
              fontSize: 11,
              lineHeight: 1.9,
            }}
          />
          <div className="backup-buttons">
            <button className="button" onClick={() => void copy()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy text"}
            </button>
            <button
              className="button"
              disabled={!file || preparing || !privacyReviewed}
              onClick={() => {
                if (file) emailFile(file, summary);
              }}
            >
              <Mail size={15} />
              Email
            </button>
            <a
              className="button"
              href="https://www.messenger.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle size={15} />
              Messenger
            </a>
          </div>
          <p className="caption">
            For Messenger, copy the text, open your conversation, and attach the
            downloaded PDF. Attaching a file directly requires the system share
            sheet.
          </p>
        </div>
        <div
          style={{
            borderTop: "1px solid var(--line)",
            marginTop: 23,
            paddingTop: 20,
          }}
        >
          <button
            className="button"
            onClick={() => {
              downloadFile(
                calendarFile(ownLoans, settings, [borrower], current),
              );
              onToast(
                "Calendar file downloaded. Open it in your calendar app.",
              );
            }}
          >
            <CalendarDays size={15} />
            Add upcoming dues to Calendar
          </button>
          <p className="caption" style={{ marginTop: 9 }}>
            Exports an .ics file with official due dates. Your calendar app
            controls its own alerts.
          </p>
        </div>
      </div>
    </Modal>
  );
}
