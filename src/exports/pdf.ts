import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  Borrower,
  Loan,
  Settings,
  SignatureRef,
  Transaction,
} from "../core/model";
import {
  balance,
  borrowerNumber,
  borrowerRating,
  formatMoney,
} from "../core/logic";
import { publicText, receiptLines, receiptSignatures } from "./public";
import { loadImage } from "../media/images";
import fontUrl from "./fonts/NotoSans-Regular.ttf?url";
import { loanCost } from "../ui/loanCost";

export interface DocumentOptions {
  includeSignatures?: boolean;
  format?: "a4" | "a5" | "notebook";
  from?: string;
  to?: string;
  voided?: boolean;
}
const ink: [number, number, number] = [17, 24, 39];
const indigo: [number, number, number] = [91, 92, 255];
const muted: [number, number, number] = [107, 114, 128];
let fontData: Promise<string> | undefined;
function binaryBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function blobData(blob: Blob): Promise<string> {
  return `data:${blob.type};base64,${binaryBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}
async function font(): Promise<string> {
  fontData ??= fetch(fontUrl)
    .then((response) => {
      if (!response.ok)
        throw new Error(
          "PDF font is unavailable. Open OweMe online once so the font can be cached.",
        );
      return response.arrayBuffer();
    })
    .then((buffer) => binaryBase64(new Uint8Array(buffer)))
    .catch((error) => {
      fontData = undefined;
      throw error;
    });
  return fontData;
}

class Layout {
  doc: jsPDF;
  y = 18;
  width: number;
  height: number;
  margin: number;
  constructor(options: DocumentOptions) {
    this.doc = new jsPDF({
      unit: "mm",
      format:
        options.format === "notebook" ? [148, 210] : options.format || "a4",
      compress: true,
    });
    this.width = this.doc.internal.pageSize.getWidth();
    this.height = this.doc.internal.pageSize.getHeight();
    this.margin = this.width < 160 ? 12 : 18;
  }
  async init(settings: Settings, title: string) {
    const data = await font();
    this.doc.addFileToVFS("NotoSans-Regular.ttf", data);
    this.doc.addFont("NotoSans-Regular.ttf", "OweMe", "normal");
    this.doc.addFont("NotoSans-Regular.ttf", "OweMe", "bold");
    this.doc.setFont("OweMe");
    this.doc.setTextColor(...ink);
    this.doc.setFillColor(...indigo);
    this.doc.roundedRect(this.margin, 15, 10, 10, 3, 3, "F");
    this.doc.setTextColor(255, 255, 255);
    this.doc.setFontSize(12);
    this.doc.text("O", this.margin + 3.2, 22);
    this.doc.setTextColor(...ink);
    this.doc.setFontSize(18);
    this.doc.text(
      publicText(settings.business.name) || "OweMe",
      this.margin + 14,
      23,
      { maxWidth: this.width - this.margin * 2 - 35 },
    );
    this.y = 32;
    if (settings.business.address)
      this.paragraph(publicText(settings.business.address), 8.5, muted);
    this.y += 3;
    this.doc.setDrawColor(231, 232, 238);
    this.doc.line(this.margin, this.y, this.width - this.margin, this.y);
    this.y += 11;
    this.doc.setFontSize(15);
    this.doc.setTextColor(...ink);
    this.doc.text(title, this.margin, this.y);
    this.y += 8;
    if (settings.business.logo) {
      try {
        this.doc.addImage(
          await blobData(settings.business.logo),
          this.width - this.margin - 16,
          15,
          16,
          16,
          undefined,
          "FAST",
        );
      } catch {
        /* A damaged optional logo must not prevent a receipt. */
      }
    }
  }
  ensure(height: number) {
    if (this.y + height > this.height - 18) {
      this.doc.addPage();
      this.y = 20;
    }
  }
  paragraph(text: string, size = 9, color = ink) {
    if (!text) return;
    const lines = this.doc
      .setFontSize(size)
      .splitTextToSize(
        publicText(text),
        this.width - this.margin * 2,
      ) as string[];
    this.doc.setTextColor(...color);
    const lineHeight = size * 0.48;
    for (const line of lines) {
      this.ensure(lineHeight + 2);
      this.doc.text(line, this.margin, this.y);
      this.y += lineHeight;
    }
    this.y += 3;
  }
  heading(title: string) {
    this.ensure(15);
    this.y += 4;
    this.doc.setTextColor(...ink);
    this.doc.setFontSize(10);
    this.doc.text(title, this.margin, this.y);
    this.y += 5;
  }
  table(head: string[], body: (string | number)[][], compact = false) {
    autoTable(this.doc, {
      startY: this.y,
      head: [head],
      body,
      margin: { left: this.margin, right: this.margin, top: 18, bottom: 18 },
      theme: "grid",
      styles: {
        font: "OweMe",
        fontStyle: "normal",
        fontSize: this.width < 160 ? 7.5 : 8,
        cellPadding: compact ? 1.35 : this.width < 160 ? 1.8 : 2.4,
        textColor: ink,
        lineColor: [231, 232, 238],
        lineWidth: 0.15,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [245, 245, 255],
        textColor: indigo,
        fontStyle: "normal",
      },
      alternateRowStyles: { fillColor: [250, 250, 252] },
    });
    this.y =
      (this.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 6;
  }
  async signatureBoxes(
    items: { label: string; name: string; signature?: SignatureRef }[],
    include = true,
  ) {
    this.ensure(44);
    const available = this.width - this.margin * 2;
    const gap = 4;
    const width = (available - gap * (items.length - 1)) / items.length;
    for (const [index, item] of items.entries()) {
      const x = this.margin + index * (width + gap);
      this.doc.setDrawColor(210, 212, 224);
      this.doc.setLineWidth(0.2);
      this.doc.rect(x, this.y, width, 26);
      // Small corner markers also make the paper boxes easy to crop after signing.
      this.doc.setDrawColor(...ink);
      this.doc.setLineWidth(0.6);
      for (const [cx, cy, dx, dy] of [
        [x, this.y, 1, 1],
        [x + width, this.y, -1, 1],
        [x, this.y + 26, 1, -1],
        [x + width, this.y + 26, -1, -1],
      ]) {
        this.doc.line(cx, cy, cx + dx * 3, cy);
        this.doc.line(cx, cy, cx, cy + dy * 3);
      }
      if (include && item.signature) {
        try {
          const data = await blobData(item.signature.processed);
          const image = this.doc.getImageProperties(data);
          const scale = Math.min((width - 6) / image.width, 20 / image.height);
          this.doc.addImage(
            data,
            "PNG",
            x + (width - image.width * scale) / 2,
            this.y + (26 - image.height * scale) / 2,
            image.width * scale,
            image.height * scale,
            undefined,
            "FAST",
          );
        } catch {
          /* Keep the printed signature box usable when the optional image cannot decode. */
        }
      }
      this.doc.setTextColor(...muted);
      this.doc.setFontSize(7);
      this.doc.text(item.label, x, this.y + 31);
      this.doc.setTextColor(...ink);
      this.doc.text(publicText(item.name), x, this.y + 35, { maxWidth: width });
    }
    this.y += 42;
  }
  file(name: string, settings: Settings): File {
    const count = this.doc.getNumberOfPages();
    for (let page = 1; page <= count; page++) {
      this.doc.setPage(page);
      this.doc.setTextColor(...muted);
      this.doc.setFontSize(7);
      this.doc.text(`OweMe · ${page} / ${count}`, this.margin, this.height - 9);
      this.doc.text(
        publicText(
          settings.receiptFooter ||
            "Thank you. Please keep this document for your records.",
        ),
        this.width - this.margin,
        this.height - 9,
        { align: "right", maxWidth: this.width - this.margin * 2 - 35 },
      );
    }
    this.doc.setProperties({
      title: name.replace(".pdf", ""),
      author: publicText(settings.business.name),
      creator: "OweMe",
    });
    return new File([this.doc.output("blob")], name, {
      type: "application/pdf",
    });
  }
}

export interface ReportDocument {
  from: string;
  to: string;
  asOf: string;
  metrics: [string, string][];
  channels: [string, string][];
  aging: [string, string][];
  notes: string[];
}

/** Owner-only report; offline font and table pagination match account statements. */
export async function reportPDF(
  settings: Settings,
  report: ReportDocument,
): Promise<File> {
  const layout = new Layout({ format: "a4" });
  await layout.init(settings, "Private financial report");
  layout.paragraph(
    `${report.from || "All history"} to ${report.to || "present"} · Current balances as of ${report.asOf} (Asia/Manila).`,
    8.5,
    muted,
  );
  layout.table(["Metric", "Amount / count"], report.metrics);
  layout.heading("Payment channels · selected range");
  layout.table(
    ["Channel", "Cash collected"],
    report.channels.length
      ? report.channels
      : [["No collections", formatMoney(0)]],
  );
  layout.heading("Overdue aging · current contractual obligations");
  layout.table(["Days past due", "Unpaid amount"], report.aging);
  layout.heading("Definitions and limitations");
  for (const note of report.notes) layout.paragraph(note, 8, muted);
  layout.paragraph(
    "Private owner report. Review before sharing; borrower records and local backups contain personal information.",
    8,
    muted,
  );
  return layout.file(`OweMe-report-${report.asOf}.pdf`, settings);
}

export async function receiptPDF(
  txn: Transaction,
  loan: Loan,
  settings: Settings,
  options: DocumentOptions = {},
): Promise<File> {
  const layout = new Layout({ format: "a5", ...options });
  await layout.init(
    settings,
    txn.type === "ADVANCE"
      ? "Advance receipt"
      : txn.type === "VOID"
        ? "Void confirmation"
        : txn.type === "RELEASE"
          ? "Release receipt"
          : "Payment receipt",
  );
  const time = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(txn.createdAt));
  layout.paragraph(`Recorded ${time} · Asia/Manila`, 7.5, muted);
  if (options.voided)
    layout.paragraph(
      "VOIDED - retained for history. This transaction has been reversed.",
      9,
      [172, 52, 65],
    );
  const rows = receiptLines(txn, loan, settings).filter(
    ([label]) =>
      !txn.advance ||
      !["Amount", "Balance before", "Balance after"].includes(label),
  );
  layout.table(["Detail", "Value"], rows);
  if (txn.advance)
    layout.table(
      ["Advance details", "Amount"],
      [
        ["Balance carried", formatMoney(txn.advance.carriedBalance)],
        ["Additional face amount", formatMoney(txn.advance.advanceFace)],
        ["Interest on advance", formatMoney(txn.advance.interest)],
        ["Cash handed over", formatMoney(txn.advance.netCash)],
        ["New total to repay", formatMoney(txn.advance.newFace)],
      ],
    );
  if (txn.allocation.length) {
    layout.heading("Payment allocation");
    layout.table(
      ["Installment", "Applied"],
      txn.allocation.map((row) => [
        String(row.installmentNo),
        formatMoney(row.amount),
      ]),
    );
  }
  if (txn.notes) layout.paragraph(publicText(txn.notes), 8, muted);
  const { payer, receiver } = receiptSignatures(txn, loan);
  if (options.includeSignatures !== false && (payer || receiver))
    await layout.signatureBoxes([
      {
        label: "Payer / borrower",
        name:
          txn.signatures?.payer?.signerName || txn.borrowerSnapshot.fullName,
        signature: payer,
      },
      {
        label: "Received / issued by",
        name: txn.receivedBy,
        signature: receiver,
      },
    ]);
  return layout.file(`${txn.txnNo}.pdf`, settings);
}

export async function loanSlipPDF(
  loan: Loan,
  txn: Transaction,
  settings: Settings,
  options: DocumentOptions = {},
): Promise<File> {
  const issuedSettings = loan.businessSnapshot
    ? { ...settings, business: loan.businessSnapshot }
    : settings;
  const layout = new Layout(options);
  await layout.init(
    issuedSettings,
    loan.kind === "advance" ? "Advance loan agreement" : "Loan agreement",
  );
  if (options.voided)
    layout.paragraph(
      "VOIDED - retained for history. This advance has been reversed.",
      9,
      [172, 52, 65],
    );
  layout.table(
    ["Detail", "Agreement"],
    [
      [
        "Borrower",
        `${publicText(loan.borrowerSnapshot.fullName)} · #${borrowerNumber(loan.borrowerSnapshot.numericId, settings.borrowerPrefix)}`,
      ],
      ["Loan / transaction", `${loan.loanNo} · ${txn.txnNo}`],
      ["Release date", loan.releaseDate],
      ...(txn.advance
        ? [
            ["Balance carried", formatMoney(txn.advance.carriedBalance)],
            ["Additional face amount", formatMoney(txn.advance.advanceFace)],
          ]
        : []),
      ...(loan.borrowerSnapshot.address
        ? [["Borrower address", publicText(loan.borrowerSnapshot.address)]]
        : []),
      ["Actual cash released", formatMoney(loan.netRelease)],
      ["One-time finance charge", formatMoney(loan.interestAmount)],
      ["Face amount / total repayable", formatMoney(loan.faceAmount)],
      ["Late fees", "Zero. No automatic late charges."],
      ["Term", `${loan.termMonths} month${loan.termMonths === 1 ? "" : "s"}`],
      ["Monthly payment", formatMoney(loan.monthlyAmount)],
    ],
    true,
  );
  const cost =
    loan.kind === "new"
      ? loanCost(
          loan.netRelease,
          loan.interestAmount,
          loan.releaseDate,
          loan.installments,
        )
      : undefined;
  layout.paragraph(
    `${(loan.rate * 100).toFixed(2)}% is a one-time ${loan.interestMode === "upfront" ? "deduction of face value" : "add-on charge on cash released"} for the entire term, not a monthly rate or APR.${cost ? ` Cost relative to cash received: ${cost.costOfCashPercent.toFixed(2)}%. Estimated effective annual cash-flow yield: ${cost.effectiveAnnualPercent.toFixed(2)}% (Actual/365); this is an explanatory estimate, not a statutory APR.` : ""}`,
    8,
    muted,
  );
  layout.heading("Official payment schedule");
  layout.table(
    ["No.", "Due date", "Amount due"],
    loan.installments.map((item) => [
      item.no,
      item.dueDate,
      formatMoney(item.amountDue),
    ]),
    true,
  );
  if (loan.autoNote) layout.paragraph(publicText(loan.autoNote), 8, muted);
  layout.heading("Acknowledgement");
  layout.paragraph(
    publicText(
      (loan.agreementTextSnapshot ?? settings.agreementText) ||
        "I understand the payment terms above and acknowledge that I received the cash amount shown. Nauunawaan ko ang kasunduan at natanggap ko ang halagang nakasaad.",
    ),
  );
  await layout.signatureBoxes(
    [
      {
        label: "Borrower",
        name: loan.borrowerSnapshot.fullName,
        signature: loan.signatures.borrower,
      },
      {
        label: "Issued / received by",
        name: loan.releasedBy,
        signature: loan.signatures.admin,
      },
      {
        label: "Witness (optional)",
        name: loan.signatures.witness?.signerName || "",
        signature: loan.signatures.witness,
      },
    ],
    options.includeSignatures !== false,
  );
  return layout.file(`${loan.loanNo}-agreement.pdf`, settings);
}

