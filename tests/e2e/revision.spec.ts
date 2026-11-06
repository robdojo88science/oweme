import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { jsPDF } from "jspdf";

const syntheticName = "QA Mina Flores";
const dialog = (page: Page) => page.getByRole("dialog");

async function storedSummary(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("oweme");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(
        ["borrowers", "loans", "transactions", "settings"],
        "readonly",
      );
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const [borrowers, loans, transactions, settings] = await Promise.all([
        read(transaction.objectStore("borrowers").getAll()),
        read(transaction.objectStore("loans").getAll()),
        read(transaction.objectStore("transactions").getAll()),
        read(transaction.objectStore("settings").get("settings")),
      ]);
      return {
        borrowers: borrowers.length,
        loans: loans.length,
        transactions: transactions.length,
        drafts: settings?.loanDrafts?.length ?? 0,
        documents: loans.reduce(
          (sum, loan) => sum + (loan.documents?.length ?? 0),
          0,
        ),
      };
    } finally {
      database.close();
    }
  });
}

async function closeDialog(page: Page) {
  await dialog(page)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
}

test("a fresh notebook has no demo records and exposes the five destinations and More tools", async ({
  page,
}) => {
  await page.goto("#/");
  await expect(page.locator(".home-page h1")).toBeVisible();
  await expect(page.locator(".portfolio-amount")).toHaveText("₱0.00");
  await expect(
    page.getByText("A clear schedule ahead", { exact: true }),
  ).toBeVisible();
  expect(await storedSummary(page)).toMatchObject({
    borrowers: 0,
    loans: 0,
    transactions: 0,
  });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link")).toHaveCount(5);
  for (const name of [
    "Home",
    "Borrowers",
    "Calculator",
    "Transactions",
    "More",
  ])
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  await navigation.getByRole("link", { name: "More", exact: true }).click();
  const cards = page.locator(".more-grid");
  for (const [name, href] of [
    ["Reports", "#/reports"],
    ["Agreements & receipts", "#/documents"],
    ["Activity", "#/activity"],
    ["Backups & recovery", "#/settings?section=backup"],
    ["Payment reminders", "#/reminders"],
    ["Settings", "#/settings"],
  ]) {
    await expect(
      cards.getByRole("link", { name: new RegExp(`^${name}`) }),
    ).toHaveAttribute("href", href);
  }
  await expect(page.locator(".more-privacy")).toContainText("0 borrowers");
});

test("settings numeric inputs can be cleared and valid zero courtesy days can be saved", async ({
  page,
}) => {
  await page.goto("#/settings");
  const courtesy = page.getByLabel("Courtesy days · internal", { exact: true });
  await courtesy.fill("");
  await expect(courtesy).toHaveValue("");
  await courtesy.fill("0");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.reload();
  await expect(courtesy).toHaveValue("0");
  const factor = page.getByLabel("Default affordability percentage", {
    exact: true,
  });
  await factor.fill("");
  await expect(factor).toHaveValue("");
  await factor.fill("35");
  await expect(factor).toHaveValue("35");
});

