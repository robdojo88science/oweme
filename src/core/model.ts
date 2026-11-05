export interface RecordMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export type InterestMode = "upfront" | "added";
export interface SignatureRef {
  original: Blob;
  processed: Blob;
  signerName: string;
  capturedAt: string;
}
export interface Borrower extends RecordMeta {
  numericId: number;
  fullName: string;
  address: string;
  contact?: string;
  monthlyIncome: number;
  photo?: Blob;
  rateOverride?: number;
  maxTermOverride?: number;
  graceDaysOverride?: number;
  notes?: string;
  status: "active" | "archived";
}
export type InstallmentStatus =
  | "Upcoming"
  | "Due soon"
  | "Due today"
  | "Mercy"
  | "Overdue"
  | "Partial"
  | "Paid"
  | "rolled_over";
export interface Installment {
  no: number;
  dueDate: string;
  graceUntil: string;
  amountDue: number;
  amountPaid: number;
  paidDate?: string;
  status: InstallmentStatus;
  frozenScore?: number;
  frozenAt?: string;
}
export interface BorrowerSnapshot {
  numericId: number;
  fullName: string;
}
export interface Loan extends RecordMeta {
  loanNo: string;
  borrowerId: string;
  borrowerSnapshot: BorrowerSnapshot;
  incomeAtLoan: number;
  termMonths: number;
  rate: number;
  interestMode: InterestMode;
  faceAmount: number;
  interestAmount: number;
  netRelease: number;
  monthlyAmount: number;
  releaseDate: string;
  status: "active" | "completed" | "merged" | "voided";
  installments: Installment[];
  kind: "new" | "advance";
  parentLoanId?: string;
  mergedIntoLoanId?: string;
  carriedBalance?: number;
  advanceFace?: number;
  autoNote?: string;
  releasedBy: string;
  signatures: {
    borrower?: SignatureRef;
    admin?: SignatureRef;
    witness?: SignatureRef;
  };
  notes?: string;
}
export type PaymentMethod = "cash" | "bank" | "gcash" | "maya" | "other";
export interface Allocation {
  installmentNo: number;
  amount: number;
}
export interface AdvanceDetail {
  mode: "merge" | "separate";
  carriedBalance: number;
  advanceFace: number;
  interest: number;
  netCash: number;
  newFace: number;
  newTerm: number;
  newMonthly: number;
  previousLoanId: string;
  newLoanId: string;
  schedule: Installment[];
  previousInstallments?: Installment[];
}
export interface Transaction extends RecordMeta {
  txnNo: string;
  type: "RELEASE" | "ADVANCE" | "PAYMENT" | "VOID" | "ADJUSTMENT";
  loanId: string;
  borrowerId: string;
  borrowerSnapshot: BorrowerSnapshot;
  amount: number;
  method?: PaymentMethod;
  bankName?: string;
  referenceNo?: string;
  proofImage?: Blob;
  receivedBy: string;
  signatures?: { payer?: SignatureRef; receiver?: SignatureRef };
  balanceBefore: number;
  balanceAfter: number;
  allocation: Allocation[];
  voidOf?: string;
  voidReason?: string;
  advance?: AdvanceDetail;
  notes?: string;
  date: string;
  unappliedAmount?: number;
  nextDueDate?: string;
}
export interface ScoringSettings {
  onTime: number;
  withinGrace: number;
  lateBase: number;
  latePerDay: number;
  minimum: number;
  recency: number;
}
export interface Settings extends RecordMeta {
  business: { name: string; address: string; logo?: Blob };
  defaults: {
    rate: number;
    maxTerm: number;
    graceDays: number;
    interestMode: InterestMode;
  };
  scoring: ScoringSettings;
  backup: {
    googleClientId?: string;
    driveFileId?: string;
    lastSuccess?: string;
    lastError?: string;
    lastSync?: string;
    email?: string;
    emailEnabled?: boolean;
    autoDrive?: boolean;
    emailFrequency?: "daily" | "changes";
    [key: string]: unknown;
  };
  haptics: boolean;
  receiptFooter: string;
  agreementText: string;
  reminderTemplate: string;
  adminEmail: string;
  defaultReceivedBy: string;
  borrowerPrefix: string;
  adminSignature?: SignatureRef;
}
export interface Counters extends RecordMeta {
  borrower: number;
  txnByDay: Record<string, number>;
  loanByBorrower: Record<string, number>;
}
export interface AuditLog extends RecordMeta {
  at: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
}
export interface Tombstone extends RecordMeta {
  entity: string;
  entityId: string;
  deletedAt: string;
}
export interface SignerProfile extends RecordMeta {
  name: string;
  defaultSignature?: SignatureRef;
}
export interface Snapshot extends RecordMeta {
  reason: string;
  data: string;
}
export interface Note extends RecordMeta {
  borrowerId: string;
  text: string;
  kind: "manual" | "advance";
  loanId?: string;
}
