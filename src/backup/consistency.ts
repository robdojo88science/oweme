import { allocatePayment, balance } from "../core/logic";
import type { Installment, Loan, Transaction } from "../core/model";
import type { BackupData, BackupRecord } from "./format";

export class FinancialMergeConflict extends Error {
  constructor(detail: string) {
    super(
      `Cannot safely merge: ${detail} Your local records are unchanged. Keep both full backups and review the authoritative history before using Restore Replace; do not combine divergent payments automatically.`,
    );
    this.name = "FinancialMergeConflict";
  }
}
function fail(detail: string): never {
  throw new FinancialMergeConflict(detail);
}
const fields = (row: BackupRecord, keys: string[]) =>
  JSON.stringify(keys.map((key) => row[key] ?? null));
const transactionFields = [
  "createdAt",
  "loanId",
  "borrowerId",
  "type",
  "amount",
  "date",
  "balanceBefore",
  "balanceAfter",
  "unappliedAmount",
  "voidOf",
  "voidReason",
  "method",
  "bankName",
  "receivedBy",
];
const loanFields = [
  "createdAt",
  "borrowerId",
  "incomeAtLoan",
  "termMonths",
  "rate",
  "interestMode",
  "faceAmount",
  "interestAmount",
  "netRelease",
  "monthlyAmount",
  "releaseDate",
  "kind",
  "parentLoanId",
  "carriedBalance",
  "advanceFace",
];
const contract = (row: BackupRecord) =>
  JSON.stringify(
    (Array.isArray(row.installments) ? row.installments : []).map(
      (i: Installment) => [i.no, i.dueDate, i.graceUntil, i.amountDue],
    ),
  );
function advanceTerms(value: unknown): string {
  const d = value as Transaction["advance"];
  return JSON.stringify(
    d
      ? [
          d.mode,
          d.carriedBalance,
          d.advanceFace,
          d.interest,
          d.netCash,
          d.newFace,
          d.newTerm,
          d.newMonthly,
          d.previousLoanId,
          d.newLoanId,
          d.schedule?.map((i) => [i.no, i.dueDate, i.graceUntil, i.amountDue]),
          d.previousInstallments?.map((i) => [
            i.no,
            i.dueDate,
            i.graceUntil,
            i.amountDue,
            i.amountPaid,
            i.paidDate ?? null,
          ]),
        ]
      : null,
  );
}
function anonymized(row: BackupRecord, tables: BackupData) {
  const snapshot = row.borrowerSnapshot as { fullName?: string } | undefined;
  return Boolean(
    snapshot?.fullName?.startsWith("Anonymized borrower ") &&
    tables.tombstones.some(
      (marker) =>
        ["borrower", "borrowers"].includes(String(marker.entity)) &&
        marker.entityId === row.borrowerId &&
        String(marker.deletedAt) >= String(row.createdAt),
    ),
  );
}

/** A financial UUID identifies one immutable entry, never a last-write-wins money edit. */
export function assertSafeFinancialMerge(
  local: BackupData,
  incoming: BackupData,
): void {
  const existingTransactions = new Map(
    local.transactions.map((row) => [row.id, row]),
  );
  for (const row of incoming.transactions) {
    const old = existingTransactions.get(row.id);
    if (!old) continue;
    const allocation = (record: BackupRecord) =>
      JSON.stringify(
        (
          (record.allocation as { installmentNo: number; amount: number }[]) ||
          []
        ).map((a) => [a.installmentNo, a.amount]),
      );
    if (
      fields(old, transactionFields) !== fields(row, transactionFields) ||
      allocation(old) !== allocation(row) ||
      advanceTerms(old.advance) !== advanceTerms(row.advance)
    )
      fail(
        `transaction ${old.txnNo} has different immutable financial details for the same UUID.`,
      );
    if (
      old.referenceNo !== row.referenceNo &&
      !anonymized(old, local) &&
      !anonymized(row, incoming)
    )
      fail(
        `transaction ${old.txnNo} has a changed external payment reference for the same UUID.`,
      );
  }
  const existingLoans = new Map(local.loans.map((row) => [row.id, row]));
  const all = new Map(
    [...local.transactions, ...incoming.transactions].map((row) => [
      row.id,
      row,
    ]),
  );
  const affected = (tables: BackupData, loanId: string) =>
    new Set(
      tables.transactions
        .filter((t) => {
          const original = t.type === "VOID" ? all.get(String(t.voidOf)) : t;
          const advance = original?.advance as Transaction["advance"];
          return (
            t.loanId === loanId ||
            (advance?.mode === "merge" && advance.previousLoanId === loanId)
          );
        })
        .map((t) => t.id),
    );
  for (const row of incoming.loans) {
    const old = existingLoans.get(row.id);
    if (!old) continue;
    if (
      fields(old, loanFields) !== fields(row, loanFields) ||
      contract(old) !== contract(row)
    )
      fail(
        `loan ${old.loanNo} has different signed amounts or contractual dates for the same UUID.`,
      );
    if (
      old.agreementTextSnapshot !== undefined &&
      row.agreementTextSnapshot !== undefined &&
      old.agreementTextSnapshot !== row.agreementTextSnapshot
    )
      fail(`loan ${old.loanNo} has different signed agreement text.`);
    const a = affected(local, row.id),
      b = affected(incoming, row.id);
    if ([...a].some((id) => !b.has(id)) && [...b].some((id) => !a.has(id)))
      fail(
        `loan ${old.loanNo} has payments or advance corrections recorded independently on both devices.`,
      );
  }
}

