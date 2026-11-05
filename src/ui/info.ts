export const info = {
  balance:
    "The unpaid face balance across active loans. Interest deducted at release is already included in the face amount.",
  collected:
    "Payments received this calendar month in Asia/Manila, excluding reversed payments.",
  released:
    "Actual cash handed over this month. A carried advance balance is never counted as new cash.",
  interest:
    "Interest on new releases and advances this month. Carried balances are never charged interest again.",
  mercy:
    "Admin only: a private grace period after the official due date. It never appears on borrower documents.",
  rating:
    "Paid on time earns 100, within the private grace period 85. Later payments lose 4 points per day beyond grace, down to 10; unpaid overdue installments score 0. Recent installments weigh more.",
  income:
    "Estimated monthly income (Sahod), based on your conversation. Income × term sets the maximum face amount.",
  rate: "A single interest charge on the amount borrowed, rather than a monthly compounding rate.",
  term: "Number of monthly installments. Each due date is calculated from the original release day, clamped to month end.",
  face: "The total amount the borrower agrees to repay. Upfront interest is deducted from this amount.",
  net: "The cash actually handed to the borrower, after any upfront deduction.",
  cap: "Maximum face amount is monthly income × months. Advances also include the existing exposure. An explicit override is recorded in the audit log.",
  signatures:
    "Capture a paper signature, draw on screen, or skip. Original photos are preserved along with cleaned transparent signatures.",
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
