import { describe, expect, it } from "vitest";
import type { Borrower, Loan, Transaction } from "../core/model";
import { schedule } from "../core/logic";
import { db } from "../data/db";
import { addNote } from "../data/service";
import { buildSearch, normalize } from "./search";

const at = "2026-11-05T00:00:00.000Z";
const person = (
  numericId: number,
  fullName = `Borrower ${numericId}`,
  address = "Purok Mahogany",
): Borrower => ({
  id: `borrower-${numericId}`,
  numericId,
  fullName,
  address,
  monthlyIncome: 100_000,
  status: "active",
  createdAt: at,
  updatedAt: at,
});
const loanFor = (borrower: Borrower, sequence = 1): Loan => ({
  id: `loan-${borrower.numericId}-${sequence}`,
  loanNo: `L-${String(borrower.numericId).padStart(3, "0")}-${String(sequence).padStart(2, "0")}`,
  borrowerId: borrower.id,
  borrowerSnapshot: borrower,
  incomeAtLoan: borrower.monthlyIncome,
  termMonths: 3,
  rate: 0.1,
  interestMode: "upfront",
  faceAmount: 300_000,
  interestAmount: 30_000,
  netRelease: 270_000,
  monthlyAmount: 100_000,
  releaseDate: "2026-11-05",
  status: "active",
  installments: schedule(300_000, 3, "2026-11-05"),
  kind: "new",
  releasedBy: "Maria",
  signatures: {},
  createdAt: at,
  updatedAt: at,
});
const transactionFor = (
  borrower: Borrower,
  loan: Loan,
  sequence: number,
): Transaction => ({
  id: `txn-${sequence}`,
  txnNo: `OM-20261105-${String(sequence).padStart(4, "0")}`,
  type: "PAYMENT",
  loanId: loan.id,
  borrowerId: borrower.id,
  borrowerSnapshot: borrower,
  amount: 10_000,
  method: "cash",
  receivedBy: "Maria",
  balanceBefore: 300_000,
  balanceAfter: 290_000,
  allocation: [{ installmentNo: 1, amount: 10_000 }],
  date: "2026-11-05",
  createdAt: at,
  updatedAt: at,
});

