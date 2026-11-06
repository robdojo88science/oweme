import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRight,
  Camera,
  Info,
  Plus,
  Printer,
  Save,
  Trash2,
  Wallet,
} from "lucide-react";
import type {
  Borrower,
  Installment,
  Loan,
  LoanDraft,
  Settings,
  SignatureRef,
  Transaction,
  PaymentMethod,
} from "../core/model";
import {
  allocatePayment,
  balance,
  borrowerNumber,
  borrowerRating,
  formatMoney,
  installmentStatus,
  moneyInput,
  parseMoney,
  quoteAdvance,
  quoteLoan,
  schedule,
  today,
} from "../core/logic";
import { db, metadata } from "../data/db";
import {
  createAdvance,
  createBorrower,
  createLoan,
  receivePayment,
  updateBorrower,
  attachLoanSignature,
} from "../data/service";
import { compressImage } from "../media/images";
import { SignatureCapture } from "../components/SignatureCapture";
import { downloadFile, loanSlipPDF, printFile } from "../exports";
import { ErrorBox, Help, Modal, Money, Stars, Submit } from "./primitives";
import { haptic } from "./store";
import type { InfoKey } from "./info";
import { loanCost } from "./loanCost";
import { deleteLoanDraft, saveLoanDraft } from "./loanDrafts";
import type { LoanDraftInput } from "./loanDrafts";

