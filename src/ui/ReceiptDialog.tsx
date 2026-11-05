import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Download,
  FileImage,
  FileText,
  LoaderCircle,
  Printer,
  Share2,
} from "lucide-react";
import type { Loan, Settings, Transaction } from "../core/model";
import { borrowerNumber, formatMoney } from "../core/logic";
import { voidTransaction } from "../data/service";
import {
  downloadFile,
  loanSlipPDF,
  printFile,
  publicText,
  receiptImage,
  receiptPDF,
  receiptSignatures,
  shareFile,
} from "../exports";
import { ErrorBox, Modal, Money } from "./primitives";

interface Props {
  transaction: Transaction;
  loan?: Loan;
  settings: Settings;
  voided: boolean;
  onClose: () => void;
  onVoid: () => void;
  onToast: (message: string) => void;
}
function useBlobURL(blob?: Blob) {
  const [url, setURL] = useState("");
  useEffect(() => {
    if (!blob) {
      setURL("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
function SignatureImage({ blob, label }: { blob?: Blob; label: string }) {
  const url = useBlobURL(blob);
  return blob ? (
    <div style={{ flex: 1, minWidth: 100, textAlign: "center" }}>
      <img
        src={url}
        alt={`${label} signature`}
        style={{ width: "100%", height: 70, objectFit: "contain" }}
      />
      <p className="caption">{label}</p>
    </div>
  ) : null;
}

export function ReceiptDialog({
  transaction: txn,
  loan,
  settings,
  voided,
  onClose,
  onVoid,
  onToast,
}: Props) {
  const [includeSignatures, setIncludeSignatures] = useState(true);
  const [variant, setVariant] = useState<"receipt" | "slip">("receipt");
  const [paper, setPaper] = useState<"a4" | "a5" | "notebook">("a4");
  const [pdf, setPDF] = useState<File>();
  const [image, setImage] = useState<File>();
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [reason, setReason] = useState("");
  const logo = useBlobURL(settings.business.logo);
  const proof = useBlobURL(txn.proofImage);
  const signatures = receiptSignatures(txn, loan);
  const canSlip = txn.type === "RELEASE" || txn.type === "ADVANCE";
  const title =
    txn.type === "ADVANCE"
      ? "Advance receipt"
      : txn.type === "RELEASE"
        ? "Release receipt"
        : txn.type === "VOID"
          ? "Void confirmation"
          : "Payment receipt";
  const publicNote = publicText(txn.notes);
  const recorded = useMemo(
    () =>
      new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(txn.createdAt)),
    [txn.createdAt],
  );
  const shareText = `${publicText(settings.business.name)}\n${title} ${txn.txnNo}\n${publicText(txn.borrowerSnapshot.fullName)} · #${borrowerNumber(txn.borrowerSnapshot.numericId, settings.borrowerPrefix)}\n${txn.date} · ${formatMoney(txn.amount)}\nBalance after: ${formatMoney(txn.balanceAfter)}${voided ? "\nVOIDED - retained for history." : ""}`;

  useEffect(() => {
    let cancelled = false;
    setPDF(undefined);
    setImage(undefined);
    setError("");
    if (!loan) {
      setPreparing(false);
      setError(
        "The linked loan is unavailable. The permanent transaction details are shown below.",
      );
      return;
    }
    setPreparing(true);
    const options = {
      includeSignatures,
      voided,
      ...(variant === "slip" ? { format: paper } : {}),
    };
    void Promise.allSettled([
      variant === "slip" && canSlip
        ? loanSlipPDF(loan, txn, settings, options)
        : receiptPDF(txn, loan, settings, options),
      receiptImage(txn, loan, settings, options),
    ])
      .then(([document, picture]) => {
        if (cancelled) return;
        if (document.status === "fulfilled") setPDF(document.value);
        else
          setError(
            document.reason instanceof Error
              ? document.reason.message
              : "Could not prepare the PDF.",
          );
        if (picture.status === "fulfilled") setImage(picture.value);
        else if (document.status === "fulfilled")
          setError(
            "The PDF is ready. This browser could not create the optional receipt image.",
          );
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [txn, loan, settings, includeSignatures, variant, paper, canSlip, voided]);

  async function share(file?: File) {
    if (!file) return;
    try {
      const outcome = await shareFile(file, shareText);
      if (outcome === "shared") onToast("Receipt shared.");
      else if (outcome === "downloaded")
        onToast("Receipt downloaded. Attach it from your messaging app.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not share the receipt.",
      );
    }
  }
  async function saveVoid() {
    setVoiding(true);
    setError("");
    try {
      await voidTransaction(txn.id, reason);
      setConfirmVoid(false);
      setReason("");
      onVoid();
      onToast("Transaction voided. A permanent reversal was added to History.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not void the transaction.",
      );
    } finally {
      setVoiding(false);
    }
  }
  const row = (label: string, value: string) => (
    <div className="receipt-row" key={label}>
      <span>{label}</span>
      <b>{publicText(value)}</b>
    </div>
  );
  return (
    <Modal title={title} subtitle={txn.txnNo} onClose={onClose}>
      <div className="modal-body" style={{ paddingBottom: 0 }}>
        {canSlip && (
          <div className="segmented" aria-label="Document type">
            <button
              className={variant === "receipt" ? "active" : ""}
              onClick={() => setVariant("receipt")}
            >
              Receipt
            </button>
            <button
              className={variant === "slip" ? "active" : ""}
              onClick={() => setVariant("slip")}
            >
              {txn.type === "ADVANCE" ? "Advance slip" : "Loan slip"}
            </button>
          </div>
        )}
        {variant === "slip" && (
          <label className="field">
            <span>Paper layout</span>
            <select
              value={paper}
              onChange={(event) =>
                setPaper(event.target.value as "a4" | "a5" | "notebook")
              }
            >
              <option value="a4">A4 · full page</option>
              <option value="a5">A5 · half page</option>
              <option value="notebook">Notebook · compact A5</option>
            </select>
            <small>
              Download or print the PDF to get the selected paper size and
              signature boxes.
            </small>
          </label>
        )}
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontSize: 11,
            color: "#626a7e",
            minHeight: 36,
          }}
        >
          <input
            type="checkbox"
            checked={includeSignatures}
            onChange={(event) => setIncludeSignatures(event.target.checked)}
          />
          Include saved signatures
        </label>
        <ErrorBox error={error} />
        {preparing && (
          <p
            className="caption"
            role="status"
            style={{ display: "flex", gap: 7, alignItems: "center" }}
          >
            <LoaderCircle size={13} className="spin" />
            Preparing printable files…
          </p>
        )}
      </div>
      <article className="receipt-paper" aria-label="Receipt preview">
        <header>
          {logo && (
            <img
              src={logo}
              alt="Business logo"
              style={{
                width: 48,
                height: 48,
                objectFit: "contain",
                marginBottom: 10,
              }}
            />
          )}
          <div className="receipt-brand">
            {publicText(settings.business.name) || "OweMe"}
          </div>
          {settings.business.address && (
            <p>{publicText(settings.business.address)}</p>
          )}
          <p>
            {variant === "slip"
              ? txn.type === "ADVANCE"
                ? "ADVANCE LOAN AGREEMENT"
                : "LOAN AGREEMENT"
              : title.toUpperCase()}
            <br />
            {txn.txnNo}
            <br />
            {txn.date} · Recorded {recorded}
          </p>
        </header>
        {voided && (
          <p
            role="status"
            style={{
              marginTop: 18,
              textAlign: "center",
              color: "#ba5260",
              fontSize: 12,
              fontWeight: 650,
            }}
          >
            VOIDED · RETAINED FOR HISTORY
          </p>
        )}
        <div className="receipt-amount">
          <small>
            {txn.type === "ADVANCE"
              ? "Cash handed over"
              : txn.type === "RELEASE"
                ? "Net release"
                : txn.type === "VOID"
                  ? "Amount reversed"
                  : "Amount received"}
          </small>
          <Money amount={txn.amount} />
        </div>
        {row(
          "Borrower",
          `${txn.borrowerSnapshot.fullName} · #${borrowerNumber(txn.borrowerSnapshot.numericId, settings.borrowerPrefix)}`,
        )}
        {row("Loan", loan?.loanNo || txn.loanId)}
        {txn.method && row("Method", txn.method.toUpperCase())}
        {txn.bankName && row("Bank / provider", txn.bankName)}
        {txn.referenceNo && row("Reference number", txn.referenceNo)}
        {row("Balance before", formatMoney(txn.balanceBefore))}
        {row("Balance after", formatMoney(txn.balanceAfter))}
        {!!txn.unappliedAmount &&
          row("Unapplied credit", formatMoney(txn.unappliedAmount))}
        {txn.nextDueDate &&
          txn.balanceAfter > 0 &&
          row("Next official due date", txn.nextDueDate)}
        {row(
          txn.type === "PAYMENT" ? "Received by" : "Issued / received by",
          txn.receivedBy,
        )}
        {txn.advance && (
          <div
            style={{
              borderTop: "1px dashed var(--line)",
              paddingTop: 18,
              marginTop: 18,
            }}
          >
            {row(
              "Advance mode",
              txn.advance.mode === "merge"
                ? "Merged into one loan"
                : "Separate loan",
            )}
            {row("Balance carried", formatMoney(txn.advance.carriedBalance))}
            {row(
              "Additional face amount",
              formatMoney(txn.advance.advanceFace),
            )}
            {row("Interest on advance", formatMoney(txn.advance.interest))}
            {row("New face amount", formatMoney(txn.advance.newFace))}
            {row("New term", `${txn.advance.newTerm} months`)}
            {row("New monthly payment", formatMoney(txn.advance.newMonthly))}
          </div>
        )}
        {!!txn.allocation.length && (
          <div
            style={{
              borderTop: "1px dashed var(--line)",
              paddingTop: 18,
              marginTop: 18,
            }}
          >
            <p className="caption" style={{ marginBottom: 12 }}>
              PAYMENT ALLOCATION
            </p>
            {txn.allocation.map((item) =>
              row(
                `Installment ${item.installmentNo}`,
                formatMoney(item.amount),
              ),
            )}
          </div>
        )}
        {variant === "slip" && loan && (
          <div
            style={{
              borderTop: "1px dashed var(--line)",
              paddingTop: 18,
              marginTop: 18,
            }}
          >
            {row("Face amount", formatMoney(loan.faceAmount))}
            {row("Interest on release", formatMoney(loan.interestAmount))}
            <p className="caption" style={{ marginBottom: 12 }}>
              OFFICIAL PAYMENT SCHEDULE
            </p>
            {loan.installments.map((item) =>
              row(`${item.no} · ${item.dueDate}`, formatMoney(item.amountDue)),
            )}
            <p
              className="caption"
              style={{ margin: "16px 0", color: "#737a8d" }}
            >
              {publicText(settings.agreementText)}
            </p>
          </div>
        )}
        {txn.type === "VOID" && (
          <div style={{ margin: "15px 0" }}>
            {row("Reverses transaction", txn.voidOf || "")}
            {row("Reason", txn.voidReason || "")}
          </div>
        )}
        {publicNote && (
          <p
            className="caption"
            style={{ padding: "12px 0 18px", whiteSpace: "pre-line" }}
          >
            {publicNote}
          </p>
        )}
        {includeSignatures && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              margin: "18px 0",
            }}
          >
            <SignatureImage
              blob={signatures.payer?.processed}
              label="Borrower / payer"
            />
            <SignatureImage
              blob={signatures.receiver?.processed}
              label={publicText(txn.receivedBy) || "Received by"}
            />
            {variant === "slip" && (
              <SignatureImage
                blob={loan?.signatures.witness?.processed}
                label="Witness"
              />
            )}
          </div>
        )}
        <div className="receipt-footer">
          {publicText(
            settings.receiptFooter ||
              "Thank you. Please keep this receipt for your records.",
          )}
        </div>
      </article>
      <div className="receipt-actions">
        <button
          className="button primary"
          disabled={!pdf || preparing}
          onClick={() => {
            if (pdf) {
              downloadFile(pdf);
              onToast("PDF downloaded.");
            }
          }}
        >
          <FileText size={15} />
          Download PDF
        </button>
        <button
          className="button"
          disabled={!pdf || preparing}
          onClick={() => {
            if (pdf) printFile(pdf);
          }}
        >
          <Printer size={15} />
          Print
        </button>
        <button
          className="button"
          disabled={!pdf || preparing}
          onClick={() => void share(pdf)}
        >
          <Share2 size={15} />
          Share PDF
        </button>
        <button
          className="button"
          disabled={!image || preparing}
          onClick={() => {
            if (image) {
              downloadFile(image);
              onToast("Receipt image downloaded.");
            }
          }}
        >
          <Download size={15} />
          Receipt image
        </button>
        <button
          className="button"
          disabled={!image || preparing}
          onClick={() => void share(image)}
        >
          <FileImage size={15} />
          Share receipt image
        </button>
      </div>
      {proof && (
        <div className="modal-body" style={{ paddingTop: 0 }}>
          <details>
            <summary className="caption">Payment proof · admin record</summary>
            <img
              className="image-proof"
              src={proof}
              alt="Uploaded payment proof"
            />
          </details>
        </div>
      )}
      {!voided && (txn.type === "PAYMENT" || txn.type === "ADVANCE") && (
        <div
          className="modal-body"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          {!confirmVoid ? (
            <button
              className="text-button"
              style={{ color: "#bd5c69" }}
              onClick={() => setConfirmVoid(true)}
            >
              <Ban size={14} />
              Void this {txn.type === "ADVANCE" ? "advance" : "payment"}
            </button>
          ) : (
            <div>
              <h3 style={{ fontSize: 12, marginBottom: 10 }}>
                Reason for voiding
              </h3>
              <p className="caption" style={{ marginBottom: 14 }}>
                {txn.type === "ADVANCE"
                  ? "The earlier loan will reopen in merge mode. Void payments on the advance loan first. "
                  : "The payment allocation will be reversed. "}
                A numbered reversal stays in History alongside this original
                transaction.
              </p>
              <label className="field">
                <span>Reason required</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="For example: payment recorded on the wrong loan"
                />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="button danger"
                  disabled={!reason.trim() || voiding}
                  onClick={() => void saveVoid()}
                >
                  {voiding ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Ban size={15} />
                  )}
                  Void transaction
                </button>
                <button
                  className="button"
                  disabled={voiding}
                  onClick={() => setConfirmVoid(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
