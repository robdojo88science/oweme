export const info = {
  balance:
    "The unpaid face balance across active loans. Interest deducted at release is already included in the face amount.",
  collected:
    "Payments received this calendar month in Asia/Manila, excluding reversed payments.",
  released:
    "Actual cash handed over this month. A carried advance balance is never counted as new cash.",
  interest:
    "The one-time finance charge agreed at release. It is distinct from gross repayments and from cash-flow profit; carried balances are not charged again.",
  mercy:
    "Internal courtesy window after the contractual due date. The payment is still late and the agreed due date does not move. No late fee is added.",
  rating:
    "Stars use the share of due installments fully paid by their contractual due date: 95% = 5, 85% = 4, 70% = 3, 50% = 2; otherwise 1 by default. Partial payments qualify only when the full installment is paid. Courtesy payments are late. New borrowers are not rated.",
  income:
    "Optional estimated monthly income (Sahod), based on your conversation. Income × term × affordability percentage suggests a face maximum; this is an editable guideline.",
  rate: "One finance charge for the entire term. Upfront mode deducts a percentage of face value; add-on mode applies a charge to cash released. A 10% face deduction is not 10% per month or 10% APR. Set zero for no charge.",
  term: "Number of monthly installments. Each due date is calculated from the original release day, clamped to month end.",
  face: "The total amount the borrower agrees to repay. Upfront interest is deducted from this amount.",
  net: "The cash actually handed to the borrower, after any upfront deduction.",
  cap: "Suggested face maximum = monthly income × months × affordability percentage. Default 30% leaves room for living costs. 100% reproduces the illustrative income × term example but may be unaffordable. An override needs a recorded reason; advances include existing exposure.",
  signatures:
    "Print the agreement and have it signed on real paper, then photograph or upload it to the exact loan. Original evidence and processed signatures are retained. On-screen signatures are optional.",
  storage:
    "Data stays in this browser. Persistent storage reduces eviction risk but backups are still essential, especially on iPhone and iPad.",
  backup:
    "Keep a file outside this browser. Google automation runs while OweMe is open, online, and signed in; browser tokens expire.",
  defaults:
    "Defaults apply to new loans. Per-borrower settings can override them. Existing agreements stay unchanged.",
  reminder:
    "Reminders are checked when the app opens. Reliable background notifications are not available on every browser.",
  privacy:
    "Keep this device and exported files private. Borrower records, photos, and signatures contain personal information.",
  agreement:
    "This acknowledgement is printed on borrower loan slips. Keep it clear and never include private grace rules.",
  prefix:
    "An optional label before the sequential borrower number. Numbers are never reused after deletion.",
  haptics:
    "Gentle device feedback where supported. No sound is played; unsupported devices continue silently.",
  receivedBy:
    "Any name is allowed. Frequently used names are saved for your next release or receipt.",
  scoring:
    "Scores apply across all loans. Paid installments keep their history after an advance; future rolled balances do not earn scores.",
} as const;
export type InfoKey = keyof typeof info;