export async function statementPDF(
  borrower: Borrower,
  loans: Loan[],
  transactions: Transaction[],
  settings: Settings,
  options: DocumentOptions = {},
): Promise<File> {
  const ownLoans = loans.filter((loan) => loan.borrowerId === borrower.id);
  const ownTransactions = transactions.filter(
    (txn) => txn.borrowerId === borrower.id,
  );
  const inRange = (date: string) =>
    (!options.from || date >= options.from) &&
    (!options.to || date <= options.to);
  const filtered = ownTransactions
    .filter((txn) => inRange(txn.date))
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.txnNo.localeCompare(b.txnNo),
    );
  const reversed = new Set(
    ownTransactions
      .filter((txn) => txn.type === "VOID")
      .map((txn) => txn.voidOf),
  );
  const valid = filtered.filter((txn) => !reversed.has(txn.id));
  const released = valid
    .filter((txn) => txn.type === "RELEASE" || txn.type === "ADVANCE")
    .reduce((sum, txn) => sum + (txn.advance?.netCash ?? txn.amount), 0);
  const repaid = valid
    .filter((txn) => txn.type === "PAYMENT")
    .reduce((sum, txn) => sum + txn.amount, 0);
  const remaining = ownLoans.reduce((sum, loan) => sum + balance(loan), 0);
  const rating = borrowerRating(ownLoans, undefined, settings.scoring);
  const layout = new Layout(options);
  await layout.init(settings, "Statement of account");
  layout.paragraph(
    `${publicText(borrower.fullName)} · #${borrowerNumber(borrower.numericId, settings.borrowerPrefix)}`,
    12,
  );
  layout.paragraph(
    `${publicText(borrower.address)}${borrower.contact ? "\n" + publicText(borrower.contact) : ""}`,
    8.5,
    muted,
  );
  layout.paragraph(
    `Period: ${options.from || "Beginning"} to ${options.to || "present"}`,
    8.5,
    muted,
  );
  layout.table(
    ["Summary", "Amount"],
    [
      ["Cash released in period", formatMoney(released)],
      ["Payments in period", formatMoney(repaid)],
      ["Current outstanding balance", formatMoney(remaining)],
      [
        "Performance rating",
        rating.stars === null ? "New" : `${rating.stars.toFixed(1)} / 5.0`,
      ],
    ],
  );
  layout.heading("Loans and advances");
  const visibleLoans = ownLoans.filter(
    (loan) =>
      inRange(loan.releaseDate) ||
      filtered.some((txn) => txn.loanId === loan.id),
  );
  if (!visibleLoans.length)
    layout.paragraph("No loans in this date range.", 8.5, muted);
  for (const loan of visibleLoans) {
    layout.heading(
      `${loan.loanNo} · ${loan.kind === "advance" ? "Advance · " : ""}${loan.status}`,
    );
    layout.table(
      ["Released", "Face amount", "Cash released", "Current balance"],
      [
        [
          loan.releaseDate,
          formatMoney(loan.faceAmount),
          formatMoney(loan.netRelease),
          formatMoney(balance(loan)),
        ],
      ],
    );
    if (loan.mergedIntoLoanId)
      layout.paragraph(
        `Merged into ${ownLoans.find((next) => next.id === loan.mergedIntoLoanId)?.loanNo || "a later loan"}. Earlier payments remain in the history.`,
        8,
        muted,
      );
    if (loan.autoNote) layout.paragraph(publicText(loan.autoNote), 8, muted);
    layout.table(
      ["No.", "Official due date", "Due", "Paid"],
      loan.installments.map((i) => [
        i.no,
        i.dueDate,
        formatMoney(i.amountDue),
        formatMoney(i.amountPaid),
      ]),
    );
    if (options.includeSignatures && loan.signatures.borrower)
      await layout.signatureBoxes([
        {
          label: "Borrower signature",
          name: borrower.fullName,
          signature: loan.signatures.borrower,
        },
        {
          label: "Issued by",
          name: loan.releasedBy,
          signature: loan.signatures.admin,
        },
      ]);
  }
  layout.heading("Transaction history");
  if (!filtered.length)
    layout.paragraph("No transactions in this date range.", 8.5, muted);
  else
    layout.table(
      ["Date / number", "Type", "Method / reference", "Amount"],
      filtered.map((txn) => [
        `${txn.date}\n${txn.txnNo}`,
        `${txn.type}${reversed.has(txn.id) ? " (voided)" : ""}`,
        publicText(
          [txn.method?.toUpperCase(), txn.bankName, txn.referenceNo]
            .filter(Boolean)
            .join(" · "),
        ),
        formatMoney(txn.amount),
      ]),
    );
  return layout.file(
    `OweMe-${borrowerNumber(borrower.numericId)}-statement.pdf`,
    settings,
  );
}