describe("borrower search", () => {
  const juan = {
    ...person(1, "Juan Dela Cruz", "Purok 4, Barangay Maligaya"),
    contact: "0917 123 4567",
    notes: "Sari-sari store beside the chapel",
  };
  const jose = person(2, "José María Santos", "Sitio Mabuhay");
  const loan = { ...loanFor(juan, 2), notes: "School uniform capital" };
  const transaction = {
    ...transactionFor(juan, loan, 27),
    notes: "Paid by cousin Ana",
  };
  const search = buildSearch([juan, jose], [loan], [transaction]);

  it.each(["1", "001", "#001"])(
    "finds the same numeric borrower ID as %s",
    (query) => {
      expect(search(query)?.has(juan.id)).toBe(true);
    },
  );
  it.each([
    "jose maria",
    "SANTOS JOSÉ",
    "Maria Santos Jose",
    "José María Santos",
  ])("ignores case, accents and word order: %s", (query) => {
    expect(search(query)?.has(jose.id)).toBe(true);
  });
  it.each(["Juam", "Crus Juan", "Sntos Jose"])(
    "tolerates realistic typing mistakes: %s",
    (query) => {
      expect(
        search(query)?.has(query.includes("Sntos") ? jose.id : juan.id),
      ).toBe(true);
    },
  );
  it.each([
    "Purok 4",
    "Maligaya",
    "chapel",
    "Sari-sari",
    "uniform capital",
    "cousin Ana",
    "L-001-02",
    "OM-20261105-0027",
  ])("indexes account, loan and transaction context: %s", (query) => {
    expect(search(query)?.has(juan.id)).toBe(true);
  });
  it.each(["0917 123 4567", "09171234567", "(0917) 123-4567"])(
    "finds a contact number with or without spaces: %s",
    (query) => {
      expect(search(query)?.has(juan.id)).toBe(true);
    },
  );
  it("returns no filter for whitespace and no results for unmatched words", () => {
    expect(search("   ")).toBeNull();
    expect(search("zzyzx unrelated")).toEqual(new Set());
  });
  it("does not depend on transaction borrower accounts still existing", () => {
    expect(() => buildSearch([jose], [loan], [transaction])).not.toThrow();
    expect(
      buildSearch([jose], [loan], [transaction])("José")?.has(jose.id),
    ).toBe(true);
  });
  it("normalizes decomposed accents as well as precomposed letters", () => {
    expect(normalize("JOSE\u0301")).toBe("jose");
  });
  it("narrows an exact ID instead of hiding it behind fuzzy numeric matches", () => {
    const people = [5, 50, 500, 1500, 4500, 4990, 5000].map((number) =>
      person(number),
    );
    const exactSearch = buildSearch(people, [], []);
    for (const query of ["5000", "#5000", "05000"])
      expect(exactSearch(query)).toEqual(new Set(["borrower-5000"]));
  });
  it("narrows exact loan and transaction numbers before fuzzy numeric matching", () => {
    const people = [4990, 4999, 5000].map((number) => person(number));
    const agreements = people.map((person) => loanFor(person));
    const payments = people.map((person, index) =>
      transactionFor(person, agreements[index], 49_998 + index),
    );
    const exactSearch = buildSearch(people, agreements, payments);
    expect(exactSearch("L-5000-01")).toEqual(new Set(["borrower-5000"]));
    expect(exactSearch("om-20261105-50000")).toEqual(
      new Set(["borrower-5000"]),
    );
    expect(exactSearch("OM-20261105-49999")).toEqual(
      new Set(["borrower-4999"]),
    );
  });
  it("finds a manual timeline note saved with addNote, ignoring accents, case, and word order", async () => {
    const note = await addNote(
      juan.id,
      "Meet at Café Amihan after the harvest",
    );
    try {
      const notes = await db.notes
        .where("borrowerId")
        .equals(juan.id)
        .toArray();
      const withTimeline = buildSearch(
        [juan, jose],
        [loan],
        [transaction],
        notes,
      );
      for (const query of [
        "cafe",
        "CAFÉ AMIHAN",
        "harvest Amihan",
        "amihan Juan",
      ]) {
        expect(withTimeline(query)?.has(juan.id)).toBe(true);
        expect(withTimeline(query)?.has(jose.id)).toBe(false);
      }
      expect(search("Amihan")?.has(juan.id)).toBe(false);
    } finally {
      await db.notes.delete(note.id);
    }
  });
});

describe("large notebook search", () => {
  it("indexes 5,000 borrowers and 50,000 transactions and resolves specific record context", () => {
    const borrowers = Array.from({ length: 5000 }, (_, index) =>
      person(
        index + 1,
        `Lendercustomer${index + 1} Family${index + 1}`,
        `Purok Village${index + 1}`,
      ),
    );
    const loans = borrowers.map((borrower) => loanFor(borrower));
    const transactions = Array.from({ length: 50_000 }, (_, index) =>
      transactionFor(
        borrowers[Math.floor(index / 10)],
        loans[Math.floor(index / 10)],
        index + 1,
      ),
    );
    transactions[49_999].notes = "Unique final collection landmark";
    const start = performance.now();
    const search = buildSearch(borrowers, loans, transactions);
    const builtAt = performance.now();
    expect(search("OM-20261105-50000")?.has("borrower-5000")).toBe(true);
    expect(
      search("Unique final collection landmark")?.has("borrower-5000"),
    ).toBe(true);
    expect(search("Family4321 Lendercustomer4321")?.has("borrower-4321")).toBe(
      true,
    );
    expect(search("Village3789")?.has("borrower-3789")).toBe(true);
    console.info(
      `Search benchmark: 5,000 borrowers / 50,000 transactions; index ${(builtAt - start).toFixed(0)} ms; four queries ${(performance.now() - builtAt).toFixed(0)} ms.`,
    );
  }, 30_000);
});
