import type { Borrower, Loan, Settings, Transaction } from "../core/model";
import { addDays, balance, borrowerNumber, formatMoney } from "../core/logic";

/** Borrower-facing exports deliberately select public fields; internal statuses never pass through. */
export function publicText(value = ""): string {
  return value
    .split(/(?<=[.!?])\s+|\r?\n/)
    .filter(
      (line) =>
        !/\b(?:mercy\s+(?:period|days)|grace\s+(?:period|days)|graceUntil|graceDays)\b/i.test(
          line,
        ),
    )
    .join("\n")
    .trim();
}

export function receiptLines(
  txn: Transaction,
  loan: Loan,
  settings: Settings,
): [string, string][] {
  const rows: [string, string][] = [
    ["Receipt number", txn.txnNo],
    ["Date", txn.date],
    [
      "Borrower",
      `${publicText(txn.borrowerSnapshot.fullName)} · #${borrowerNumber(txn.borrowerSnapshot.numericId, settings.borrowerPrefix)}`,
    ],
    ["Loan", loan.loanNo],
    ["Type", txn.type],
    ["Amount", formatMoney(txn.amount)],
    ["Method", txn.method ? txn.method.toUpperCase() : "Cash release"],
  ];
  if (txn.bankName) rows.push(["Bank / provider", publicText(txn.bankName)]);
  if (txn.referenceNo) rows.push(["Reference", publicText(txn.referenceNo)]);
  rows.push(
    ["Balance before", formatMoney(txn.balanceBefore)],
    ["Balance after", formatMoney(txn.balanceAfter)],
  );
  if (txn.nextDueDate && txn.balanceAfter > 0)
    rows.push(["Next official due date", txn.nextDueDate]);
  rows.push(["Received / issued by", publicText(txn.receivedBy)]);
  if (txn.unappliedAmount)
    rows.push(["Unapplied credit", formatMoney(txn.unappliedAmount)]);
  if (txn.type === "VOID")
    rows.push(["Void reason", publicText(txn.voidReason)]);
  return rows;
}

export function receiptSignatures(txn: Transaction, loan?: Loan) {
  const isRelease = txn.type === "RELEASE" || txn.type === "ADVANCE";
  return {
    payer:
      txn.signatures?.payer ||
      (isRelease ? loan?.signatures.borrower : undefined),
    receiver:
      txn.signatures?.receiver ||
      (isRelease ? loan?.signatures.admin : undefined),
  };
}

export function borrowerSummary(
  borrower: Borrower,
  loans: Loan[],
  settings: Settings,
): string {
  const own = loans.filter((loan) => loan.borrowerId === borrower.id);
  const outstanding = own.reduce((sum, loan) => sum + balance(loan), 0);
  const next = own
    .filter((loan) => loan.status === "active")
    .flatMap((loan) => loan.installments)
    .filter((i) => i.amountPaid < i.amountDue && i.status !== "rolled_over")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return `${publicText(settings.business.name)}\n${publicText(borrower.fullName)} · #${borrowerNumber(borrower.numericId, settings.borrowerPrefix)}\nOutstanding balance: ${formatMoney(outstanding)}${next ? `\nNext due: ${next.dueDate} · ${formatMoney(next.amountDue - next.amountPaid)}` : "\nNo upcoming payment."}`;
}

export function reminderText(
  borrower: Borrower,
  loan: Loan,
  settings: Settings,
): string {
  const next = loan.installments.find(
    (i) => i.amountPaid < i.amountDue && i.status !== "rolled_over",
  );
  const template =
    settings.reminderTemplate ||
    "Hello {name}, a friendly reminder: your payment of {amount} is due on {dueDate}. Thank you! - {business}";
  return publicText(
    template
      .replaceAll("{name}", borrower.fullName)
      .replaceAll(
        "{amount}",
        formatMoney(next ? next.amountDue - next.amountPaid : balance(loan)),
      )
      .replaceAll("{dueDate}", next?.dueDate || loan.releaseDate)
      .replaceAll("{date}", next?.dueDate || loan.releaseDate)
      .replaceAll("{business}", settings.business.name)
      .replaceAll("{loanNo}", loan.loanNo)
      .replaceAll("{loan}", loan.loanNo),
  );
}

function icsEscape(value: string): string {
  return publicText(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 73) {
      lines.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += bytes;
  }
  lines.push(current);
  return lines.join("\r\n");
}
export function calendarText(
  loans: Loan[],
  settings: Settings,
  borrowers: Borrower[] = [],
  from?: string,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OweMe//Payment schedules//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(settings.business.name)} payments`,
  ];
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  for (const loan of loans.filter((l) => l.status === "active")) {
    const borrower = borrowers.find((b) => b.id === loan.borrowerId);
    for (const item of loan.installments.filter(
      (i) =>
        i.amountPaid < i.amountDue &&
        i.status !== "rolled_over" &&
        (!from || i.dueDate >= from),
    )) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${loan.id}-${item.no}@oweme.local`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${item.dueDate.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${addDays(item.dueDate, 1).replaceAll("-", "")}`,
        `SUMMARY:${icsEscape(`${borrower?.fullName || loan.borrowerSnapshot.fullName} - ${formatMoney(item.amountDue - item.amountPaid)}`)}`,
        `DESCRIPTION:${icsEscape(`${loan.loanNo} · installment ${item.no}\nOfficial due date: ${item.dueDate}\n${settings.business.name}`)}`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
export function calendarFile(
  loans: Loan[],
  settings: Settings,
  borrowers: Borrower[] = [],
  from?: string,
): File {
  return new File(
    [calendarText(loans, settings, borrowers, from)],
    "OweMe-payment-schedule.ics",
    { type: "text/calendar;charset=utf-8" },
  );
}
