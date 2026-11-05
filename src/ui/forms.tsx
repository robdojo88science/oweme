import { Children, cloneElement, isValidElement, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Camera, Info, Plus, Printer, Wallet } from "lucide-react";
import type {
  Borrower,
  Installment,
  Loan,
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
import { loanSlipPDF, printFile } from "../exports";
import { ErrorBox, Help, Modal, Money, Stars, Submit } from "./primitives";
import { haptic } from "./store";
import type { InfoKey } from "./info";

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
}: {
  items: Installment[];
  admin?: boolean;
}) {
  const asOf = today();
  return (
    <table className="schedule">
      <thead>
        <tr>
          <th>#</th>
          <th>Official due date</th>
          <th>Amount</th>
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
        : status === "Mercy" || status === "Partial"
          ? "amber"
          : status === "Due today" ||
              status === "Due soon" ||
              status === "advance"
            ? "purple"
            : "";
  return (
    <span className={`status ${color}`}>
      <i className="dot" />
      {status === "rolled_over" ? "Rolled over" : status}
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
        monthlyIncome: parseMoney(income),
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
      subtitle="A familiar face. A clearer account."
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
          <Field label="Address / Purok" full>
            <input
              aria-label="Address / Purok"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Purok, barangay, city"
              required
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
          <Field label="Monthly income (Sahod)" topic="income">
            <input
              aria-label="Monthly income (Sahod)"
              inputMode="decimal"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              placeholder="0.00"
              required
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
        <p className="form-section-title">Optional borrower defaults</p>
        <div className="form-grid">
          <Field label="Interest rate (%)" topic="rate">
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
          <Field label="Mercy days · admin only" topic="mercy">
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
  const isAdvance = !!preset.advance;
  const [income, setIncome] = useState(
      preset.income || moneyInput(b?.monthlyIncome || 0),
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
    [amount, setAmount] = useState(
      preset.amount ||
        moneyInput(
          isAdvance
            ? Math.max(
                0,
                (b?.monthlyIncome || 0) * term -
                  (previous ? balance(previous) : 0),
              )
            : (b?.monthlyIncome || 0) * term,
        ),
    ),
    [date, setDate] = useState(preset.releaseDate || today()),
    [releasedBy, setReleasedBy] = useState(settings.defaultReceivedBy),
    [notes, setNotes] = useState(""),
    [override, setOverride] = useState(false),
    [sig, setSig] = useState<SignatureRef>(),
    [adminSig, setAdminSig] = useState<SignatureRef | undefined>(
      settings.adminSignature,
    ),
    [witnessSig, setWitnessSig] = useState<SignatureRef>(),
    [witness, setWitness] = useState(""),
    [showSig, setShowSig] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const signers = useLiveQuery(() => db.signerProfiles.toArray(), []) || [];
  let preview: ReturnType<typeof quoteLoan> | undefined,
    adv: ReturnType<typeof quoteAdvance> | undefined,
    items: Installment[] = [],
    quoteError = "";
  const outstanding = active.reduce((s, l) => s + balance(l), 0);
  const maxTerm = b?.maxTermOverride ?? settings.defaults.maxTerm;
  try {
    const parsed = parseMoney(amount || "0"),
      inc = parseMoney(income || "0");
    preview = quoteLoan({
      income: inc,
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
  const rating = borrowerRating(
    loans.filter((l) => l.borrowerId === bid),
    today(),
    settings.scoring,
  );
  const overdue = active.some((l) =>
    l.installments.some((i) => installmentStatus(i) === "Overdue"),
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const input = {
        borrowerId: bid,
        amount: parseMoney(amount),
        income: parseMoney(income),
        term,
        releaseDate: date,
        releasedBy,
        rate: Number(rate) / 100,
        interestMode,
        inputMode,
        overrideCap: override,
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
      setBusy(false);
    }
  }
  async function draftSlip() {
    try {
      if (!b || !preview) return;
      const loan: Loan = {
        ...metadata("draft"),
        loanNo: "DRAFT · NOT RELEASED",
        borrowerId: b.id,
        borrowerSnapshot: b,
        incomeAtLoan: parseMoney(income),
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
      await printFile(await loanSlipPDF(loan, txn, settings));
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
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Borrower" full>
            <select
              aria-label="Borrower"
              value={bid}
              onChange={(e) => {
                const next = borrowers.find((b) => b.id === e.target.value);
                setBid(e.target.value);
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
              required
            />
          </Field>
          <Field label={`Term · up to ${maxTerm} months`} topic="term">
            <input
              aria-label="Term in months"
              type="number"
              min="1"
              max={maxTerm}
              value={term}
              onChange={(e) => setTerm(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Interest mode" topic="rate">
            <select
              value={interestMode}
              onChange={(e) => {
                const m = e.target.value as "upfront" | "added";
                setInterestMode(m);
                setInputMode(m === "added" ? "cash" : "face");
              }}
            >
              <option value="upfront">Deducted upfront</option>
              <option value="added">Added on top</option>
            </select>
          </Field>
          <Field label="Interest rate (%)" topic="rate">
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
                  Interest · new cash only <Help topic="interest" />
                </small>
                <b>
                  <Money amount={adv?.interest ?? preview.interest} />
                </b>
              </div>
              <div className="highlight">
                <small>
                  Net cash now <Help topic="net" />
                </small>
                <b>
                  <Money amount={adv?.netCash ?? preview.netRelease} />
                </b>
              </div>
              <div>
                <small>
                  Total to repay <Help topic="face" />
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
              Last installment includes any centavo remainder.
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
          Maximum {isAdvance ? "advance" : "face amount"}:{" "}
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
              This amount exceeds the income cap. An override will be added to
              the audit log.
            </p>
          )}
        </div>
        {exceeded && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            Override cap · record this decision in the audit log
          </label>
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
          Print the slip, sign on paper, and scan it here. You can also draw now
          or add a signature to the saved loan later.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button className="button small" type="button" onClick={draftSlip}>
            <Printer size={14} />
            Print draft slip
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
        <ErrorBox error={error || quoteError} />
        <div className="form-actions">
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
              (!override && !!exceeded) ||
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
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
              onChange={(e) => setAmount(e.target.value)}
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
            disabled={busy || !loan}
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