export async function receiptImage(
  txn: Transaction,
  loan: Loan,
  settings: Settings,
  options: DocumentOptions = {},
): Promise<File> {
  const rows = receiptLines(txn, loan, settings);
  if (txn.advance)
    rows.push(
      ["Balance carried", formatMoney(txn.advance.carriedBalance)],
      ["Additional face amount", formatMoney(txn.advance.advanceFace)],
      ["Interest on advance", formatMoney(txn.advance.interest)],
      ["Cash handed over", formatMoney(txn.advance.netCash)],
      ["New total to repay", formatMoney(txn.advance.newFace)],
      ["New term", `${txn.advance.newTerm} months`],
      ["New monthly payment", formatMoney(txn.advance.newMonthly)],
    );
  for (const item of txn.allocation)
    rows.push([`Installment ${item.installmentNo}`, formatMoney(item.amount)]);
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  const ctx = canvas.getContext("2d")!;
  function wrap(value: string, width: number, size = 25): string[] {
    ctx.font = `${size}px Inter, Arial, sans-serif`;
    const lines: string[] = [];
    let line = "";
    for (const word of publicText(value).split(/\s+/)) {
      if (line && ctx.measureText(`${line} ${word}`).width > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }
  const prepared = rows.map(([label, value]) => ({
    label,
    lines: wrap(value, 520),
  }));
  const address = wrap(settings.business.address, 780, 22);
  const note = publicText(txn.notes);
  const notes = note ? wrap(note, 880, 22) : [];
  const footer = wrap(
    settings.receiptFooter ||
      "Thank you. Please keep this receipt for your records.",
    880,
    21,
  );
  const receiptSigs = receiptSignatures(txn, loan);
  const signatures =
    options.includeSignatures === false
      ? []
      : [
          { signature: receiptSigs.payer, label: "Borrower / payer" },
          {
            signature: receiptSigs.receiver,
            label: publicText(txn.receivedBy) || "Received by",
          },
        ].filter((item) => item.signature);
  canvas.height =
    240 +
    address.length * 28 +
    prepared.reduce(
      (sum, row) => sum + Math.max(1, row.lines.length) * 33 + 24,
      0,
    ) +
    notes.length * 30 +
    footer.length * 27 +
    (signatures.length ? 170 : 0) +
    80;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#5b5cff";
  ctx.fillRect(0, 0, canvas.width, 10);
  ctx.fillStyle = "#111827";
  ctx.font = "600 40px Inter, Arial, sans-serif";
  ctx.fillText(publicText(settings.business.name) || "OweMe", 60, 85, 780);
  if (settings.business.logo) {
    try {
      const logo = await loadImage(settings.business.logo);
      const scale = Math.min(70 / logo.naturalWidth, 70 / logo.naturalHeight);
      ctx.drawImage(
        logo,
        870,
        40,
        logo.naturalWidth * scale,
        logo.naturalHeight * scale,
      );
    } catch {
      /* Optional logo does not block the receipt. */
    }
  }
  let y = 125;
  ctx.font = "22px Inter, Arial, sans-serif";
  ctx.fillStyle = "#6b7280";
  for (const line of address) {
    ctx.fillText(line, 60, y, 880);
    y += 28;
  }
  ctx.font = "28px Inter, Arial, sans-serif";
  ctx.fillStyle = options.voided ? "#ac3441" : "#6b7280";
  ctx.fillText(
    (options.voided ? "VOIDED · " : "") +
      (txn.type === "ADVANCE"
        ? "Advance receipt"
        : txn.type === "RELEASE"
          ? "Release receipt"
          : txn.type === "VOID"
            ? "Void confirmation"
            : "Payment receipt"),
    60,
    y + 16,
  );
  y += 75;
  for (const row of prepared) {
    ctx.font = "23px Inter, Arial, sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(row.label, 60, y, 330);
    ctx.fillStyle = "#111827";
    ctx.font = "500 25px Inter, Arial, sans-serif";
    for (const [index, line] of row.lines.entries())
      ctx.fillText(line, 420, y + index * 33, 520);
    y += row.lines.length * 33 + 24;
  }
  if (notes.length) {
    ctx.font = "22px Inter, Arial, sans-serif";
    ctx.fillStyle = "#6b7280";
    y += 10;
    for (const line of notes) {
      ctx.fillText(line, 60, y, 880);
      y += 30;
    }
  }
  if (signatures.length) {
    y += 15;
    for (const [index, item] of signatures.entries()) {
      if (item.signature) {
        const image = await loadImage(item.signature.processed);
        const scale = Math.min(
          360 / image.naturalWidth,
          95 / image.naturalHeight,
        );
        ctx.drawImage(
          image,
          60 + index * 440,
          y,
          image.naturalWidth * scale,
          image.naturalHeight * scale,
        );
      }
      ctx.font = "21px Inter, Arial, sans-serif";
      ctx.fillStyle = "#6b7280";
      ctx.fillText(item.label, 60 + index * 440, y + 125, 400);
    }
    y += 170;
  }
  y += 20;
  ctx.fillStyle = "#6b7280";
  ctx.font = "21px Inter, Arial, sans-serif";
  for (const line of footer) {
    ctx.fillText(line, 60, y, 880);
    y += 27;
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], `${txn.txnNo}.png`, { type: "image/png" }))
          : reject(new Error("Could not create a receipt image.")),
      "image/png",
    ),
  );
}
