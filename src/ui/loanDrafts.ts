import type { LoanDraft } from "../core/model";
import { db, initDB, metadata } from "../data/db";

export type LoanDraftInput = Omit<LoanDraft, "id" | "createdAt" | "updatedAt">;

/** Read the latest settings inside the write transaction, preserving parallel drafts. */
export async function saveLoanDraft(
  input: LoanDraftInput,
  id?: string,
): Promise<LoanDraft> {
  await initDB();
  return db.transaction(
    "rw",
    [db.settings, db.auditLogs, db.borrowers],
    async () => {
      const settings = await db.settings.get("settings");
      if (!settings)
        throw new Error("Open your notebook before saving a draft.");
      const borrower = await db.borrowers.get(input.borrowerId);
      if (!borrower || borrower.status !== "active")
        throw new Error("Choose an active borrower before saving this draft.");
      const old = settings.loanDrafts?.find((draft) => draft.id === id);
      if (id && !old)
        throw new Error(
          "This draft has already been issued or removed. Start a new draft explicitly.",
        );
      const draft: LoanDraft = {
        ...metadata(id),
        ...structuredClone(input),
        createdAt: old?.createdAt ?? new Date().toISOString(),
      };
      await db.settings.update("settings", {
        loanDrafts: [
          ...(settings.loanDrafts || []).filter((item) => item.id !== draft.id),
          draft,
        ],
        updatedAt: draft.updatedAt,
      });
      await db.auditLogs.add({
        ...metadata(),
        at: draft.updatedAt,
        action: old ? "LOAN_DRAFT_UPDATED" : "LOAN_DRAFT_CREATED",
        entity: "loan_draft",
        entityId: draft.id,
        detail: `Editable draft for borrower ${draft.borrowerId}; no funds released or ledger entry created.`,
      });
      return draft;
    },
  );
}

export async function deleteLoanDraft(
  id: string,
  issued = false,
): Promise<void> {
  await db.transaction("rw", [db.settings, db.auditLogs], async () => {
    const settings = await db.settings.get("settings");
    if (!settings?.loanDrafts?.some((draft) => draft.id === id)) return;
    const at = new Date().toISOString();
    await db.settings.update("settings", {
      loanDrafts: settings.loanDrafts.filter((draft) => draft.id !== id),
      updatedAt: at,
    });
    await db.auditLogs.add({
      ...metadata(),
      at,
      action: issued ? "LOAN_DRAFT_ISSUED" : "LOAN_DRAFT_DELETED",
      entity: "loan_draft",
      entityId: id,
      detail: issued
        ? "Draft removed after loan release."
        : "Editable draft removed; no issued loan or ledger entry affected.",
    });
  });
}
