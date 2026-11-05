import type {
  Allocation,
  Installment,
  InstallmentStatus,
  InterestMode,
  ScoringSettings,
} from "./model";

export const defaultScoring: ScoringSettings = {
  onTime: 100,
  withinGrace: 85,
  lateBase: 70,
  latePerDay: 4,
  minimum: 10,
  recency: 0.9,
};
const DAY = 86400000;
export function assertCents(value: number, label = "Amount"): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative whole number of centavos.`);
  return value;
}
function assertTerm(term: number) {
  if (!Number.isSafeInteger(term) || term < 1 || term > 120)
    throw new Error("Term must be between 1 and 120 months.");
}
export function parseMoney(input: string | number): number {
  const value = String(input).trim().replace(/,/g, "").replace(/^₱\s*/, "");
  if (!/^\d+(\.\d{0,2})?$/.test(value))
    throw new Error(
      "Enter a positive amount with no more than two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  return assertCents(
    Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))),
  );
}
export function moneyInput(centavos: number): string {
  assertCents(centavos);
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}
export function formatMoney(centavos: number): string {
  const sign = centavos < 0 ? "−" : "";
  const value = Math.abs(centavos);
  return `${sign}₱${Math.floor(value / 100).toLocaleString("en-PH")}.${String(value % 100).padStart(2, "0")}`;
}
export function rateBasisPoints(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > 10)
    throw new Error("Interest rate must be between 0% and 1,000%.");
  const bp = Math.round(rate * 10000);
  if (Math.abs(bp / 10000 - rate) > 0.0000001)
    throw new Error("Interest supports up to two decimal places in percent.");
  return bp;
}
/** Rational half-up rounding; the multiplication itself is exact integer arithmetic. */
export function mulDivRound(
  value: number,
  numerator: number,
  denominator: number,
): number {
  assertCents(value);
  assertCents(numerator);
  if (!Number.isSafeInteger(denominator) || denominator <= 0)
    throw new Error("Invalid calculation denominator.");
  return assertCents(
    Number(
      (BigInt(value) * BigInt(numerator) * 2n + BigInt(denominator)) /
        (2n * BigInt(denominator)),
    ),
  );
}
function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Use a YYYY-MM-DD date.");
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.toISOString().slice(0, 10) !== value)
    throw new Error("Invalid calendar date.");
  return date.getTime();
}
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("Days must be a whole number.");
  return new Date(dateValue(date) + days * DAY).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((dateValue(to) - dateValue(from)) / DAY);
}
export function addMonthsClamped(date: string, months: number): string {
  dateValue(date);
  if (!Number.isInteger(months))
    throw new Error("Months must be a whole number.");
  const [year, month, day] = date.split("-").map(Number);
  const end = new Date(Date.UTC(year, month + months, 0));
  return new Date(
    Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      Math.min(day, end.getUTCDate()),
    ),
  )
    .toISOString()
    .slice(0, 10);
}
export function schedule(
  face: number,
  term: number,
  releaseDate: string,
  graceDays = 5,
): Installment[] {
  assertCents(face);
  assertTerm(term);
  dateValue(releaseDate);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365)
    throw new Error("Mercy days must be from 0 to 365.");
  const monthly = Math.floor(face / term);
  return Array.from({ length: term }, (_, i) => {
    const dueDate = addMonthsClamped(releaseDate, i + 1);
    return {
      no: i + 1,
      dueDate,
      graceUntil: addDays(dueDate, graceDays),
      amountDue: i === term - 1 ? face - monthly * (term - 1) : monthly,
      amountPaid: 0,
      status: "Upcoming",
    };
  });
}
export interface LoanQuoteInput {
  income: number;
  term: number;
  rate: number;
  interestMode: InterestMode;
  amount?: number;
  inputMode?: "face" | "cash";
}
export function quoteLoan(input: LoanQuoteInput) {
  const { income, term, rate, interestMode } = input;
  assertCents(income, "Income");
  assertTerm(term);
  const bp = rateBasisPoints(rate);
  if (interestMode === "upfront" && bp >= 10000)
    throw new Error("Upfront interest must be below 100%.");
  const maxFace = assertCents(income * term);
  const amount = assertCents(input.amount ?? maxFace);
  const cashInput =
    input.inputMode === "cash" ||
    (input.inputMode === undefined &&
      interestMode === "added" &&
      input.amount !== undefined);
  let face: number, netRelease: number, interest: number;
  if (cashInput) {
    netRelease = amount;
    face =
      interestMode === "upfront"
        ? mulDivRound(amount, 10000, 10000 - bp)
        : mulDivRound(amount, 10000 + bp, 10000);
    interest = face - netRelease;
  } else {
    face = amount;
    if (interestMode === "upfront") {
      interest = mulDivRound(face, bp, 10000);
      netRelease = face - interest;
    } else {
      netRelease = mulDivRound(face, 10000, 10000 + bp);
      interest = face - netRelease;
    }
  }
  return {
    maxFace,
    face,
    faceAmount: face,
    interest,
    interestAmount: interest,
    netRelease,
    monthly: Math.floor(face / term),
    monthlyAmount: Math.floor(face / term),
    capExceeded: face > maxFace,
  };
}
export interface AdvanceQuoteInput {
  balance: number;
  allOutstanding?: number;
  income: number;
  term: number;
  rate: number;
  interestMode: InterestMode;
  amount: number;
  inputMode: "face" | "cash";
  mode: "merge" | "separate";
  releaseDate: string;
  graceDays: number;
}
export function quoteAdvance(input: AdvanceQuoteInput) {
  assertCents(input.balance, "Carried balance");
  const q = quoteLoan(input);
  const exposure = assertCents(
    input.mode === "merge"
      ? input.balance
      : (input.allOutstanding ?? input.balance),
    "Outstanding exposure",
  );
  const maxAdvance = Math.max(0, q.maxFace - exposure);
  const newFace =
    input.mode === "merge" ? assertCents(input.balance + q.face) : q.face;
  return {
    carriedBalance: input.balance,
    advanceFace: q.face,
    interest: q.interest,
    netCash: q.netRelease,
    newFace,
    monthly: Math.floor(newFace / input.term),
    maxAdvance,
    capExceeded: exposure + q.face > q.maxFace,
    installments: schedule(
      newFace,
      input.term,
      input.releaseDate,
      input.graceDays,
    ),
    maxFace: q.maxFace,
  };
}
export function installmentStatus(
  item: Installment,
  asOf = today(),
): InstallmentStatus {
  dateValue(asOf);
  if (item.status === "rolled_over") return "rolled_over";
  if (item.amountPaid >= item.amountDue) return "Paid";
  if (asOf > item.graceUntil) return "Overdue";
  if (asOf > item.dueDate) return "Mercy";
  if (item.amountPaid > 0) return "Partial";
  if (asOf === item.dueDate) return "Due today";
  if (daysBetween(asOf, item.dueDate) <= 3) return "Due soon";
  return "Upcoming";
}
export function balance(loan: {
  installments: Installment[];
  status?: string;
}): number {
  if (loan.status === "merged" || loan.status === "voided") return 0;
  return loan.installments.reduce(
    (sum, x) =>
      sum +
      (x.status === "rolled_over"
        ? 0
        : Math.max(0, x.amountDue - x.amountPaid)),
    0,
  );
}
export function allocatePayment(
  installments: Installment[],
  amount: number,
  date: string,
) {
  assertCents(amount);
  dateValue(date);
  if (amount <= 0) throw new Error("Payment must be greater than zero.");
  let remaining = amount;
  const balanceBefore = balance({ installments });
  const allocation: Allocation[] = [];
  const next = [...installments]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.no - b.no)
    .map((item) => {
      const x = { ...item };
      if (x.status === "rolled_over") return x;
      const applied = Math.min(
        remaining,
        Math.max(0, x.amountDue - x.amountPaid),
      );
      if (applied > 0) {
        x.amountPaid += applied;
        remaining -= applied;
        allocation.push({ installmentNo: x.no, amount: applied });
        if (x.amountPaid === x.amountDue) x.paidDate = date;
      }
      x.status = installmentStatus(x, date);
      return x;
    });
  return {
    installments: next,
    allocation,
    balanceBefore,
    balanceAfter: balance({ installments: next }),
    unappliedAmount: remaining,
    completed: balance({ installments: next }) === 0,
  };
}
export function installmentScore(
  item: Installment,
  asOf = today(),
  scoring: ScoringSettings = defaultScoring,
): number | null {
  if (item.amountDue === 0) return null;
  if (item.frozenScore !== undefined) return item.frozenScore;
  if (item.status === "rolled_over") return null;
  if (
    item.amountPaid >= item.amountDue &&
    item.paidDate &&
    item.paidDate <= asOf
  ) {
    if (item.paidDate <= item.dueDate) return scoring.onTime;
    if (item.paidDate <= item.graceUntil) return scoring.withinGrace;
    return Math.max(
      scoring.minimum,
      scoring.lateBase -
        scoring.latePerDay * daysBetween(item.graceUntil, item.paidDate),
    );
  }
  return asOf > item.graceUntil ? 0 : null;
}
export function rollOverInstallments(
  items: Installment[],
  date: string,
  scoring: ScoringSettings = defaultScoring,
): Installment[] {
  return items.map((item) => {
    if (item.amountPaid >= item.amountDue) return { ...item };
    const score = installmentScore(item, date, scoring);
    return {
      ...item,
      status: "rolled_over",
      ...(score !== null ? { frozenScore: score, frozenAt: date } : {}),
    };
  });
}
export function borrowerRating(
  loans: { installments: Installment[]; status?: string }[],
  asOf = today(),
  scoring: ScoringSettings = defaultScoring,
) {
  const scored = loans
    .filter((x) => x.status !== "voided")
    .flatMap((x) => x.installments)
    .map((item) => ({ item, score: installmentScore(item, asOf, scoring) }))
    .filter((x) => x.score !== null)
    .sort(
      (a, b) =>
        b.item.dueDate.localeCompare(a.item.dueDate) || b.item.no - a.item.no,
    );
  if (!scored.length) return { score: null, stars: null, count: 0 };
  let weighted = 0,
    weights = 0;
  scored.forEach((x, n) => {
    const w = scoring.recency ** n;
    weighted += (x.score ?? 0) * w;
    weights += w;
  });
  const score = weighted / weights;
  return {
    score,
    stars: Math.max(0.5, Math.min(5, Math.round(score / 10) / 2)),
    count: scored.length,
  };
}
export function borrowerNumber(id: number, prefix = ""): string {
  return prefix + String(id).padStart(3, "0");
}
export function transactionNumber(date: string, sequence: number): string {
  dateValue(date);
  return `OM-${date.replaceAll("-", "")}-${String(sequence).padStart(4, "0")}`;
}
export function canDeleteBorrower(
  fullName: string,
  confirmation: string,
): boolean {
  return confirmation === `Delete ${fullName}`;
}
export function canClearAll(
  confirmation: string,
  backupSaved: boolean,
  heldMs: number,
): boolean {
  return confirmation === "DELETE ALL DATA" && backupSaved && heldMs >= 3000;
}
