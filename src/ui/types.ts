import type {
  Borrower,
  Loan,
  Note,
  Settings,
  Transaction,
} from "../core/model";
import type { LoanPreset } from "./forms";
export interface AppData {
  borrowers: Borrower[];
  loans: Loan[];
  transactions: Transaction[];
  notes: Note[];
  settings: Settings;
}
export interface Actions {
  borrower: (b?: Borrower) => void;
  loan: (preset?: LoanPreset) => void;
  payment: (loanId?: string) => void;
  receipt: (t: Transaction) => void;
  export: (b: Borrower) => void;
  remove: (b: Borrower) => void;
  signature: (l: Loan) => void;
  toast: (text: string) => void;
}
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));
}