export function Field({
  label,
  topic,
  children,
  full = false,
}: {
  label: string;
  topic?: InfoKey;
  children: ReactNode;
  full?: boolean;
}) {
  const generatedId = useId();
  let controlId = generatedId;
  let linked = false;
  const linkControl = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (node) => {
      if (!isValidElement<{ id?: string; children?: ReactNode }>(node))
        return node;
      if (
        !linked &&
        ["input", "select", "textarea"].includes(String(node.type))
      ) {
        linked = true;
        controlId = node.props.id || generatedId;
        return cloneElement(node, { id: controlId });
      }
      return node.props.children
        ? cloneElement(node, { children: linkControl(node.props.children) })
        : node;
    });
  const controls = linkControl(children);
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <span>
        <label htmlFor={controlId}>{label}</label>
        {topic && <Help topic={topic} />}
      </span>
      {controls}
    </div>
  );
}
export function Schedule({
  items,
  admin = true,
  forecast = false,
}: {
  items: Installment[];
  admin?: boolean;
  forecast?: boolean;
}) {
  const asOf = today();
  return (
    <table className="schedule">
      <thead>
        <tr>
          <th>#</th>
          <th>Official due date</th>
          <th>Amount</th>
          {forecast && <th>Balance after</th>}
          {admin && (
            <>
              <th>Paid</th>
              <th>Status</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {items.map((x) => {
          const status = installmentStatus(x, asOf);
          return (
            <tr key={x.no}>
              <td>{x.no}</td>
              <td>{x.dueDate}</td>
              <td>
                <Money amount={x.amountDue} />
              </td>
              {forecast && (
                <td>
                  <Money
                    amount={items
                      .filter((item) => item.no > x.no)
                      .reduce((sum, item) => sum + item.amountDue, 0)}
                  />
                </td>
              )}
              {admin && (
                <>
                  <td>
                    <Money amount={x.amountPaid} />
                  </td>
                  <td>
                    <Status status={status} />
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
export function Status({ status }: { status: string }) {
  const color =
    status === "Paid" || status === "completed"
      ? "green"
      : status === "Overdue"
        ? "red"
        : ["Mercy", "Partial", "Due today", "Due soon", "Upcoming"].includes(
              status,
            )
          ? "amber"
          : status === "advance"
            ? "purple"
            : "";
  return (
    <span className={`status ${color}`}>
      <i className="dot" />
      {status === "rolled_over"
        ? "Rolled over"
        : status === "Mercy"
          ? "Courtesy · late"
          : status}
      {status === "Mercy" && <Help topic="mercy" />}
    </span>
  );
}
export function BorrowerForm({
  borrower,
  borrowers,
  onClose,
  onSaved,
}: {
  borrower?: Borrower;
  borrowers: Borrower[];
  onClose: () => void;
  onSaved: (b: Borrower) => void;
}) {
  const [name, setName] = useState(borrower?.fullName || ""),
    [alias, setAlias] = useState(borrower?.alias || ""),
    [barangay, setBarangay] = useState(borrower?.barangay || ""),
    [registered, setRegistered] = useState(
      borrower?.registrationDate || today(),
    ),
    [address, setAddress] = useState(borrower?.address || ""),
    [contact, setContact] = useState(borrower?.contact || ""),
    [income, setIncome] = useState(
      borrower ? moneyInput(borrower.monthlyIncome) : "",
    ),
    [photo, setPhoto] = useState<Blob | undefined>(borrower?.photo),
    [notes, setNotes] = useState(borrower?.notes || ""),
    [rate, setRate] = useState(
      borrower?.rateOverride === undefined
        ? ""
        : String(borrower.rateOverride * 100),
    ),
    [term, setTerm] = useState(String(borrower?.maxTermOverride ?? "")),
    [grace, setGrace] = useState(String(borrower?.graceDaysOverride ?? "")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const duplicate = borrowers.some(
    (b) =>
      b.id !== borrower?.id &&
      name.trim().length > 3 &&
      b.fullName
        .toLowerCase()
        .includes(name.trim().toLowerCase().split(" ")[0]) &&
      b.address.toLowerCase() === address.trim().toLowerCase(),
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const input = {
        fullName: name.trim(),
        address: address.trim(),
        contact,
        monthlyIncome: parseMoney(income || "0"),
        alias,
        barangay,
        registrationDate: registered,
        photo,
        notes,
        rateOverride: rate === "" ? undefined : Number(rate) / 100,
        maxTermOverride: term === "" ? undefined : Number(term),
        graceDaysOverride: grace === "" ? undefined : Number(grace),
      };
      const b = borrower
        ? await updateBorrower(borrower.id, input)
        : await createBorrower(input);
      onSaved(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={borrower ? "Edit borrower" : "New borrower"}
      subtitle="Only a full name is required. Add other details when useful."
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Full name" full>
            <input
              aria-label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Maria Santos"
              required
              autoFocus
            />
          </Field>
          <Field label="Address / Purok (optional)" full>
            <input
              aria-label="Address / Purok"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Purok, barangay, city"
            />
          </Field>
          <Field label="Alias (optional)">
            <input value={alias} onChange={(e) => setAlias(e.target.value)} />
          </Field>
          <Field label="Barangay / city (optional)">
            <input
              value={barangay}
              onChange={(e) => setBarangay(e.target.value)}
            />
          </Field>
          <Field label="Contact number (optional)">
            <input
              type="tel"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="09XX XXX XXXX"
            />
          </Field>
          <Field label="Monthly income (optional)" topic="income">
            <input
              aria-label="Monthly income (Sahod)"
              inputMode="decimal"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              placeholder="Not yet provided"
            />
          </Field>
          <Field label="Registration date">
            <input
              type="date"
              value={registered}
              onChange={(e) => setRegistered(e.target.value)}
            />
          </Field>
          <Field label="Borrower photo (optional)" full>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file)
                  try {
                    setPhoto(await compressImage(file));
                  } catch (e) {
                    setError(String(e));
                  }
              }}
            />
            {photo && (
              <small>
                Photo ready · {Math.round(photo.size / 1024)} KB{" "}
                <button type="button" onClick={() => setPhoto(undefined)}>
                  Remove
                </button>
              </small>
            )}
          </Field>
          <Field label="Notes" full>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Helpful details from your conversation"
            />
          </Field>
        </div>
        {duplicate && (
          <div className="alert amber">
            A borrower with a similar name lives at this address. Check the
            existing account before saving.
          </div>
        )}
        <details style={{ marginTop: 18 }}>
          <summary
            style={{ cursor: "pointer", padding: "12px 0", fontSize: 12 }}
          >
            Optional loan defaults
          </summary>
          <div className="form-grid">
            <Field label="One-time charge (%)" topic="rate">
              <input
                type="number"
                min="0"
                max="99.99"
                step="0.01"
                placeholder="Use global default"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </Field>
            <Field label="Maximum months" topic="term">
              <input
                type="number"
                min="1"
                max="120"
                placeholder="Use global default"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </Field>
            <Field label="Courtesy days · internal" topic="mercy">
              <input
                type="number"
                min="0"
                max="365"
                placeholder="Use global default"
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
              />
            </Field>
          </div>
        </details>
        <ErrorBox error={error} />
        <div className="form-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <Submit busy={busy}>
            {borrower ? "Save changes" : "Add borrower"}
          </Submit>
        </div>
      </form>
    </Modal>
  );
}
export interface LoanPreset {
  borrowerId?: string;
  term?: number;
  amount?: string;
  inputMode?: "face" | "cash";
  income?: string;
  affordabilityPercent?: number;
  maxTermOverride?: number;
  rate?: string;
  advance?: boolean;
  advanceMode?: "merge" | "separate";
  previousLoanId?: string;
  releaseDate?: string;
  interestMode?: "upfront" | "added";
}
export function LoanForm({
  borrowers,
  loans,
  settings,
  preset = {},
  onClose,
  onSaved,
}: {
  borrowers: Borrower[];
  loans: Loan[];
  settings: Settings;
  preset?: LoanPreset;
  onClose: () => void;
  onSaved: (t: Transaction) => void;
}) {
  const [bid, setBid] = useState(
    preset.borrowerId || borrowers.find((b) => b.status === "active")?.id || "",
  );
  const b = borrowers.find((x) => x.id === bid);
  const active = loans.filter(
    (l) => l.borrowerId === bid && l.status === "active",
  );
  const [previousId, setPreviousId] = useState(
    preset.previousLoanId || active[0]?.id || "",
  );
  const previous = active.find((l) => l.id === previousId) || active[0];
  const [isAdvance, setIsAdvance] = useState(!!preset.advance);
  const [draftId, setDraftId] = useState<string>();
  const [draftMessage, setDraftMessage] = useState("");
  const [income, setIncome] = useState(
      preset.income || moneyInput(b?.monthlyIncome || 0),
    ),
    [affordability, setAffordability] = useState(
      String(
        preset.affordabilityPercent ??
          settings.defaults.affordabilityPercent ??
          30,
      ),
    ),
    [maximumTerm, setMaximumTerm] = useState(
      preset.maxTermOverride ? String(preset.maxTermOverride) : "",
    ),
    [term, setTerm] = useState(
      preset.term || b?.maxTermOverride || settings.defaults.maxTerm,
    ),
    [rate, setRate] = useState(
      preset.rate || String((b?.rateOverride ?? settings.defaults.rate) * 100),
    ),
    [mode, setMode] = useState<"merge" | "separate">(
      preset.advanceMode || "merge",
    ),
    [interestMode, setInterestMode] = useState(
      preset.interestMode || settings.defaults.interestMode,
    ),
    [inputMode, setInputMode] = useState<"face" | "cash">(
      preset.inputMode ||
        (settings.defaults.interestMode === "added" ? "cash" : "face"),
    ),
    [amount, setAmount] = useState(() => {
      if (preset.amount) return preset.amount;
      const face = Math.max(
        0,
        Math.round(
          ((b?.monthlyIncome || 0) * term * Number(affordability)) / 100,
        ) - (isAdvance && previous ? balance(previous) : 0),
      );
      if (!face) return "";
      return moneyInput(
        inputMode === "cash"
          ? quoteLoan({
              income: b?.monthlyIncome || 0,
              term,
              rate: Number(rate) / 100,
              interestMode,
              amount: face,
              inputMode: "face",
            }).netRelease
          : face,
      );
    }),
    [date, setDate] = useState(preset.releaseDate || today()),
    [releasedBy, setReleasedBy] = useState(settings.defaultReceivedBy),
    [notes, setNotes] = useState(""),
    [override, setOverride] = useState(false),
    [overrideReason, setOverrideReason] = useState(""),
    [releaseConfirmed, setReleaseConfirmed] = useState(false),
    [sig, setSig] = useState<SignatureRef>(),
    [adminSig, setAdminSig] = useState<SignatureRef | undefined>(
      settings.adminSignature,
    ),
    [witnessSig, setWitnessSig] = useState<SignatureRef>(),
    [witness, setWitness] = useState(""),
    [showSig, setShowSig] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const signers = useLiveQuery(() => db.signerProfiles.toArray(), []) || [];
  const drafts =
    useLiveQuery(
      async () => (await db.settings.get("settings"))?.loanDrafts || [],
      [],
    ) || [];
  let preview: ReturnType<typeof quoteLoan> | undefined,
    adv: ReturnType<typeof quoteAdvance> | undefined,
    items: Installment[] = [],
    quoteError = "";
  const outstanding = active.reduce((s, l) => s + balance(l), 0);
  const maxTerm = maximumTerm
    ? Number(maximumTerm)
    : (b?.maxTermOverride ?? settings.defaults.maxTerm);
  try {
    if (b?.status === "archived")
      throw new Error(
        "Restore this archived borrower before issuing a loan. The saved draft is retained.",
      );
    if (
      !Number.isInteger(maxTerm) ||
      maxTerm < 1 ||
      maxTerm > 120 ||
      term > maxTerm
    )
      throw new Error("Choose a term within the loan maximum (1–120 months).");
    if (!rate.trim())
      throw new Error(
        "Enter a one-time charge, including 0 for zero interest.",
      );
    if (
      !affordability ||
      Number(affordability) < 1 ||
      Number(affordability) > 100
    )
      throw new Error("Choose an affordability percentage from 1 to 100.");
    const parsed = parseMoney(amount || "0"),
      inc = parseMoney(income || "0");
    preview = quoteLoan({
      income: inc,
      affordabilityPercent: Number(affordability),
      term,
      rate: Number(rate) / 100,
      interestMode,
      amount: parsed,
      inputMode,
    });
    if (isAdvance && previous) {
      adv = quoteAdvance({
        balance: balance(previous),
        allOutstanding: outstanding,
        income: inc,
        affordabilityPercent: Number(affordability),
        term,
        rate: Number(rate) / 100,
        interestMode,
        amount: parsed,
        inputMode,
        mode,
        releaseDate: date,
        graceDays: b?.graceDaysOverride ?? settings.defaults.graceDays,
      });
      items = adv.installments;
    } else
      items = schedule(
        preview.face,
        term,
        date,
        b?.graceDaysOverride ?? settings.defaults.graceDays,
      );
  } catch (e) {
    quoteError = e instanceof Error ? e.message : String(e);
  }
  const exceeded = adv?.capExceeded ?? preview?.capExceeded;
  const costs =
    !isAdvance && preview && !quoteError
      ? loanCost(preview.netRelease, preview.interest, date, items)
      : undefined;
  const rating = borrowerRating(
    loans.filter((l) => l.borrowerId === bid),
    today(),
    settings.scoring,
  );
  const overdue = active.some((l) =>
    l.installments.some((i) => installmentStatus(i) === "Overdue"),
  );
  function resumeDraft(draft: LoanDraft) {
    setDraftId(draft.id);
    setBid(draft.borrowerId);
    setIsAdvance(draft.advance);
    setMode(draft.advanceMode);
    setPreviousId(draft.previousLoanId || "");
    setIncome(draft.income);
    setAffordability(draft.affordabilityPercent);
    setMaximumTerm(draft.maximumTerm);
    setTerm(draft.term);
    setRate(draft.rate);
    setInterestMode(draft.interestMode);
    setInputMode(draft.inputMode);
    setAmount(draft.amount);
    setDate(draft.releaseDate);
    setReleasedBy(draft.releasedBy);
    setNotes(draft.notes);
    setOverride(draft.overrideCap);
    setOverrideReason(draft.overrideReason);
    setWitness(draft.witness);
    setSig(draft.signatures.borrower);
    setAdminSig(draft.signatures.admin);
    setWitnessSig(draft.signatures.witness);
    setShowSig(!!Object.values(draft.signatures).some(Boolean));
    setReleaseConfirmed(false);
    setError("");
    setDraftMessage(
      "Draft resumed. Review the terms before confirming a cash release.",
    );
  }
  async function saveDraft() {
    if (!b || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const input: LoanDraftInput = {
        borrowerId: bid,
        advance: isAdvance,
        advanceMode: mode,
        previousLoanId: isAdvance ? previous?.id : undefined,
        income,
        affordabilityPercent: affordability,
        maximumTerm,
        term,
        rate,
        interestMode,
        inputMode,
        amount,
        releaseDate: date,
        releasedBy,
        notes,
        overrideCap: override,
        overrideReason,
        witness,
        signatures: { borrower: sig, admin: adminSig, witness: witnessSig },
      };
      const saved = await saveLoanDraft(input, draftId);
      setDraftId(saved.id);
      setDraftMessage(
        "Draft saved on this device. No funds released and no ledger entry created.",
      );
      haptic("success", settings.haptics);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    if (!releaseConfirmed) {
      setError(
        "Confirm that the agreement was reviewed and the actual cash was handed over.",
      );
      return;
    }
    if (exceeded && (!override || !overrideReason.trim())) {
      setError("Record a reason for exceeding the affordability guideline.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const input = {
        borrowerId: bid,
        draftId,
        amount: parseMoney(amount),
        income: parseMoney(income || "0"),
        affordabilityPercent: Number(affordability),
        term,
        maxTermOverride: maximumTerm ? Number(maximumTerm) : undefined,
        releaseDate: date,
        releasedBy,
        rate: Number(rate) / 100,
        interestMode,
        inputMode,
        overrideCap: override,
        overrideReason: overrideReason.trim(),
        notes,
        signatures: { borrower: sig, admin: adminSig, witness: witnessSig },
      };
      const result = isAdvance
        ? await createAdvance({
            ...input,
            previousLoanId: previous?.id || "",
            mode,
          })
        : await createLoan(input);
      haptic("success", settings.haptics);
      onSaved(result.transaction);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function draftSlip(download = false) {
    try {
      if (!b || !preview) return;
      const loan: Loan = {
        ...metadata("draft"),
        loanNo: "DRAFT · NOT RELEASED",
        borrowerId: b.id,
        borrowerSnapshot: b,
        incomeAtLoan: parseMoney(income || "0"),
        affordabilityPercent: Number(affordability),
        overrideReason: overrideReason.trim() || undefined,
        termMonths: term,
        rate: Number(rate) / 100,
        interestMode,
        faceAmount: adv?.newFace ?? preview.face,
        interestAmount: adv?.interest ?? preview.interest,
        netRelease: adv?.netCash ?? preview.netRelease,
        monthlyAmount: adv?.monthly ?? preview.monthly,
        releaseDate: date,
        status: "active",
        installments: items,
        kind: isAdvance ? "advance" : "new",
        carriedBalance: adv?.carriedBalance,
        advanceFace: adv?.advanceFace,
        releasedBy,
        notes,
        signatures: { borrower: sig, admin: adminSig, witness: witnessSig },
      };
      const txn: Transaction = {
        ...metadata("draft-txn"),
        txnNo: "DRAFT · NOT A RECEIPT",
        type: isAdvance ? "ADVANCE" : "RELEASE",
        loanId: loan.id,
        borrowerId: b.id,
        borrowerSnapshot: b,
        amount: loan.netRelease,
        receivedBy: releasedBy,
        balanceBefore: outstanding,
        balanceAfter: loan.faceAmount,
        allocation: [],
        date,
      };
      const file = await loanSlipPDF(loan, txn, settings);
      if (download) downloadFile(file, "OweMe-draft-agreement.pdf");
      else printFile(file);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Modal
      title={isAdvance ? "Advance loan" : "New loan"}
      subtitle={
        isAdvance
          ? "Carry the balance. Charge interest only on the new advance."
          : "One clear agreement, from release to the last installment."
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={save} onChangeCapture={() => setReleaseConfirmed(false)}>
        {drafts.length > 0 && (
          <details style={{ marginBottom: 20 }}>
            <summary
              style={{ cursor: "pointer", padding: "10px 0", fontSize: 12 }}
            >
              Saved loan drafts ({drafts.length})
            </summary>
            <p className="caption">
              Editable plans only. Drafts have no effect on balances.
            </p>
            {[...drafts]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((draft) => (
                <div className="setting-row" key={draft.id}>
                  <div>
                    <b>
                      {borrowers.find(
                        (person) => person.id === draft.borrowerId,
                      )?.fullName || "Borrower unavailable"}
                    </b>
                    <p>
                      {draft.advance ? "Advance" : "New loan"} ·{" "}
                      {draft.term || "—"} months · saved{" "}
                      {draft.updatedAt.slice(0, 10)}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="button small"
                      onClick={() => resumeDraft(draft)}
                    >
                      Resume draft
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete draft for ${borrowers.find((person) => person.id === draft.borrowerId)?.fullName || "unavailable borrower"}`}
                      onClick={async () => {
                        try {
                          await deleteLoanDraft(draft.id);
                          if (draftId === draft.id) setDraftId(undefined);
                          setDraftMessage(
                            "Draft removed. Issued loans and payments are unchanged.",
                          );
                        } catch (cause) {
                          setError(String(cause));
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
          </details>
        )}
        {draftMessage && (
          <div className="alert" role="status">
            {draftMessage}
          </div>
        )}
        <div className="form-grid">
          <Field label="Borrower" full>
            <select
              aria-label="Borrower"
              value={bid}
              onChange={(e) => {
                const next = borrowers.find((b) => b.id === e.target.value);
                setBid(e.target.value);
                setDraftId(undefined);
                setDraftMessage("");
                setIncome(moneyInput(next?.monthlyIncome || 0));
                setRate(
                  String((next?.rateOverride ?? settings.defaults.rate) * 100),
                );
                setTerm(next?.maxTermOverride ?? settings.defaults.maxTerm);
                setOverride(false);
              }}
              required
            >
              <option value="">Choose a borrower</option>
              {borrowers
                .filter((b) => b.status === "active")
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    #{borrowerNumber(b.numericId, settings.borrowerPrefix)} ·{" "}
                    {b.fullName}
                  </option>
                ))}
            </select>
          </Field>
          {isAdvance && (
            <Field label="Current loan" full>
              <select
                value={previous?.id || ""}
                onChange={(e) => setPreviousId(e.target.value)}
                required
              >
                <option value="">Choose active loan</option>
                {active.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.loanNo} · {formatMoney(balance(l))} remaining
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {outstanding > 0 && (
          <div className={`alert ${overdue ? "amber" : ""}`}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                Current outstanding <b>{formatMoney(outstanding)}</b>
              </span>
              <Stars stars={rating.stars} />
            </div>
            {overdue && (
              <p>
                There are overdue installments. Review the account before
                issuing more cash.
              </p>
            )}
            {isAdvance && (
              <p>Record any payment first so the balance is current.</p>
            )}
          </div>
        )}
        {isAdvance && (
          <div className="segmented" style={{ margin: "18px 0" }}>
            {(["merge", "separate"] as const).map((m) => (
              <button
                type="button"
                className={mode === m ? "active" : ""}
                key={m}
                onClick={() => setMode(m)}
              >
                {m === "merge" ? "Merge into one loan" : "Separate loan"}
              </button>
            ))}
          </div>
        )}
        <div className="form-grid">
          <Field label="Monthly income (Sahod)" topic="income">
            <input
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field label="Affordability (%)" topic="cap">
            <input
              aria-label="Loan affordability percentage"
              type="number"
              min="1"
              max="100"
              value={affordability}
              onChange={(e) => {
                setAffordability(e.target.value);
                setReleaseConfirmed(false);
              }}
              required
            />
          </Field>
          <Field label={`Term · up to ${maxTerm} months`} topic="term">
            <input
              aria-label="Term in months"
              type="number"
              min="1"
              max={maxTerm}
              value={term || ""}
              onChange={(e) => setTerm(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Charge type" topic="rate">
            <select
              aria-label="Loan charge type"
              value={rate === "0" ? "zero" : interestMode}
              onChange={(e) => {
                if (e.target.value === "zero") {
                  setRate("0");
                  setInterestMode("upfront");
                  setInputMode("face");
                  return;
                }
                if (rate === "0") setRate(String(settings.defaults.rate * 100));
                const m = e.target.value as "upfront" | "added";
                setInterestMode(m);
                setInputMode(m === "added" ? "cash" : "face");
              }}
            >
              <option value="upfront">Upfront face deduction</option>
              <option value="added">Add-on charge</option>
              <option value="zero">Zero interest</option>
            </select>
          </Field>
          <Field label="Maximum months for this loan (optional)" topic="term">
            <input
              type="number"
              min="1"
              max="120"
              value={maximumTerm}
              onChange={(e) => setMaximumTerm(e.target.value)}
              placeholder={`Default: ${b?.maxTermOverride ?? settings.defaults.maxTerm}`}
            />
          </Field>
          <Field label="One-time charge (%)" topic="rate">
            <input
              type="number"
              min="0"
              max="99.99"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
            />
          </Field>
          <div className="field full">
            <span>Amount entered as</span>
            <div className="segmented">
              {(["face", "cash"] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  className={inputMode === m ? "active" : ""}
                  onClick={() => setInputMode(m)}
                >
                  {m === "face"
                    ? isAdvance
                      ? "Additional amount to repay"
                      : "Face amount"
                    : "Cash I will hand over"}
                </button>
              ))}
            </div>
          </div>
          <Field
            label={
              inputMode === "face"
                ? isAdvance
                  ? "Additional face amount"
                  : "Face amount"
                : "Cash to hand over"
            }
            topic={inputMode === "face" ? "face" : "net"}
          >
            <input
              aria-label="Loan amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label="Release date">
            <input
              aria-label="Release date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Released by" topic="receivedBy" full>
            <input
              aria-label="Released by"
              list="signer-names"
              value={releasedBy}
              onChange={(e) => {
                setReleasedBy(e.target.value);
                const p = signers.find((s) => s.name === e.target.value);
                if (p?.defaultSignature) setAdminSig(p.defaultSignature);
              }}
              placeholder="Name of the person handing over cash"
              required
            />
            <datalist id="signer-names">
              {signers.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </Field>
        </div>
        {preview && (
          <div className="quote-card">
            <div className="section-title">
              <h2>Live loan preview</h2>
              <span className="status purple">Updates instantly</span>
            </div>
            <div className="quote-grid">
              {isAdvance && adv && (
                <>
                  <div>
                    <small>Balance carried</small>
                    <b>
                      <Money
                        amount={mode === "merge" ? adv.carriedBalance : 0}
                      />
                    </b>
                  </div>
                  <div>
                    <small>New advance face</small>
                    <b>
                      <Money amount={adv.advanceFace} />
                    </b>
                  </div>
                </>
              )}
              <div>
                <small>
                  Finance charge <Help topic="interest" />
                </small>
                <b>
                  <Money amount={adv?.interest ?? preview.interest} />
                </b>
              </div>
              <div className="highlight">
                <small>
                  Actual cash released <Help topic="net" />
                </small>
                <b>
                  <Money amount={adv?.netCash ?? preview.netRelease} />
                </b>
              </div>
              <div>
                <small>
                  Face / total repayable <Help topic="face" />
                </small>
                <b>
                  <Money amount={adv?.newFace ?? preview.face} />
                </b>
              </div>
              <div>
                <small>Monthly payment</small>
                <b>
                  <Money amount={adv?.monthly ?? preview.monthly} />
                </b>
              </div>
            </div>
            <Schedule items={items} admin={false} />
            <p className="caption" style={{ marginTop: 13 }}>
              First payment is one month after release. No late fee is added.
              The last installment includes any centavo remainder.
            </p>
            <p className="caption">
              {rate}% is one charge for the whole term, not a monthly rate or
              APR.
              {costs &&
                preview.interest > 0 &&
                ` Cost versus cash received: ${costs.costOfCashPercent.toFixed(2)}%; annualized effective estimate ${costs.effectiveAnnualPercent.toFixed(2)}% (actual due dates, Actual/365; not a statutory APR).`}
            </p>
          </div>
        )}
        {isAdvance && adv && previous && (
          <div className="before-after">
            <div>
              <small>BEFORE · {previous.loanNo}</small>
              <b>
                <Money amount={balance(previous)} />
              </b>
              <p>
                Outstanding balance
                <br />
                {formatMoney(previous.monthlyAmount)} / month
              </p>
            </div>
            <ArrowRight size={18} color="#aaa4d4" />
            <div>
              <small>
                AFTER · {mode === "merge" ? "ONE LOAN" : "NEW SEPARATE LOAN"}
              </small>
              <b>
                <Money amount={adv.newFace} />
              </b>
              <p>
                {term} monthly installments
                <br />
                First due {items[0]?.dueDate}
              </p>
            </div>
          </div>
        )}
        <div className={`alert ${exceeded ? "amber" : ""}`}>
          Suggested {isAdvance ? "advance" : "face maximum"}:{" "}
          <b>{formatMoney(adv?.maxAdvance ?? preview?.maxFace ?? 0)}</b>{" "}
          <Help topic="cap" />
          {adv?.maxAdvance === 0 && (
            <p>
              No advance available. The existing balance reaches the income cap
              for this term.
            </p>
          )}
          {exceeded && (
            <p>
              This exceeds the affordability guideline. Record your reason
              before release.
            </p>
          )}
        </div>
        {exceeded && (
          <>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              Override guideline · record this decision in the audit log
            </label>
            <Field label="Override reason" full>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                required
                placeholder="Why is this repayment amount affordable?"
              />
            </Field>
          </>
        )}
        {Number(affordability) >= 100 && (
          <div className="alert amber">
            Committing 100% of reported income may leave nothing for living
            costs. Consider a conservative percentage.
          </div>
        )}
        <Field label="Additional notes" full>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional details for this agreement"
          />
        </Field>
        <p className="form-section-title">
          Signatures <Help topic="signatures" />
        </p>
        <p className="caption">
          Print the agreement for a real paper signature, then upload the signed
          copy to this loan. On-screen signatures are optional.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button
            className="button small"
            type="button"
            onClick={() => void draftSlip()}
            disabled={!!quoteError || !b}
          >
            <Printer size={14} />
            Preview / print agreement
          </button>
          <button
            className="button small"
            type="button"
            onClick={() => void draftSlip(true)}
            disabled={!!quoteError || !b}
          >
            Save draft PDF
          </button>
          <button
            className="button small"
            type="button"
            onClick={() => setShowSig(!showSig)}
          >
            <Camera size={14} />
            {showSig ? "Hide capture" : "Capture signatures"}
          </button>
        </div>
        {!sig && !adminSig && (
          <span className="status" style={{ marginTop: 12 }}>
            No signature · allowed
          </span>
        )}
        {showSig && (
          <>
            <SignatureCapture
              label="Borrower signature"
              signerName={b?.fullName || ""}
              value={sig}
              onChange={setSig}
            />
            <SignatureCapture
              label="Issued by signature"
              signerName={releasedBy}
              value={adminSig}
              onChange={setAdminSig}
            />
            <Field label="Witness name (optional)">
              <input
                value={witness}
                onChange={(e) => setWitness(e.target.value)}
              />
            </Field>
            {witness && (
              <SignatureCapture
                label="Witness signature"
                signerName={witness}
                value={witnessSig}
                onChange={setWitnessSig}
              />
            )}
          </>
        )}
        <label className="checkbox-row" style={{ marginTop: 20 }}>
          <input
            type="checkbox"
            checked={releaseConfirmed}
            onChange={(e) => setReleaseConfirmed(e.target.checked)}
          />
          I reviewed the agreement and confirm that{" "}
          {formatMoney(adv?.netCash ?? preview?.netRelease ?? 0)} has been
          handed to the borrower.
        </label>
        <ErrorBox error={error || quoteError} />
        <div className="form-actions">
          <button
            type="button"
            className="button"
            onClick={() => void saveDraft()}
            disabled={busy || !b}
          >
            <Save size={15} />
            {draftId ? "Update draft" : "Save draft"}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              busy ||
              !!quoteError ||
              !b ||
              !releaseConfirmed ||
              (!!exceeded && (!override || !overrideReason.trim())) ||
              (isAdvance && !previous)
            }
          >
            <Plus size={16} />
            {busy ? "Saving…" : isAdvance ? "Save advance" : "Release loan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PaymentForm({
  loans,
  borrowers,
  settings,
  loanId,
  onClose,
  onSaved,
}: {
  loans: Loan[];
  borrowers: Borrower[];
  settings: Settings;
  loanId?: string;
  onClose: () => void;
  onSaved: (t: Transaction) => void;
}) {
  const active = loans.filter((l) => l.status === "active" && balance(l) > 0),
    [id, setId] = useState(loanId || active[0]?.id || "");
  const loan = active.find((l) => l.id === id);
  const next = loan?.installments.find((i) => i.amountPaid < i.amountDue);
  const [amount, setAmount] = useState(
      moneyInput(next ? next.amountDue - next.amountPaid : 0),
    ),
    [date, setDate] = useState(today()),
    [method, setMethod] = useState<PaymentMethod>("cash"),
    [bankName, setBank] = useState(""),
    [referenceNo, setReference] = useState(""),
    [receivedBy, setReceived] = useState(settings.defaultReceivedBy),
    [proof, setProof] = useState<Blob>(),
    [notes, setNotes] = useState(""),
    [payer, setPayer] = useState<SignatureRef>(),
    [receiver, setReceiver] = useState<SignatureRef | undefined>(
      settings.adminSignature,
    ),
    [signatures, setSignatures] = useState(false),
    [creditConfirmed, setCreditConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const paymentSaving = useRef(false);
  const signers = useLiveQuery(() => db.signerProfiles.toArray(), []) || [];
  let allocation: ReturnType<typeof allocatePayment> | undefined;
  try {
    if (loan && amount && parseMoney(amount) > 0)
      allocation = allocatePayment(loan.installments, parseMoney(amount), date);
  } catch {
    /* Input is validated on save. */
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (paymentSaving.current) return;
    if (allocation?.unappliedAmount && !creditConfirmed) {
      setError(
        "Confirm the extra money will be recorded as unapplied credit, or correct the payment amount.",
      );
      return;
    }
    paymentSaving.current = true;
    setError("");
    setBusy(true);
    try {
      const result = await receivePayment({
        loanId: id,
        amount: parseMoney(amount),
        date,
        method,
        receivedBy,
        bankName: method === "cash" ? undefined : bankName,
        referenceNo: method === "cash" ? undefined : referenceNo,
        proofImage: proof,
        notes,
        signatures: { payer, receiver },
      });
      haptic("success", settings.haptics);
      onSaved(result.transaction);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      paymentSaving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Receive payment"
      subtitle="Every payment, properly recorded. Salamat po."
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Loan" full>
            <select
              aria-label="Payment loan"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                const l = active.find((l) => l.id === e.target.value),
                  n = l?.installments.find((i) => i.amountPaid < i.amountDue);
                setAmount(moneyInput(n ? n.amountDue - n.amountPaid : 0));
              }}
              required
            >
              <option value="">Choose an active loan</option>
              {active.map((l) => (
                <option value={l.id} key={l.id}>
                  {borrowers.find((b) => b.id === l.borrowerId)?.fullName ||
                    l.borrowerSnapshot.fullName}{" "}
                  · {l.loanNo} · {formatMoney(balance(l))}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {loan && (
          <div className="alert">
            Balance before payment <b>{formatMoney(balance(loan))}</b> · Next
            due {next?.dueDate}
          </div>
        )}
        <div className="form-grid">
          <Field label="Payment amount">
            <input
              aria-label="Payment amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setCreditConfirmed(false);
              }}
              required
              autoFocus
            />
          </Field>
          <Field label="Payment date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
        </div>
        <div className="filter-chips" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="filter-chip"
            onClick={() =>
              setAmount(moneyInput(next ? next.amountDue - next.amountPaid : 0))
            }
          >
            Monthly {formatMoney(next ? next.amountDue - next.amountPaid : 0)}
          </button>
          <button
            type="button"
            className="filter-chip"
            onClick={() => setAmount(moneyInput(loan ? balance(loan) : 0))}
          >
            Full balance
          </button>
        </div>
        <div className="form-grid">
          <Field label="Payment method" full>
            <select
              aria-label="Payment method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {(["cash", "bank", "gcash", "maya", "other"] as const).map(
                (m) => (
                  <option key={m} value={m}>
                    {m === "gcash"
                      ? "GCash"
                      : m === "maya"
                        ? "Maya"
                        : m.charAt(0).toUpperCase() + m.slice(1)}
                  </option>
                ),
              )}
            </select>
          </Field>
          {method !== "cash" && (
            <>
              <Field label="Bank / provider">
                <input
                  value={bankName}
                  onChange={(e) => setBank(e.target.value)}
                />
              </Field>
              <Field label="Reference number">
                <input
                  value={referenceNo}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Received by" topic="receivedBy" full>
            <input
              aria-label="Received by"
              list="payment-signers"
              value={receivedBy}
              onChange={(e) => {
                setReceived(e.target.value);
                const p = signers.find((s) => s.name === e.target.value);
                if (p?.defaultSignature) setReceiver(p.defaultSignature);
              }}
              required
              placeholder="Name of the person receiving payment"
            />
            <datalist id="payment-signers">
              {signers.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Proof photo (optional)" full>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={async (e) => {
                if (e.target.files?.[0])
                  try {
                    setProof(await compressImage(e.target.files[0]));
                  } catch (e) {
                    setError(String(e));
                  }
              }}
            />
            {proof && (
              <small>Proof ready · {Math.round(proof.size / 1024)} KB</small>
            )}
          </Field>
          <Field label="Notes" full>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        {allocation && (
          <div className="quote-card">
            <h3 style={{ marginBottom: 15 }}>Payment allocation</h3>
            {allocation.allocation.map((a) => (
              <div className="receipt-row" key={a.installmentNo}>
                <span>Installment {a.installmentNo}</span>
                <b>{formatMoney(a.amount)}</b>
              </div>
            ))}
            <div className="receipt-row">
              <span>Balance after</span>
              <b>{formatMoney(allocation.balanceAfter)}</b>
            </div>
            {allocation.unappliedAmount > 0 && (
              <div className="alert amber">
                Overpayment credit: {formatMoney(allocation.unappliedAmount)}.
                This is recorded separately on the receipt; it does not reduce
                another loan automatically.
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={creditConfirmed}
                    onChange={(e) => setCreditConfirmed(e.target.checked)}
                  />
                  I confirm this extra cash should be retained as unapplied
                  credit.
                </label>
              </div>
            )}
          </div>
        )}
        <label className="checkbox-row" style={{ marginTop: 18 }}>
          <input
            type="checkbox"
            checked={signatures}
            onChange={(e) => setSignatures(e.target.checked)}
          />
          Include optional signatures <Help topic="signatures" />
        </label>
        {signatures && (
          <>
            <SignatureCapture
              label="Payer signature"
              signerName={loan?.borrowerSnapshot.fullName || ""}
              value={payer}
              onChange={setPayer}
            />
            <SignatureCapture
              label="Received by signature"
              signerName={receivedBy}
              value={receiver}
              onChange={setReceiver}
            />
          </>
        )}
        <ErrorBox error={error} />
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              busy ||
              !loan ||
              (!!allocation?.unappliedAmount && !creditConfirmed)
            }
          >
            <Wallet size={15} />
            {busy ? "Saving…" : "Save payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function AddSignatureDialog({
  loan,
  onClose,
  onSaved,
}: {
  loan: Loan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<keyof Loan["signatures"]>("borrower"),
    [name, setName] = useState(loan.borrowerSnapshot.fullName),
    [sig, setSig] = useState<SignatureRef | undefined>(
      loan.signatures.borrower,
    ),
    [error, setError] = useState("");
  return (
    <Modal title="Add a signature" subtitle={loan.loanNo} onClose={onClose}>
      <div className="modal-body">
        <Field label="Signer">
          <select
            value={role}
            onChange={(e) => {
              const r = e.target.value as keyof Loan["signatures"];
              setRole(r);
              setName(
                r === "borrower"
                  ? loan.borrowerSnapshot.fullName
                  : r === "admin"
                    ? loan.releasedBy
                    : "",
              );
              setSig(loan.signatures[r]);
            }}
          >
            <option value="borrower">Borrower</option>
            <option value="admin">Issued by</option>
            <option value="witness">Witness</option>
          </select>
        </Field>
        <Field label="Signer name">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <SignatureCapture signerName={name} value={sig} onChange={setSig} />
        <ErrorBox error={error} />
        <div className="form-actions">
          <button
            className="button primary"
            disabled={!sig || !name.trim()}
            onClick={async () => {
              try {
                await attachLoanSignature(loan.id, role, sig);
                if (role === "admin") {
                  const p = await db.signerProfiles
                    .where("name")
                    .equals(name)
                    .first();
                  if (p)
                    await db.signerProfiles.update(p.id, {
                      defaultSignature: sig,
                      updatedAt: new Date().toISOString(),
                    });
                }
                onSaved();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <Info size={15} />
            Save signature
          </button>
        </div>
      </div>
    </Modal>
  );
}