/** Verify final stored balances against a replay; never rewrite historical receipt snapshots. */
export function assertLedgerConsistency(tables: BackupData): void {
  const loans = tables.loans as unknown as Loan[];
  const transactions = tables.transactions as unknown as Transaction[];
  const transactionMap = new Map(transactions.map((t) => [t.id, t]));
  const loanMap = new Map(loans.map((l) => [l.id, l]));
  const reversed = new Set<string>();
  for (const reversal of transactions.filter((t) => t.type === "VOID")) {
    const original = transactionMap.get(reversal.voidOf || "");
    if (
      !original ||
      !["PAYMENT", "ADVANCE", "RELEASE"].includes(original.type) ||
      reversed.has(original.id) ||
      reversal.amount !== original.amount ||
      reversal.date < original.date ||
      reversal.loanId !== original.loanId
    )
      fail(
        `reversal ${reversal.txnNo} does not match one original cash entry.`,
      );
    reversed.add(original.id);
  }
  const valid = transactions.filter(
    (t) => t.type !== "VOID" && !reversed.has(t.id),
  );
  for (const loan of loans) {
    const own = transactions.filter((t) => t.loanId === loan.id);
    const releases = own.filter(
      (t) => t.type === "RELEASE" || t.type === "ADVANCE",
    );
    if (
      releases.length !== 1 ||
      releases[0].amount !== loan.netRelease ||
      releases[0].date !== loan.releaseDate ||
      releases[0].borrowerId !== loan.borrowerId
    )
      fail(`loan ${loan.loanNo} is missing its matching cash release.`);
    const release = releases[0];
    if ((loan.kind === "advance") !== (release.type === "ADVANCE"))
      fail(`loan ${loan.loanNo} has a mismatched release type.`);
    if (own.some((t) => t.type === "ADJUSTMENT"))
      fail(
        `loan ${loan.loanNo} contains an adjustment that needs owner review before reconciliation.`,
      );
    const payments = valid
      .filter((t) => t.loanId === loan.id && t.type === "PAYMENT")
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.txnNo.localeCompare(b.txnNo),
      );
    let replay: Installment[] = loan.installments.map((i) => ({
      no: i.no,
      dueDate: i.dueDate,
      graceUntil: i.graceUntil,
      amountDue: i.amountDue,
      amountPaid: 0,
      status: "Upcoming",
    }));
    for (const payment of payments) {
      if (
        payment.date < loan.releaseDate ||
        payment.borrowerId !== loan.borrowerId
      )
        fail(`payment ${payment.txnNo} does not match its loan.`);
      replay = allocatePayment(
        replay,
        payment.allocation.reduce(
          (sum, allocation) => sum + allocation.amount,
          0,
        ),
        payment.date,
      ).installments;
    }
    if (
      loan.installments.some((i) => {
        const expected = replay.find((p) => p.no === i.no);
        return (
          !expected ||
          i.amountPaid !== expected.amountPaid ||
          (i.paidDate || "") !== (expected.paidDate || "")
        );
      })
    )
      fail(
        `loan ${loan.loanNo} installment balances disagree with its immutable payment history.`,
      );
    const merged = valid.filter(
      (t) =>
        t.type === "ADVANCE" &&
        t.advance?.mode === "merge" &&
        t.advance.previousLoanId === loan.id,
    );
    if (merged.length > 1)
      fail(`loan ${loan.loanNo} was merged into multiple live advances.`);
    if (loan.status === "voided") {
      if (!reversed.has(release.id) || payments.length || merged.length)
        fail(`voided loan ${loan.loanNo} still has live financial activity.`);
    } else if (reversed.has(release.id))
      fail(`loan ${loan.loanNo} is active although its advance was reversed.`);
    else if (merged.length) {
      const onward = merged[0].advance!;
      if (
        loan.status !== "merged" ||
        loan.mergedIntoLoanId !== onward.newLoanId ||
        onward.carriedBalance !== balance({ installments: replay }) ||
        !loanMap.has(onward.newLoanId) ||
        payments.some((t) => t.date > merged[0].date)
      )
        fail(
          `loan ${loan.loanNo} has an inconsistent carried balance or advance link.`,
        );
    } else if (
      loan.status !==
        (balance({ installments: replay }) === 0 ? "completed" : "active") ||
      loan.mergedIntoLoanId
    )
      fail(`loan ${loan.loanNo} status disagrees with its ledger balance.`);
    if (release.advance) {
      const a = release.advance;
      if (
        !loanMap.has(a.previousLoanId) ||
        a.newLoanId !== loan.id ||
        a.newFace !== loan.faceAmount ||
        a.netCash !== loan.netRelease ||
        a.interest !== loan.interestAmount ||
        a.newTerm !== loan.termMonths ||
        a.advanceFace !== loan.advanceFace ||
        (a.mode === "merge" && a.carriedBalance !== loan.carriedBalance)
      )
        fail(
          `advance ${release.txnNo} has inconsistent agreement amounts or loan links.`,
        );
    }
  }
}

export interface AccountingTotals {
  outstanding: number;
  released: number;
  collected: number;
  loans: number;
  transactions: number;
}
export function accountingTotals(tables: BackupData): AccountingTotals {
  const reversed = new Set(
    tables.transactions.filter((t) => t.type === "VOID").map((t) => t.voidOf),
  );
  const valid = tables.transactions.filter(
    (t) => t.type !== "VOID" && !reversed.has(t.id),
  );
  return {
    outstanding: (tables.loans as unknown as Loan[]).reduce(
      (sum, loan) => sum + balance(loan),
      0,
    ),
    released: valid
      .filter((t) => ["RELEASE", "ADVANCE"].includes(String(t.type)))
      .reduce((sum, t) => sum + Number(t.amount), 0),
    collected: valid
      .filter((t) => t.type === "PAYMENT")
      .reduce((sum, t) => sum + Number(t.amount), 0),
    loans: tables.loans.length,
    transactions: tables.transactions.length,
  };
}
