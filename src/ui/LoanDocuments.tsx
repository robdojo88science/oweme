import { useEffect, useState } from "react";
import { Camera, Download, FileText, Upload } from "lucide-react";
import type { Loan } from "../core/model";
import { attachLoanDocument } from "../data/service";
import { compressImage } from "../media/images";
import { downloadFile } from "../exports/files";
import { ErrorBox } from "./primitives";

type Attachment = NonNullable<Loan["documents"]>[number];
function DocumentEvidence({ document }: { document: Attachment }) {
  const [url, setURL] = useState("");
  useEffect(() => {
    if (!(document.file instanceof Blob)) {
      setURL("");
      return;
    }
    const next = URL.createObjectURL(document.file);
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [document.file]);
  return (
    <article className="loan-document-evidence">
      {!(document.file instanceof Blob) ? (
        <span className="caption">
          Binary evidence omitted from this Lite backup. Restore a Full backup
          to recover it.
        </span>
      ) : document.file.type.startsWith("image/") ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={`Scanned ${document.name}`} />
        </a>
      ) : (
        <a
          className="document-pdf-preview"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          <FileText size={28} />
          Open PDF
        </a>
      )}
      <b>{document.name}</b>
      <small>
        {new Intl.DateTimeFormat("en-PH", {
          timeZone: "Asia/Manila",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(document.addedAt))}
      </small>
      <button
        type="button"
        className="button small"
        disabled={!(document.file instanceof Blob)}
        onClick={() => downloadFile(document.file, document.name)}
      >
        <Download size={13} />
        Download
      </button>
    </article>
  );
}

export default function LoanDocuments({
  loan,
  onToast,
}: {
  loan: Loan;
  onToast: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file || busy) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setError("Choose a photo or PDF of the signed agreement.");
      return;
    }
    if (file.size > (file.type.startsWith("image/") ? 25 : 20) * 1024 * 1024) {
      setError(
        "This scan is too large. Use photos up to 25 MB or PDFs up to 20 MB.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const portable = file.type.startsWith("image/")
        ? await compressImage(file, 2400)
        : file;
      await attachLoanDocument(
        loan.id,
        portable,
        file.type.startsWith("image/")
          ? file.name.replace(/\.[^.]+$/, "") + ".jpg"
          : file.name,
      );
      onToast(
        "Signed document attached to this loan. Included in full backups.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save the document. Your existing evidence is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="loan-documents">
      <div className="section-title">
        <h3>Signed paper documents</h3>
        <span className="caption">{loan.loanNo}</span>
      </div>
      <p className="caption">
        Photograph the complete signed paper or upload a scan. Each addition is
        kept with its date; earlier evidence stays in history.
      </p>
      <div className="document-upload-actions">
        <label
          className="button small"
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          onKeyDown={(event) => {
            if (!busy && ["Enter", " "].includes(event.key)) {
              event.preventDefault();
              event.currentTarget.querySelector("input")?.click();
            }
          }}
        >
          <Camera size={15} />
          {busy ? "Saving…" : "Take photo"}
          <input
            hidden
            aria-label={`Photograph signed paper for ${loan.loanNo}`}
            disabled={busy}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <label
          className="button small"
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          onKeyDown={(event) => {
            if (!busy && ["Enter", " "].includes(event.key)) {
              event.preventDefault();
              event.currentTarget.querySelector("input")?.click();
            }
          }}
        >
          <Upload size={15} />
          Upload photo / PDF
          <input
            hidden
            aria-label={`Upload signed paper for ${loan.loanNo}`}
            disabled={busy}
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      <ErrorBox error={error} />
      {Boolean(loan.documents?.length) && (
        <div className="loan-document-gallery">
          {[...(loan.documents || [])].reverse().map((document) => (
            <DocumentEvidence key={document.id} document={document} />
          ))}
        </div>
      )}
    </section>
  );
}
