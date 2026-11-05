import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const targetName = "Carmelita Del Rosario";
const targetId = "scale-b-5000";
const interactionTimeout = 20_000;

async function expectWindowedList(page: Page) {
  const rows = page
    .getByRole("listbox", { name: "Borrower accounts" })
    .getByRole("option");
  await expect
    .poll(() => rows.count(), { timeout: interactionTimeout })
    .toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThanOrEqual(14);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

test("a 5,000-borrower / 50,000-transaction notebook stays searchable and windowed on desktop and phone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("#/borrowers");
  await expect(
    page.getByRole("heading", { name: "Borrowers", exact: true }),
  ).toBeVisible();

  // Playwright supplies a fresh browser context. Seed its disposable IndexedDB only;
  // no development hook or sample records are included in the shipped application.
  const started = Date.now();
  const seededCounts = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("oweme");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const at = "2026-11-05T00:00:00.000Z";
    const meta = (id: string) => ({ id, createdAt: at, updatedAt: at });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ["borrowers", "loans", "transactions", "notes", "counters"],
        "readwrite",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Test dataset import aborted"));
      const borrowers = transaction.objectStore("borrowers");
      const loans = transaction.objectStore("loans");
      const payments = transaction.objectStore("transactions");
      const notes = transaction.objectStore("notes");
      const counters = transaction.objectStore("counters");
      for (const store of [borrowers, loans, payments, notes, counters])
        store.clear();
      const loanCounts: Record<string, number> = {};
      for (let number = 1; number <= 5000; number++) {
        const borrowerId = `scale-b-${number}`;
        const fullName =
          number === 5000
            ? "Carmelita Del Rosario"
            : `Borrower ${String(number).padStart(4, "0")} Family`;
        borrowers.put({
          ...meta(borrowerId),
          numericId: number,
          fullName,
          address: `Purok ${(number % 12) + 1}, Barangay Amihan`,
          monthlyIncome: 100_000,
          status: "active",
        });
        // Five hundred active loans supply real schedules without manufacturing
        // fifty thousand active agreements or retaining thousands of DOM rows.
        if (number % 10 !== 0) continue;
        const loanId = `scale-loan-${number}`;
        const borrowerSnapshot = { numericId: number, fullName };
        const loanNo = `L-${String(number).padStart(3, "0")}-01`;
        const installments = ["2026-12-05", "2027-01-05", "2027-02-05"].map(
          (dueDate, index) => ({
            no: index + 1,
            dueDate,
            graceUntil: dueDate.slice(0, 8) + "10",
            amountDue: 100_000,
            amountPaid: index === 0 ? 100_000 : 0,
            paidDate: index === 0 ? "2026-11-05" : undefined,
            status: index === 0 ? "Paid" : "Upcoming",
          }),
        );
        loans.put({
          ...meta(loanId),
          loanNo,
          borrowerId,
          borrowerSnapshot,
          incomeAtLoan: 100_000,
          termMonths: 3,
          rate: 0.1,
          interestMode: "upfront",
          faceAmount: 300_000,
          interestAmount: 30_000,
          netRelease: 270_000,
          monthlyAmount: 100_000,
          releaseDate: "2026-11-05",
          status: "active",
          installments,
          kind: "new",
          releasedBy: "Test lender",
          signatures: {},
        });
        loanCounts[borrowerId] = 1;
        for (let payment = 1; payment <= 100; payment++) {
          const sequence = (number / 10 - 1) * 100 + payment;
          payments.put({
            ...meta(`scale-t-${sequence}`),
            txnNo: `OM-20261105-${String(sequence).padStart(4, "0")}`,
            type: "PAYMENT",
            loanId,
            borrowerId,
            borrowerSnapshot,
            amount: 1000,
            method: "cash",
            receivedBy: "Test lender",
            balanceBefore: 300_000 - (payment - 1) * 1000,
            balanceAfter: 300_000 - payment * 1000,
            allocation: [{ installmentNo: 1, amount: 1000 }],
            date: "2026-11-05",
          });
        }
      }
      notes.put({
        ...meta("scale-manual-note"),
        borrowerId: "scale-b-5000",
        text: "Meet at Café Narra after the harvest",
        kind: "manual",
      });
      counters.put({
        ...meta("counters"),
        borrower: 5000,
        txnByDay: { "2026-11-05": 50_000 },
        loanByBorrower: loanCounts,
      });
    });
    const counts = await Promise.all(
      ["borrowers", "loans", "transactions"].map(
        (name) =>
          new Promise<number>((resolve, reject) => {
            const request = database
              .transaction(name)
              .objectStore(name)
              .count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
    database.close();
    return { borrowers: counts[0], loans: counts[1], transactions: counts[2] };
  });
  expect(seededCounts).toEqual({
    borrowers: 5000,
    loans: 500,
    transactions: 50_000,
  });
  // Reload lets Dexie's normal read path observe native IndexedDB seed writes.
  await page.reload();
  await expect(page.getByText("5000 found", { exact: true })).toBeVisible({
    timeout: interactionTimeout,
  });
  await expectWindowedList(page);
  await expectNoHorizontalOverflow(page);
  const list = page.getByRole("listbox", { name: "Borrower accounts" });
  await list.focus();
  await list.press("End");
  await expect(
    list.getByRole("option").filter({ hasText: targetName }),
  ).toBeVisible({ timeout: interactionTimeout });
  await expectWindowedList(page);
  await list.press("Enter");
  await expect(
    page.getByRole("heading", { name: targetName, exact: true }),
  ).toBeVisible({ timeout: interactionTimeout });
  await expect(page).toHaveURL(new RegExp(`/borrowers/${targetId}$`));
  await page
    .locator(".borrower-detail")
    .getByRole("button", { name: "All borrowers", exact: true })
    .click();

  const search = page.getByRole("textbox", {
    name: "Search borrowers",
    exact: true,
  });
  for (const query of [
    "Carmelita Del Rosaro",
    "#5000",
    "OM-20261105-50000",
    "NARRA cafe harvest",
  ]) {
    // Clear the prior result before each query so a previously visible target
    // cannot satisfy the assertion before the search debounce finishes.
    await search.fill("zxqvnoaccountunmatched");
    await expect(
      page.getByRole("heading", { name: "No matching accounts", exact: true }),
    ).toBeVisible({ timeout: interactionTimeout });
    const queryStarted = Date.now();
    await search.fill(query);
    await expect(
      list.getByRole("option").filter({ hasText: targetName }),
    ).toBeVisible({ timeout: interactionTimeout });
    await expectWindowedList(page);
    test.info().annotations.push({
      type: "search-duration",
      description: `${query}: ${Date.now() - queryStarted} ms`,
    });
  }
  await search.fill("");
  await expect(page.getByText("5000 found", { exact: true })).toBeVisible({
    timeout: interactionTimeout,
  });
  await list.focus();
  await list.press("Home");
  await expect(
    list.getByRole("option").filter({ hasText: "Borrower 0001 Family" }),
  ).toBeVisible({ timeout: interactionTimeout });

  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill("OM-20261105-50000");
  await expect(
    list.getByRole("option").filter({ hasText: targetName }),
  ).toBeVisible({ timeout: interactionTimeout });
  await expectWindowedList(page);
  await expectNoHorizontalOverflow(page);
  await list.getByRole("option").filter({ hasText: targetName }).click();
  await expect(
    page.getByRole("heading", { name: targetName, exact: true }),
  ).toBeVisible({ timeout: interactionTimeout });
  await expectNoHorizontalOverflow(page);
  await page
    .locator(".profile-actions")
    .getByRole("button", { name: "Receive payment", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Receive payment", exact: true }),
  ).toBeVisible({ timeout: interactionTimeout });
  await expect(
    page.getByRole("dialog").getByLabel("Payment amount", { exact: true }),
  ).toHaveValue("1000.00");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  expect(errors).toEqual([]);
  test.info().annotations.push({
    type: "dataset-duration",
    description: `Full notebook seed and desktop/phone interactions: ${Date.now() - started} ms`,
  });
});
