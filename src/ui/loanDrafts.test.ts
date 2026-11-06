import { beforeEach, describe, expect, it } from "vitest";
import { db, initDB, saveSettings } from "../data/db";
import { createBorrower, createLoan } from "../data/service";
import { exportBackup, importBackup, parseBackup } from "../backup";
import { deleteLoanDraft, saveLoanDraft } from "./loanDrafts";
import type { LoanDraftInput } from "./loanDrafts";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initDB();
});

async function inputs(): Promise<LoanDraftInput> {
  const borrower = await createBorrower({
    fullName: "Draft QA",
    monthlyIncome: 100_000,
  });
  return {
    borrowerId: borrower.id,
    advance: false,
    advanceMode: "separate",
    income: "1000",
    affordabilityPercent: "100",
    maximumTerm: "",
    term: 3,
    rate: "10",
    interestMode: "upfront",
    inputMode: "face",
    amount: "3000",
    releaseDate: "2026-11-05",
    releasedBy: "Draft operator",
    notes: "Reviewed before release",
    overrideCap: false,
    overrideReason: "",
    witness: "",
    signatures: {
      borrower: {
        original: new Blob(["paper-scan"], { type: "image/png" }),
        processed: new Blob(["processed-signature"], { type: "image/png" }),
        capturedAt: "2026-11-05T01:00:00.000Z",
        signerName: "Draft QA",
      },
    },
  };
}

describe("editable origination drafts", () => {
  it("saves, updates, and deletes drafts without creating financial entries", async () => {
    const input = await inputs();
    const draft = await saveLoanDraft(input);
    const updated = await saveLoanDraft(
      { ...input, amount: "2500", notes: "Revised before signing" },
      draft.id,
    );
    expect(updated.id).toBe(draft.id);
    expect(updated.createdAt).toBe(draft.createdAt);
    expect((await db.settings.get("settings"))?.loanDrafts).toHaveLength(1);
    expect(await db.loans.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
    await deleteLoanDraft(draft.id);
    expect((await db.settings.get("settings"))?.loanDrafts).toHaveLength(0);
    await expect(saveLoanDraft(input, draft.id)).rejects.toThrow(
      /issued or removed/,
    );
    expect((await db.auditLogs.toArray()).map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "LOAN_DRAFT_CREATED",
        "LOAN_DRAFT_UPDATED",
        "LOAN_DRAFT_DELETED",
      ]),
    );
  });

  it("preserves parallel drafts and a stale settings editor cannot overwrite them", async () => {
    const input = await inputs();
    const stale = (await db.settings.get("settings"))!;
    await Promise.all([
      saveLoanDraft(input),
      saveLoanDraft({ ...input, amount: "2000" }),
    ]);
    await saveSettings({ ...stale, receiptFooter: "Updated receipt footer" });
    const current = await db.settings.get("settings");
    expect(current?.loanDrafts).toHaveLength(2);
    expect(current?.receiptFooter).toBe("Updated receipt footer");
  });

  it("round-trips editable terms and signature evidence in a full portable backup", async () => {
    const input = await inputs();
    const saved = await saveLoanDraft(input);
    const backup = parseBackup(await exportBackup());
    await deleteLoanDraft(saved.id);
    await importBackup(backup, "replace");
    const restored = (await db.settings.get("settings"))?.loanDrafts?.[0];
    expect(restored?.amount).toBe("3000");
    expect(restored?.advanceMode).toBe("separate");
    expect(await restored?.signatures.borrower?.original.text()).toBe(
      "paper-scan",
    );
    expect(await db.loans.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });

  it("consumes an issued draft atomically and rejects a duplicate release", async () => {
    const input = await inputs();
    const draft = await saveLoanDraft(input);
    const release = {
      draftId: draft.id,
      borrowerId: input.borrowerId,
      amount: 300_000,
      income: 100_000,
      affordabilityPercent: 100,
      term: 3,
      releaseDate: input.releaseDate,
      releasedBy: input.releasedBy,
    };
    await createLoan(release);
    expect((await db.settings.get("settings"))?.loanDrafts).toHaveLength(0);
    await expect(createLoan(release)).rejects.toThrow(/draft/i);
    await expect(saveLoanDraft(input, draft.id)).rejects.toThrow(
      /issued or removed/,
    );
    await expect(createLoan(release)).rejects.toThrow(/draft/i);
    expect(await db.loans.count()).toBe(1);
    expect(await db.transactions.count()).toBe(1);
  });
});