test("calculator shows the mandatory face deduction example and anchored monthly dates without saving records", async ({
  page,
}) => {
  await page.goto("#/calculator");
  await expect(
    page.getByRole("heading", { name: "Loan calculator", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Calculator monthly income", { exact: true })
    .fill("1000");
  await page.getByLabel("Calculator term", { exact: true }).fill("3");
  await page
    .getByLabel("Calculator affordability percentage", { exact: true })
    .fill("100");
  await page.getByLabel("Calculator amount", { exact: true }).fill("3000");
  await page
    .getByLabel("Calculator release date", { exact: true })
    .fill("2026-11-05");
  const results = page.getByRole("region", { name: "Calculator results" });
  await expect(results.locator(".calc-big .money")).toHaveText("₱2,700.00");
  await expect(results.locator(".quote-grid > div").nth(0)).toContainText(
    "₱3,000.00",
  );
  await expect(results.locator(".quote-grid > div").nth(1)).toContainText(
    "₱1,000.00",
  );
  await expect(results.locator(".quote-grid > div").nth(2)).toContainText(
    "₱300.00",
  );
  await expect(results.locator(".quote-grid > div").nth(3)).toContainText(
    "₱3,000.00",
  );
  await expect(results).toContainText("Total repayable / opening balance");
  await expect(results).toContainText("This commits 100% of reported income");
  await expect(results).toContainText("It is not a monthly rate or APR");
  const rows = results.locator(".schedule tbody tr");
  await expect(rows).toHaveCount(3);
  for (const [index, due] of [
    "2026-12-05",
    "2027-01-05",
    "2027-02-05",
  ].entries()) {
    await expect(rows.nth(index).locator("td").nth(1)).toHaveText(due);
    await expect(rows.nth(index).locator("td").nth(2)).toHaveText("₱1,000.00");
  }
  await page
    .getByLabel("Calculator release date", { exact: true })
    .fill("2026-01-31");
  for (const [index, due] of [
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ].entries())
    await expect(rows.nth(index).locator("td").nth(1)).toHaveText(due);
  expect(await storedSummary(page)).toMatchObject({
    borrowers: 0,
    loans: 0,
    transactions: 0,
  });
});

test("name-only borrowers can save and resume drafts, attach a PDF, and use grouped global search", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("#/borrowers");
  await page.getByRole("button", { name: "New borrower", exact: true }).click();
  await dialog(page)
    .getByLabel("Full name", { exact: true })
    .fill(syntheticName);
  await dialog(page)
    .getByRole("button", { name: "Add borrower", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: syntheticName, exact: true }),
  ).toBeVisible();
  expect(await storedSummary(page)).toMatchObject({
    borrowers: 1,
    loans: 0,
    transactions: 0,
  });
  await page.getByRole("button", { name: "New loan", exact: true }).click();
  await dialog(page)
    .getByLabel("Monthly income (Sahod)", { exact: true })
    .fill("1000");
  await dialog(page)
    .getByLabel("Loan affordability percentage", { exact: true })
    .fill("100");
  await dialog(page).getByLabel("Loan amount", { exact: true }).fill("3000");
  await dialog(page).getByLabel("Term in months", { exact: true }).fill("3");
  await dialog(page)
    .getByLabel("Release date", { exact: true })
    .fill("2026-11-05");
  await dialog(page)
    .getByLabel("Released by", { exact: true })
    .fill("QA Operator");
  await dialog(page)
    .getByLabel("Additional notes", { exact: true })
    .fill("Synthetic draft for automated verification");
  await dialog(page)
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  await expect(dialog(page).getByRole("status")).toContainText(
    "No funds released and no ledger entry created",
  );
  expect(await storedSummary(page)).toMatchObject({
    loans: 0,
    transactions: 0,
    drafts: 1,
  });
  await closeDialog(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: syntheticName, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New loan", exact: true }).click();
  await dialog(page)
    .locator("summary")
    .filter({ hasText: "Saved loan drafts (1)" })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Resume draft", exact: true })
    .click();
  await expect(
    dialog(page).getByLabel("Loan amount", { exact: true }),
  ).toHaveValue("3000");
  await expect(
    dialog(page).getByLabel("Released by", { exact: true }),
  ).toHaveValue("QA Operator");
  await expect(
    dialog(page).getByLabel("Release date", { exact: true }),
  ).toHaveValue("2026-11-05");
  expect(await storedSummary(page)).toMatchObject({
    loans: 0,
    transactions: 0,
    drafts: 1,
  });
  await dialog(page)
    .getByRole("checkbox", { name: /^I reviewed the agreement and confirm/ })
    .check();
  await dialog(page)
    .getByRole("button", { name: "Release loan", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("heading", { name: "Release receipt", exact: true }),
  ).toBeVisible();
  expect(await storedSummary(page)).toMatchObject({
    loans: 1,
    transactions: 1,
    drafts: 0,
  });
  await closeDialog(page);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  const pdf = new jsPDF();
  pdf.text("Synthetic signed paper for automated QA only", 20, 20);
  await page
    .getByLabel("Upload signed paper for L-001-01", { exact: true })
    .setInputFiles({
      name: "Signed paper test.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdf.output("arraybuffer")),
    });
  await expect(page.locator(".loan-document-gallery")).toContainText(
    "Signed paper test.pdf",
  );
  expect(await storedSummary(page)).toMatchObject({ documents: 1 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: syntheticName, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.locator(".loan-document-gallery")).toContainText(
    "Signed paper test.pdf",
  );
  await page.goto("#/more");
  await page.getByLabel("Global search", { exact: true }).fill(syntheticName);
  const results = page.getByRole("region", { name: "Notebook search results" });
  for (const group of ["Borrowers", "Loans", "Transactions", "Documents"])
    await expect(
      results.getByRole("heading", { name: group, exact: true }),
    ).toBeVisible();
  await expect(results).toContainText("On this device only");
  await expect(results).toContainText("OWM-DIS-2026-000001");
  await expect(page).toHaveURL(/#\/more$/);
  await results
    .getByRole("button")
    .filter({ hasText: "OWM-DIS-2026-000001" })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Void this cash release", exact: true })
    .click();
  await dialog(page)
    .getByLabel("Reason required", { exact: true })
    .fill("Synthetic duplicate release correction");
  await dialog(page)
    .getByRole("button", { name: "Void transaction", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Receipt preview" }),
  ).toContainText("VOIDED");
  await closeDialog(page);
  await page.goto("#/");
  await expect(page.locator(".portfolio-amount")).toHaveText("₱0.00");
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`empty notebook layouts fit ${viewport.name} and capture Home and More`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of [
      "/",
      "/borrowers",
      "/calculator",
      "/history",
      "/more",
      "/reports",
      "/documents",
      "/activity",
      "/backups",
      "/settings",
      "/reminders",
    ]) {
      await page.goto(`#${route}`);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          { message: `${viewport.name} ${route} must fit the viewport` },
        )
        .toBe(true);
      if (route === "/" || route === "/more") {
        await page.screenshot({
          path: info.outputPath(
            `${viewport.name}-${route === "/" ? "home" : "more"}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    expect(errors).toEqual([]);
  });
}
