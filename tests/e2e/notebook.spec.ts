import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const name = "Maria Santos";
const address = "Purok 1, Barangay San Isidro";
const pageErrors = new WeakMap<Page, string[]>();
const receipt = (page: Page) =>
  page.getByRole("article", { name: "Receipt preview" });
const dialog = (page: Page) => page.getByRole("dialog");
const rowValue = (page: Page, label: string) =>
  receipt(page)
    .locator(".receipt-row")
    .filter({
      has: page.locator("span").filter({ hasText: new RegExp(`^${label}$`) }),
    })
    .locator("b");

async function closeDialog(page: Page) {
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function createBorrower(page: Page) {
  await page.goto("#/borrowers");
  await page.getByRole("button", { name: "New borrower", exact: true }).click();
  await dialog(page).getByLabel("Full name", { exact: true }).fill(name);
  await dialog(page)
    .getByLabel("Address / Purok", { exact: true })
    .fill(address);
  await dialog(page)
    .getByLabel("Monthly income (Sahod)", { exact: true })
    .fill("1000");
  await dialog(page)
    .getByRole("button", { name: "Add borrower", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByText("Borrower account · #001", { exact: true }),
  ).toBeVisible();
}
async function createLoan(page: Page) {
  await createBorrower(page);
  await page.getByRole("button", { name: "New loan", exact: true }).click();
  await dialog(page).getByLabel("Loan amount", { exact: true }).fill("3000");
  await dialog(page).getByLabel("Term in months", { exact: true }).fill("3");
  await dialog(page)
    .getByLabel("Release date", { exact: true })
    .fill("2026-01-31");
  await dialog(page).getByLabel("Released by", { exact: true }).fill("Robert");
  await expect(dialog(page).locator(".quote-card")).toContainText("₱2,700.00");
  await expect(dialog(page).locator(".schedule")).toContainText("2026-02-28");
  await expect(dialog(page).locator(".schedule")).toContainText("2026-03-31");
  await expect(dialog(page).locator(".schedule")).toContainText("2026-04-30");
  await dialog(page)
    .getByRole("button", { name: "Release loan", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("heading", { name: "Release receipt", exact: true }),
  ).toBeVisible();
  await expect(receipt(page)).toContainText("OM-20260131-0001");
  await expect(receipt(page).locator(".receipt-amount")).toContainText(
    "₱2,700.00",
  );
  await expect(rowValue(page, "Balance after")).toHaveText("₱3,000.00");
}
async function pay(page: Page, amount: string, date: string, method = "cash") {
  await closeDialog(page);
  await page
    .getByRole("button", { name: "Receive payment", exact: true })
    .click();
  await dialog(page).getByLabel("Payment amount", { exact: true }).fill(amount);
  await dialog(page).getByLabel("Payment date", { exact: true }).fill(date);
  await dialog(page)
    .getByLabel("Payment method", { exact: true })
    .selectOption(method);
  if (method !== "cash") {
    await dialog(page)
      .getByLabel("Bank / provider", { exact: true })
      .fill("GCash");
    await dialog(page)
      .getByLabel("Reference number", { exact: true })
      .fill("GCASH-TEST-001");
  }
  await dialog(page).getByLabel("Received by", { exact: true }).fill("Robert");
  await dialog(page)
    .getByRole("button", { name: "Save payment", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("heading", { name: "Payment receipt", exact: true }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Each test receives a fresh browser context and its own disposable IndexedDB.
  const failures: string[] = [];
  pageErrors.set(page, failures);
  page.on("pageerror", (error) => failures.push(error.message));
});
test.afterEach(async ({ page }, info) => {
  const errors = pageErrors.get(page) ?? [];
  await info.attach("browser-errors", {
    body: JSON.stringify(errors),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});

test("creates a borrower and month-end loan, then allocates 500 and 1500 on stable receipts", async ({
  page,
}) => {
  await createLoan(page);
  await pay(page, "500", "2026-02-28");
  await expect(rowValue(page, "Balance before")).toHaveText("₱3,000.00");
  await expect(rowValue(page, "Balance after")).toHaveText("₱2,500.00");
  await expect(rowValue(page, "Installment 1")).toHaveText("₱500.00");
  await expect(receipt(page)).not.toContainText(/mercy|grace/i);
  await pay(page, "1500", "2026-03-01", "gcash");
  await expect(rowValue(page, "Balance before")).toHaveText("₱2,500.00");
  await expect(rowValue(page, "Balance after")).toHaveText("₱1,000.00");
  await expect(rowValue(page, "Installment 1")).toHaveText("₱500.00");
  await expect(rowValue(page, "Installment 2")).toHaveText("₱1,000.00");
  await expect(rowValue(page, "Reference number")).toHaveText("GCASH-TEST-001");
  await expect(
    dialog(page).getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeEnabled();
  const download = page.waitForEvent("download");
  await dialog(page)
    .getByRole("button", { name: "Download PDF", exact: true })
    .click();
  await expect((await download).suggestedFilename()).toBe(
    "OM-20260301-0001.pdf",
  );
  await closeDialog(page);
  await page.reload();
  await expect(page.locator(".profile-metrics")).toContainText("₱1,000.00");
});

test("finds borrower 001 by ID, accent-insensitive typo, address, and transaction number", async ({
  page,
}) => {
  await createLoan(page);
  await closeDialog(page);
  const search = page.getByLabel("Search borrowers", { exact: true });
  for (const query of [
    "1",
    "001",
    "#001",
    "Mria Santos",
    "sántos maria",
    "Purok 1",
    "OM-20260131-0001",
  ]) {
    await search.fill(query);
    await expect(
      page.getByRole("option").filter({ hasText: name }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "Matching transactions", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /OM-20260131-0001/ }).click();
  await expect(
    dialog(page).getByRole("heading", { name: "Release receipt", exact: true }),
  ).toBeVisible();
});

test("rejects a wrong delete phrase and preserves loan transactions after exact account deletion", async ({
  page,
}) => {
  await createLoan(page);
  await pay(page, "500", "2026-02-28");
  await closeDialog(page);
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  const confirmation = dialog(page).getByLabel("Delete confirmation", {
    exact: true,
  });
  const confirm = dialog(page).getByRole("button", {
    name: "Delete account",
    exact: true,
  });
  await confirmation.fill("Delete maria santos");
  await expect(confirm).toBeDisabled();
  await confirmation.fill("Delete Maria Santos ");
  await expect(confirm).toBeDisabled();
  await confirmation.fill("Delete Maria Santos");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "History", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".history-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".history-table")).toContainText(
    "Deleted account · #001",
  );
  await expect(page.locator(".history-table")).toContainText(
    "OM-20260131-0001",
  );
  await expect(page.locator(".history-table")).toContainText(
    "OM-20260228-0001",
  );
});

test("recalculates a merged advance, preserves its chain and auto note, and safely voids it", async ({
  page,
}) => {
  await createLoan(page);
  await pay(page, "1000", "2026-02-28");
  await closeDialog(page);
  await page.getByRole("button", { name: "Advance loan", exact: true }).click();
  await dialog(page).getByLabel("Loan amount", { exact: true }).fill("1000");
  await dialog(page)
    .getByLabel("Release date", { exact: true })
    .fill("2026-03-05");
  await dialog(page).getByLabel("Released by", { exact: true }).fill("Robert");
  await expect(dialog(page).locator(".quote-card")).toContainText("₱900.00");
  await expect(dialog(page).locator(".quote-card")).toContainText("₱3,000.00");
  await dialog(page).getByLabel("Term in months", { exact: true }).fill("2");
  await expect(dialog(page)).toContainText("No advance available");
  await expect(
    dialog(page).getByRole("button", { name: "Save advance", exact: true }),
  ).toBeDisabled();
  await dialog(page).getByLabel("Term in months", { exact: true }).fill("3");
  await dialog(page)
    .getByRole("button", { name: "Save advance", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("heading", { name: "Advance receipt", exact: true }),
  ).toBeVisible();
  await expect(rowValue(page, "Balance carried")).toHaveText("₱2,000.00");
  await expect(rowValue(page, "Interest on advance")).toHaveText("₱100.00");
  await expect(rowValue(page, "New face amount")).toHaveText("₱3,000.00");
  await expect(rowValue(page, "New monthly payment")).toHaveText("₱1,000.00");
  await expect(receipt(page)).not.toContainText(/mercy|grace/i);
  await closeDialog(page);
  await expect(page.locator(".loan-card")).toHaveCount(2);
  await expect(
    page.locator(".loan-card").filter({ hasText: "L-001-01" }).last(),
  ).toContainText("Rolled over");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.locator(".note-item")).toContainText(
    "Advance on 2026-03-05",
  );
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: /OM-20260305-0001/ }).click();
  await dialog(page)
    .getByRole("button", { name: "Void this advance", exact: true })
    .click();
  await dialog(page)
    .getByLabel("Reason required", { exact: true })
    .fill("Borrower cancelled the advance");
  await dialog(page)
    .getByRole("button", { name: "Void transaction", exact: true })
    .click();
  await expect(receipt(page)).toContainText("VOIDED");
  await closeDialog(page);
  await expect(page.locator(".profile-metrics")).toContainText("₱2,000.00");
  await page
    .getByRole("button", { name: "Loans", exact: false })
    .filter({ hasText: /^Loans/ })
    .click();
  await expect(page.locator(".loan-card")).toHaveCount(2);
  await expect(
    page.locator(".loan-card").filter({ hasText: "L-001-01" }).last(),
  ).not.toContainText("Rolled over");
});

test("keeps borrower and payment actions usable in a phone viewport without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createLoan(page);
  await closeDialog(page);
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Receive payment", exact: true }),
  ).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  await page.screenshot({
    path: "artifacts/mobile-borrower.png",
    fullPage: true,
  });
});

test("requires an external backup, exact clear phrase and a continuous three-second hold, then restores through import preview", async ({
  page,
}) => {
  // Exercise the real download fallback rather than opening a native save picker.
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: () => false,
      configurable: true,
    });
  });
  await createLoan(page);
  await closeDialog(page);
  await page.goto("#/settings");
  await page
    .getByRole("button", { name: "Clear all data", exact: true })
    .click();
  const hold = dialog(page).getByRole("button", {
    name: "Hold for 3 seconds to clear all local data",
    exact: true,
  });
  const savedCopy = dialog(page).getByRole("checkbox", {
    name: "I saved a full backup outside this browser and can find the file.",
    exact: true,
  });
  await expect(hold).toBeDisabled();
  await expect(savedCopy).toBeDisabled();
  await dialog(page)
    .getByLabel("Clear all confirmation", { exact: true })
    .fill("DELETE ALL DATA");
  await expect(hold).toBeDisabled();
  const downloadEvent = page.waitForEvent("download");
  await dialog(page)
    .getByRole("button", { name: "Save a full backup first", exact: true })
    .click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).toBeTruthy();
  const backupBytes = await readFile(path!);
  const backup = JSON.parse(backupBytes.toString("utf8"));
  expect(backup).toMatchObject({ app: "OweMe", schemaVersion: 1, lite: false });
  expect(backup.tables.borrowers).toHaveLength(1);
  expect(backup.tables.loans).toHaveLength(1);
  expect(backup.tables.transactions).toHaveLength(1);
  await savedCopy.check();
  await dialog(page)
    .getByLabel("Clear all confirmation", { exact: true })
    .fill("delete all data");
  await expect(hold).toBeDisabled();
  await dialog(page)
    .getByLabel("Clear all confirmation", { exact: true })
    .fill("DELETE ALL DATA ");
  await expect(hold).toBeDisabled();
  await dialog(page)
    .getByLabel("Clear all confirmation", { exact: true })
    .fill("DELETE ALL DATA");
  await expect(hold).toBeEnabled();
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText(
    "1 borrowers, 1 loans, and 1 transactions",
  );
  await expect(hold).toHaveText("Hold 3 seconds to clear");
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  await expect(dialog(page)).toHaveCount(0);
  await page.goto("#/borrowers");
  await expect(
    page.getByRole("heading", {
      name: "Room for your first borrower",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("#/history");
  await expect(
    page.getByRole("heading", {
      name: "A clear record from day one",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("#/settings");
  await page.getByLabel("Import a backup", { exact: false }).setInputFiles({
    name: "OweMe-test-backup.json",
    mimeType: "application/json",
    buffer: backupBytes,
  });
  await expect(
    dialog(page).getByRole("heading", {
      name: "Review backup import",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog(page)
      .locator("tr")
      .filter({ hasText: /^Borrowers1$/ }),
  ).toHaveCount(1);
  // No mutation occurs until the admin reviews and chooses a mode.
  await dialog(page)
    .getByRole("button", { name: "Merge backup", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await page.goto("#/borrowers");
  await expect(
    page.getByRole("option").filter({ hasText: name }),
  ).toBeVisible();
  await page.goto("#/history");
  await expect(page.locator(".history-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".history-table")).toContainText(
    "OM-20260131-0001",
  );
});
