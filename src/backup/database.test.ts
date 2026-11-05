import { beforeEach, describe, expect, it } from "vitest";
import { db, initDB } from "../data/db";
import {
  addNote,
  createBorrower,
  createLoan,
  deleteBorrower,
  receivePayment,
} from "../data/service";
import {
  createSnapshot,
  exportBackup,
  importBackup,
  previewImport,
  restoreSnapshot,
} from "./index";
import { parseBackup } from "./format";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initDB();
});

async function sampleLedger() {
  const borrower = await createBorrower({
    fullName: "Juan Dela Cruz",
    address: "Purok 1",
    monthlyIncome: 100_000,
    photo: new Blob(["photo"], { type: "image/jpeg" }),
  });
  const { loan } = await createLoan({
    borrowerId: borrower.id,
    amount: 300_000,
    term: 3,
    releaseDate: "2026-11-05",
    releasedBy: "Maria",
  });
  await receivePayment({
    loanId: loan.id,
    amount: 50_000,
    date: "2026-12-05",
    method: "cash",
    receivedBy: "Maria",
  });
  return { borrower, loan };
}

describe("safe local database restore", () => {
  it("does not revive a deleted borrower's manual notes when merging an older full backup", async () => {
    const { borrower, loan } = await sampleLedger();
    const note = await addNote(
      borrower.id,
      "Private interview: market stall beside the chapel",
    );
    const beforeDeletion = parseBackup(await exportBackup());
    expect(beforeDeletion.tables.notes.some((row) => row.id === note.id)).toBe(
      true,
    );
    await deleteBorrower(borrower.id, `Delete ${borrower.fullName}`);
    await importBackup(beforeDeletion, "merge");
    expect(await db.borrowers.get(borrower.id)).toBeUndefined();
    expect(await db.notes.where("borrowerId").equals(borrower.id).count()).toBe(
      0,
    );
    expect(await db.loans.get(loan.id)).toBeDefined();
    expect(
      await db.transactions.where("borrowerId").equals(borrower.id).count(),
    ).toBe(2);
    expect(
      await db.tombstones.where("entityId").equals(borrower.id).count(),
    ).toBe(1);
  });
  it("exports and restores the complete ledger and images into a fresh database", async () => {
    const { borrower, loan } = await sampleLedger();
    const json = await exportBackup();
    const preview = await previewImport(json);
    expect(preview.counts.borrowers).toBe(1);
    expect(preview.counts.transactions).toBe(2);
    expect(preview.from).toBe("2026-11-05");
    expect(preview.to).toBe("2026-12-05");
    await db.transaction("rw", db.tables, async () => {
      for (const table of db.tables) await table.clear();
    });
    await importBackup(preview.backup, "replace");
    expect((await db.loans.get(loan.id))?.installments[0].amountPaid).toBe(
      50_000,
    );
    expect(await (await db.borrowers.get(borrower.id))?.photo?.text()).toBe(
      "photo",
    );
    expect(await db.transactions.count()).toBe(2);
    expect(await db.snapshots.count()).toBe(1);
  });

  it("does not mutate data or create a snapshot for corrupt input", async () => {
    await sampleLedger();
    const original = parseBackup(await exportBackup());
    original.tables.borrowers[0].monthlyIncome = 0.1;
    await expect(importBackup(original, "replace")).rejects.toThrow();
    expect(await db.borrowers.count()).toBe(1);
    expect(await db.transactions.count()).toBe(2);
    expect(await db.snapshots.count()).toBe(0);
  });

  it("Lite Merge keeps local image evidence while Lite Replace explicitly removes it", async () => {
    const { borrower } = await sampleLedger();
    const signature = {
      signerName: "Juan Dela Cruz",
      capturedAt: "2026-11-05T00:00:00.000Z",
      original: new Blob(["paper"], { type: "image/jpeg" }),
      processed: new Blob(["ink"], { type: "image/png" }),
    };
    const loan = (await db.loans.toArray())[0];
    await db.loans.update(loan.id, { signatures: { borrower: signature } });
    const lite = parseBackup(await exportBackup(true));
    lite.tables.borrowers[0].address = "Updated address";
    lite.tables.borrowers[0].updatedAt = "2099-01-01T00:00:00.000Z";
    lite.tables.loans[0].updatedAt = "2099-01-01T00:00:00.000Z";
    await importBackup(lite, "merge");
    expect(await (await db.borrowers.get(borrower.id))?.photo?.text()).toBe(
      "photo",
    );
    expect(
      await (
        await db.loans.get(loan.id)
      )?.signatures.borrower?.processed.text(),
    ).toBe("ink");
    expect((await db.borrowers.get(borrower.id))?.address).toBe(
      "Updated address",
    );
    await importBackup(lite, "replace");
    expect((await db.borrowers.get(borrower.id))?.photo).toBeUndefined();
    expect(
      (await db.loans.get(loan.id))?.signatures.borrower?.processed,
    ).toBeUndefined();
  });

  it("saves a pre-import recovery snapshot and retains only the latest five", async () => {
    await sampleLedger();
    for (let index = 0; index < 7; index++)
      await createSnapshot(`Snapshot ${index}`);
    expect(await db.snapshots.count()).toBe(5);
    const before = await exportBackup();
    const backup = parseBackup(before);
    backup.tables.borrowers[0].fullName = "Changed name";
    backup.tables.borrowers[0].updatedAt = "2099-01-01T00:00:00.000Z";
    await importBackup(backup, "merge");
    expect((await db.borrowers.toArray())[0].fullName).toBe("Changed name");
    const snapshot = (await db.snapshots.toArray()).find(
      (row) => row.reason === "Before merge import",
    );
    expect(snapshot).toBeDefined();
    const recovery = await restoreSnapshot(snapshot!.id);
    expect(recovery.backup.tables.borrowers[0].fullName).toBe("Juan Dela Cruz");
    expect(await db.snapshots.count()).toBe(5);
  });

  it("keeps records when different devices assign the same borrower, loan and transaction numbers", async () => {
    await sampleLedger();
    const backup = parseBackup(await exportBackup());
    const oldBorrowerId = String(backup.tables.borrowers[0].id);
    const oldLoanId = String(backup.tables.loans[0].id);
    backup.tables.borrowers[0].id = "incoming-borrower";
    backup.tables.loans[0].id = "incoming-loan";
    backup.tables.loans[0].borrowerId = "incoming-borrower";
    for (const [index, transaction] of backup.tables.transactions.entries()) {
      transaction.id = `incoming-transaction-${index}`;
      transaction.borrowerId = "incoming-borrower";
      transaction.loanId = "incoming-loan";
    }
    backup.tables.auditLogs = [];
    const summary = await importBackup(backup, "merge");
    expect(summary.conflicts).toHaveLength(3);
    expect(await db.borrowers.count()).toBe(2);
    expect(await db.loans.count()).toBe(2);
    expect(await db.transactions.count()).toBe(4);
    expect((await db.borrowers.get(oldBorrowerId))?.numericId).toBe(1);
    expect((await db.loans.get(oldLoanId))?.loanNo).toBe("L-001-01");
    expect((await db.loans.get("incoming-loan"))?.loanNo).toBe("L-002-01");
  });
});
