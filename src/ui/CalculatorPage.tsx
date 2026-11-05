import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Calculator,
  CalendarDays,
  Coins,
  Sparkles,
} from "lucide-react";
import type { Borrower, Installment, Loan, Settings } from "../core/model";
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
import { Field, Schedule } from "./forms";
import type { LoanPreset } from "./forms";
import { Empty, ErrorBox, Help, Money, Stars } from "./primitives";

type Mode = "quick" | "reverse" | "payment" | "advance";
type CarriedPreset = LoanPreset & {
  advanceMode?: "merge" | "separate";
  previousLoanId?: string;
  releaseDate?: string;
  interestMode?: "upfront" | "added";
};

export function CalculatorPage({
  borrowers,
  loans,
  settings,
  onCreate,
}: {
  borrowers: Borrower[];
  loans: Loan[];
  settings: Settings;
  onCreate(preset: LoanPreset): void;
}) {
  const active = loans.filter(
    (loan) => loan.status === "active" && balance(loan) > 0,
  );
  const [mode, setMode] = useState<Mode>("quick");
  const [borrowerId, setBorrowerId] = useState("");
  const [income, setIncome] = useState("1000.00");
  const [term, setTerm] = useState(Math.min(3, settings.defaults.maxTerm));
  const [rate, setRate] = useState(String(settings.defaults.rate * 100));
  const [interestMode, setInterestMode] = useState(
    settings.defaults.interestMode,
  );
  const [amount, setAmount] = useState("");
  const [releaseDate, setReleaseDate] = useState(today());
  const [inputMode, setInputMode] = useState<"face" | "cash">(
    settings.defaults.interestMode === "added" ? "cash" : "face",
  );
  const [advanceMode, setAdvanceMode] = useState<"merge" | "separate">("merge");
  const [previousLoanId, setPreviousLoanId] = useState("");
  const [paymentLoanId, setPaymentLoanId] = useState(active[0]?.id || "");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const borrower = borrowers.find((item) => item.id === borrowerId);
  const borrowerLoans = active.filter((loan) => loan.borrowerId === borrowerId);
  const previousLoan =
    borrowerLoans.find((loan) => loan.id === previousLoanId) ||
    borrowerLoans[0];
  const paymentLoan =
    active.find((loan) => loan.id === paymentLoanId) || active[0];
  const monthlyUnpaid = paymentLoan?.installments.find(
    (item) => item.amountPaid < item.amountDue,
  );
  const defaultPayment = monthlyUnpaid
    ? monthlyUnpaid.amountDue - monthlyUnpaid.amountPaid
    : 0;
  const maxTerm = borrower?.maxTermOverride ?? settings.defaults.maxTerm;
  const graceDays = borrower?.graceDaysOverride ?? settings.defaults.graceDays;
  const exposure = borrowerLoans.reduce(
    (total, loan) => total + balance(loan),
    0,
  );
  const rating = borrowerRating(
    loans.filter((loan) => loan.borrowerId === borrowerId),
    today(),
    settings.scoring,
  );
  const overdue = borrowerLoans.some((loan) =>
    loan.installments.some((item) => installmentStatus(item) === "Overdue"),
  );
  let quote: ReturnType<typeof quoteLoan> | undefined;
  let advance: ReturnType<typeof quoteAdvance> | undefined;
  let payment: ReturnType<typeof allocatePayment> | undefined;
  let items: Installment[] = [];
  let error = "";
  let resolvedAmount = 0;
  const actualInputMode = mode === "reverse" ? "cash" : inputMode;
  try {
    if (mode === "payment") {
      if (paymentLoan)
        payment = allocatePayment(
          paymentLoan.installments,
          parseMoney(paymentAmount || moneyInput(defaultPayment)),
          paymentDate,
        );
    } else {
      if (term > maxTerm)
        throw new Error(`Choose a term up to ${maxTerm} months.`);
      if (!rate.trim())
        throw new Error(
          "Enter an interest rate, including 0 for an interest-free loan.",
        );
      const incomeCents = parseMoney(income || "0");
      const faceAtCap =
        mode === "advance"
          ? Math.max(
              0,
              incomeCents * term -
                (advanceMode === "merge" && previousLoan
                  ? balance(previousLoan)
                  : exposure),
            )
          : incomeCents * term;
      const atCap = quoteLoan({
        income: incomeCents,
        term,
        rate: Number(rate) / 100,
        interestMode,
        amount: faceAtCap,
        inputMode: "face",
      });
      resolvedAmount = parseMoney(
        amount ||
          moneyInput(actualInputMode === "cash" ? atCap.netRelease : faceAtCap),
      );
      quote = quoteLoan({
        income: incomeCents,
        term,
        rate: Number(rate) / 100,
        interestMode,
        amount: resolvedAmount,
        inputMode: actualInputMode,
      });
      if (mode === "advance" && previousLoan) {
        advance = quoteAdvance({
          balance: balance(previousLoan),
          allOutstanding: exposure,
          income: incomeCents,
          term,
          rate: Number(rate) / 100,
          interestMode,
          amount: resolvedAmount,
          inputMode: actualInputMode,
          mode: advanceMode,
          releaseDate,
          graceDays,
        });
        items = advance.installments;
      } else items = schedule(quote.face, term, releaseDate, graceDays);
    }
  } catch (cause) {
    error =
      cause instanceof Error ? cause.message : "Check the amounts and dates.";
  }

  const applyBorrower = (id: string) => {
    const person = borrowers.find((item) => item.id === id);
    setBorrowerId(id);
    setIncome(moneyInput(person?.monthlyIncome ?? 100_000));
    setRate(String((person?.rateOverride ?? settings.defaults.rate) * 100));
    setTerm(Math.min(3, person?.maxTermOverride ?? settings.defaults.maxTerm));
    setPreviousLoanId(active.find((loan) => loan.borrowerId === id)?.id || "");
    setAmount("");
  };
  const changeMode = (next: Mode) => {
    setMode(next);
    setAmount("");
    if (next === "advance" && !borrowerLoans.length)
      applyBorrower(
        borrowers.find(
          (person) =>
            person.status === "active" &&
            active.some((loan) => loan.borrowerId === person.id),
        )?.id || "",
      );
  };
  const changeInputMode = (next: "face" | "cash") => {
    setInputMode(next);
    if (advance)
      setAmount(
        moneyInput(next === "face" ? advance.advanceFace : advance.netCash),
      );
    else if (quote)
      setAmount(moneyInput(next === "face" ? quote.face : quote.netRelease));
  };
  const create = () => {
    if (error || !quote || (mode === "advance" && !previousLoan)) return;
    const preset: CarriedPreset = {
      borrowerId: borrowerId || undefined,
      term,
      amount: moneyInput(resolvedAmount),
      inputMode: actualInputMode,
      income,
      rate,
      advance: mode === "advance",
      advanceMode,
      previousLoanId: previousLoan?.id,
      releaseDate,
      interestMode,
    };
    onCreate(preset);
  };
  const capExceeded = advance?.capExceeded ?? quote?.capExceeded;
  const face = advance?.newFace ?? quote?.face ?? 0;
  const monthly = advance?.monthly ?? quote?.monthly ?? 0;
  const cash = advance?.netCash ?? quote?.netRelease ?? 0;
  const interest = advance?.interest ?? quote?.interest ?? 0;
  const eligible = borrowers.filter(
    (person) =>
      person.status === "active" &&
      (mode !== "advance" ||
        active.some((loan) => loan.borrowerId === person.id)),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Make the numbers clear.</h1>
          <p>Explore a loan, payment, or advance. Every centavo adds up.</p>
        </div>
        <span className="date-pill desktop-only">
          <Sparkles size={14} />
          Live calculations
        </span>
      </div>
      <div className="calc-layout">
        <section className="panel calc-inputs" aria-label="Calculator inputs">
          <div className="section-title">
            <h2>
              Loan calculator <Help topic="face" />
            </h2>
            <Calculator size={17} color="#9a94c5" />
          </div>
          <div
            className="segmented"
            role="tablist"
            aria-label="Calculator mode"
          >
            {(
              [
                ["quick", "Quick loan"],
                ["reverse", "Reverse"],
                ["payment", "Payment"],
                ["advance", "Advance"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={mode === key}
                className={mode === key ? "active" : ""}
                key={key}
                onClick={() => changeMode(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "payment" ? (
            <>
              <Field label="Choose a loan">
                <select
                  value={paymentLoan?.id || ""}
                  onChange={(event) => {
                    setPaymentLoanId(event.target.value);
                    setPaymentAmount("");
                  }}
                  aria-label="Calculator payment loan"
                >
                  <option value="">Choose an active loan</option>
                  {active.map((loan) => (
                    <option key={loan.id} value={loan.id}>
                      {loan.borrowerSnapshot.fullName} · {loan.loanNo}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form-grid" style={{ marginTop: 18 }}>
                <Field label="Payment amount">
                  <input
                    inputMode="decimal"
                    value={paymentAmount}
                    placeholder={moneyInput(defaultPayment)}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    aria-label="Calculator payment amount"
                  />
                </Field>
                <Field label="Payment date">
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(event) => setPaymentDate(event.target.value)}
                  />
                </Field>
              </div>
              <div className="filter-chips" style={{ marginTop: 15 }}>
                <button
                  className="filter-chip"
                  onClick={() => setPaymentAmount(moneyInput(defaultPayment))}
                >
                  Next installment
                </button>
                <button
                  className="filter-chip"
                  onClick={() =>
                    setPaymentAmount(
                      moneyInput(paymentLoan ? balance(paymentLoan) : 0),
                    )
                  }
                >
                  Full balance
                </button>
              </div>
              <p className="caption">
                This preview applies money to the oldest unpaid installment
                first. It does not save a payment.
              </p>
            </>
          ) : (
            <>
              <Field label="Use borrower" topic="income">
                <select
                  value={borrowerId}
                  onChange={(event) => applyBorrower(event.target.value)}
                  aria-label="Calculator borrower"
                >
                  <option value="">
                    {mode === "advance"
                      ? "Choose a borrower with an active loan"
                      : "Quick estimate · no borrower selected"}
                  </option>
                  {eligible.map((person) => (
                    <option key={person.id} value={person.id}>
                      #
                      {borrowerNumber(
                        person.numericId,
                        settings.borrowerPrefix,
                      )}{" "}
                      · {person.fullName}
                    </option>
                  ))}
                </select>
                <small>
                  Uses the borrower's income, rate, and maximum term.
                </small>
              </Field>
              {mode === "advance" && previousLoan && (
                <>
                  <div className={`alert ${overdue ? "amber" : ""}`}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <span>
                        Outstanding <b>{formatMoney(exposure)}</b>
                      </span>
                      <Stars stars={rating.stars} />
                    </div>
                    <p>Record any payment first so the balance is current.</p>
                    {overdue && (
                      <p>
                        This account has overdue installments. Review the
                        history before releasing more cash.
                      </p>
                    )}
                  </div>
                  <Field label="Current loan">
                    <select
                      value={previousLoan.id}
                      onChange={(event) => {
                        setPreviousLoanId(event.target.value);
                        setAmount("");
                      }}
                    >
                      {borrowerLoans.map((loan) => (
                        <option key={loan.id} value={loan.id}>
                          {loan.loanNo} · {formatMoney(balance(loan))}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="segmented" style={{ marginTop: 17 }}>
                    {(["merge", "separate"] as const).map((value) => (
                      <button
                        key={value}
                        className={advanceMode === value ? "active" : ""}
                        onClick={() => {
                          setAdvanceMode(value);
                          setAmount("");
                        }}
                      >
                        {value === "merge"
                          ? "Merge into one loan"
                          : "Separate loan"}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="form-grid" style={{ marginTop: 19 }}>
                <Field label="Monthly income (Sahod)" topic="income">
                  <input
                    value={income}
                    inputMode="decimal"
                    onChange={(event) => setIncome(event.target.value)}
                    aria-label="Calculator monthly income"
                  />
                </Field>
                <Field label={`Months · up to ${maxTerm}`} topic="term">
                  <input
                    type="number"
                    min="1"
                    max={maxTerm}
                    value={term}
                    onChange={(event) => setTerm(Number(event.target.value))}
                    aria-label="Calculator term"
                  />
                </Field>
                <Field label="Interest rate (%)" topic="rate">
                  <input
                    type="number"
                    min="0"
                    max="99.99"
                    step="0.01"
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                    aria-label="Calculator interest rate"
                  />
                </Field>
                <Field label="Interest mode" topic="rate">
                  <select
                    value={interestMode}
                    onChange={(event) => {
                      setInterestMode(
                        event.target.value as "upfront" | "added",
                      );
                      setAmount("");
                    }}
                  >
                    <option value="upfront">Deducted upfront</option>
                    <option value="added">Added on top</option>
                  </select>
                </Field>
                {mode !== "reverse" && (
                  <div className="field full">
                    <span>Amount entered as</span>
                    <div className="segmented">
                      <button
                        className={inputMode === "face" ? "active" : ""}
                        onClick={() => changeInputMode("face")}
                      >
                        {mode === "advance"
                          ? "Additional amount to repay"
                          : "Face amount"}
                      </button>
                      <button
                        className={inputMode === "cash" ? "active" : ""}
                        onClick={() => changeInputMode("cash")}
                      >
                        Cash to hand over
                      </button>
                    </div>
                  </div>
                )}
                <Field
                  label={
                    actualInputMode === "cash"
                      ? "Cash I want to release"
                      : mode === "advance"
                        ? "Additional face amount"
                        : "Face amount (optional)"
                  }
                  topic={actualInputMode === "cash" ? "net" : "face"}
                >
                  <input
                    inputMode="decimal"
                    value={amount}
                    placeholder={moneyInput(resolvedAmount)}
                    onChange={(event) => setAmount(event.target.value)}
                    aria-label="Calculator amount"
                  />
                  <small>Leave blank to use the available income cap.</small>
                </Field>
                <Field
                  label={mode === "advance" ? "Advance date" : "Release date"}
                >
                  <input
                    type="date"
                    value={releaseDate}
                    onChange={(event) => setReleaseDate(event.target.value)}
                    aria-label="Calculator release date"
                  />
                </Field>
              </div>
            </>
          )}
          <ErrorBox error={error} />
          <div className="tip-card">
            <Coins size={17} />
            <div>
              <b>Small details. Exact totals.</b>Money uses integer centavos.
              The final installment absorbs rounding, and each due date follows
              the original release day.
            </div>
          </div>
        </section>
        <section
          className="panel calc-results"
          aria-label="Calculator results"
          aria-live="polite"
        >
          {mode === "payment" ? (
            payment && paymentLoan ? (
              <>
                <div className="calc-big">
                  <small>BALANCE AFTER PAYMENT</small>
                  <Money amount={payment.balanceAfter} />
                  <p>
                    {paymentLoan.loanNo} ·{" "}
                    {paymentLoan.borrowerSnapshot.fullName}
                  </p>
                </div>
                <div className="section-title">
                  <h2>Where the payment goes</h2>
                  <span className="status purple">Preview only</span>
                </div>
                <table className="schedule">
                  <thead>
                    <tr>
                      <th>Installment</th>
                      <th>Official due date</th>
                      <th>Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payment.allocation.map((allocation) => (
                      <tr key={allocation.installmentNo}>
                        <td>{allocation.installmentNo}</td>
                        <td>
                          {
                            paymentLoan.installments.find(
                              (item) => item.no === allocation.installmentNo,
                            )?.dueDate
                          }
                        </td>
                        <td>
                          <Money amount={allocation.amount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="quote-grid" style={{ marginTop: 25 }}>
                  <div>
                    <small>Balance before</small>
                    <b>
                      <Money amount={payment.balanceBefore} />
                    </b>
                  </div>
                  <div>
                    <small>Amount allocated</small>
                    <b>
                      <Money
                        amount={payment.allocation.reduce(
                          (total, allocation) => total + allocation.amount,
                          0,
                        )}
                      />
                    </b>
                  </div>
                </div>
                {payment.unappliedAmount > 0 && (
                  <div className="alert amber">
                    Overpayment credit{" "}
                    <b>{formatMoney(payment.unappliedAmount)}</b> stays on this
                    payment. It is not automatically applied to another loan.
                  </div>
                )}
              </>
            ) : (
              <Empty
                icon={<Coins size={25} />}
                title="Choose an active loan"
                body="Once a loan has a remaining balance, you can preview partial, prepaid, and full payments here."
              />
            )
          ) : mode === "advance" && !previousLoan ? (
            <Empty
              icon={<ArrowUpRight size={26} />}
              title="An advance starts with an active loan"
              body="Choose a borrower with an outstanding loan to see the carried balance and new cash side by side."
            />
          ) : quote && !error ? (
            <>
              <div className="calc-big">
                <small>
                  {mode === "advance" ? "CASH TO HAND OVER NOW" : "NET RELEASE"}
                </small>
                <Money amount={cash} />
                <p>
                  {mode === "advance"
                    ? "Interest applies only to this new advance."
                    : "The actual cash the borrower receives."}
                </p>
              </div>
              <div className="quote-grid">
                <div>
                  <small>
                    {mode === "advance" ? "New total to repay" : "Face amount"}{" "}
                    <Help topic="face" />
                  </small>
                  <b>
                    <Money amount={face} />
                  </b>
                </div>
                <div>
                  <small>
                    Monthly payment <Help topic="term" />
                  </small>
                  <b>
                    <Money amount={monthly} />
                  </b>
                </div>
                <div>
                  <small>
                    Interest <Help topic="interest" />
                  </small>
                  <b>
                    <Money amount={interest} />
                  </b>
                </div>
                <div>
                  <small>
                    {mode === "advance"
                      ? "Maximum advance available"
                      : "Maximum face allowed"}{" "}
                    <Help topic="cap" />
                  </small>
                  <b>
                    <Money amount={advance?.maxAdvance ?? quote.maxFace} />
                  </b>
                </div>
              </div>
              {advance && previousLoan && (
                <div className="before-after">
                  <div>
                    <small>BEFORE · {previousLoan.loanNo}</small>
                    <b>
                      <Money amount={balance(previousLoan)} />
                    </b>
                    <p>
                      Current balance
                      <br />
                      {formatMoney(previousLoan.monthlyAmount)} per month
                    </p>
                  </div>
                  <ArrowRight size={18} color="#a49dc9" />
                  <div>
                    <small>
                      AFTER ·{" "}
                      {advanceMode === "merge"
                        ? "ONE MERGED LOAN"
                        : "NEW SEPARATE LOAN"}
                    </small>
                    <b>
                      <Money amount={advance.newFace} />
                    </b>
                    <p>
                      {term} months · {formatMoney(advance.monthly)} monthly
                      <br />
                      {advanceMode === "merge"
                        ? "Carried balance " +
                          formatMoney(advance.carriedBalance)
                        : "Old loan keeps its schedule"}
                    </p>
                  </div>
                </div>
              )}
              {advance?.maxAdvance === 0 && (
                <div className="alert amber">
                  No advance available. Existing exposure reaches the income cap
                  for this term. An explicit, audited cap override is available
                  in the advance form.
                </div>
              )}
              {capExceeded && (
                <div className="alert amber">
                  This amount exceeds the income cap. Review it before release;
                  saving requires an explicit cap override in the loan form.
                </div>
              )}
              <div className="section-title" style={{ marginTop: 28 }}>
                <h2>Monthly schedule</h2>
                <CalendarDays size={16} color="#a6a2bb" />
              </div>
              <Schedule items={items} admin={false} />
              <p className="caption" style={{ marginTop: 15 }}>
                Official due dates only. The last installment includes any
                centavo remainder.
              </p>
              <button
                className="button primary full"
                style={{ marginTop: 23 }}
                disabled={resolvedAmount <= 0}
                onClick={create}
              >
                {mode === "advance"
                  ? "Create advance from this"
                  : "Create loan from this"}
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <Empty
              icon={<Calculator size={25} />}
              title="Adjust the inputs"
              body="Use a valid amount, rate, term, and release date to see the live calculation."
            />
          )}
        </section>
      </div>
    </>
  );
}
