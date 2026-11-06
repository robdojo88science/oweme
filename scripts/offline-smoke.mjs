/* global document, caches */
/**
 * Production PWA smoke test. Start `npm run build` and `npm run preview -- --port 4173` first.
 * Run `node scripts/offline-smoke.mjs [http://127.0.0.1:4173/oweme/]`.
 * All records live in a fresh, disposable browser context; no personal browser profile is used.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const baseURL = process.argv[2] || "http://127.0.0.1:4173/oweme/";
const channel =
  process.env.PLAYWRIGHT_CHANNEL ||
  (process.platform === "win32" ? "chrome" : undefined);
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: "Asia/Manila",
  locale: "en-PH",
  acceptDownloads: true,
  serviceWorkers: "allow",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const report = {
  baseURL,
  manifest: undefined,
  serviceWorker: undefined,
  cachedPDFFont: false,
  offlineReload: false,
  calculatorOffline: false,
  borrowerPersisted: false,
  offlinePayment: false,
  pdfBytes: 0,
  finalBalance: "",
  errors,
};
const dialog = () => page.getByRole("dialog");
const name = "OweMe Offline QA";
async function closeDialog() {
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog()).toHaveCount(0);
}

try {
  await mkdir("artifacts/offline", { recursive: true });
  await page.goto(baseURL + "#/borrowers");
  await page.getByRole("heading", { name: "Borrowers", exact: true }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller)))
    await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const pwa = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) throw new Error("No PWA manifest link.");
    const manifest = await (await fetch(link.href)).json();
    const registration = await navigator.serviceWorker.getRegistration();
    const fonts = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        if (/NotoSans.*\.ttf/i.test(request.url)) fonts.push(request.url);
    return {
      manifest,
      serviceWorker: {
        state: registration?.active?.state,
        scope: registration?.scope,
        controlling: !!navigator.serviceWorker.controller,
      },
      fonts,
    };
  });
  report.manifest = pwa.manifest;
  report.serviceWorker = pwa.serviceWorker;
  report.cachedPDFFont = pwa.fonts.length > 0;
  assert.equal(pwa.manifest.name, "OweMe");
  assert.equal(pwa.manifest.display, "standalone");
  assert(pwa.manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert(
    pwa.manifest.icons.some(
      (icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable"),
    ),
  );
  assert.equal(pwa.serviceWorker.state, "activated");
  assert.equal(pwa.serviceWorker.controlling, true);
  assert(
    report.cachedPDFFont,
    "Unicode PDF font is missing from the offline precache.",
  );

  await page.getByRole("button", { name: "New borrower", exact: true }).click();
  await dialog().getByLabel("Full name", { exact: true }).fill(name);
  await dialog()
    .getByLabel("Address / Purok", { exact: true })
    .fill("Disposable browser test - Purok QA");
  await dialog()
    .getByLabel("Monthly income (Sahod)", { exact: true })
    .fill("1000");
  await dialog()
    .getByRole("button", { name: "Add borrower", exact: true })
    .click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.getByRole("button", { name: "New loan", exact: true }).click();
  await dialog()
    .getByLabel("Loan affordability percentage", { exact: true })
    .fill("100");
  await dialog().getByLabel("Loan amount", { exact: true }).fill("3000");
  await dialog().getByLabel("Term in months", { exact: true }).fill("3");
  await dialog().getByLabel("Release date", { exact: true }).fill("2026-11-05");
  await dialog().getByLabel("Released by", { exact: true }).fill("Offline QA");
  await dialog()
    .getByRole("checkbox", { name: /I reviewed the agreement and confirm/ })
    .check();
  await dialog()
    .getByRole("button", { name: "Release loan", exact: true })
    .click();
  await dialog()
    .getByRole("heading", { name: "Release receipt", exact: true })
    .waitFor();
  await closeDialog();

  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name, exact: true }).waitFor();
  report.offlineReload = !(await page.evaluate(() => navigator.onLine));
  await page.goto(baseURL + "#/calculator");
  await page
    .getByRole("heading", { name: "Loan calculator", level: 1, exact: true })
    .waitFor();
  report.calculatorOffline = true;
  await page.goto(baseURL + "#/borrowers");
  await page.getByLabel("Search borrowers", { exact: true }).fill("001");
  await page.getByRole("option").filter({ hasText: name }).click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
  report.borrowerPersisted = true;
  await page
    .getByRole("button", { name: "Receive payment", exact: true })
    .click();
  await dialog().getByLabel("Payment amount", { exact: true }).fill("500");
  await dialog().getByLabel("Payment date", { exact: true }).fill("2026-12-05");
  await dialog().getByLabel("Received by", { exact: true }).fill("Offline QA");
  await dialog()
    .getByRole("button", { name: "Save payment", exact: true })
    .click();
  await dialog()
    .getByRole("heading", { name: "Payment receipt", exact: true })
    .waitFor();
  await expect(
    page.getByRole("article", { name: "Receipt preview" }),
  ).toContainText("₱2,500.00");
  await expect(
    dialog().getByRole("button", { name: "Download PDF", exact: true }),
  ).toBeEnabled();
  report.offlinePayment = true;
  const downloadPromise = page.waitForEvent("download");
  await dialog()
    .getByRole("button", { name: "Download PDF", exact: true })
    .click();
  const download = await downloadPromise;
  await download.saveAs("artifacts/offline/payment-receipt.pdf");
  const bytes = await readFile("artifacts/offline/payment-receipt.pdf");
  report.pdfBytes = bytes.length;
  assert(bytes.subarray(0, 5).toString() === "%PDF-");
  assert(bytes.length > 20_000, "PDF is missing its embedded Unicode font.");
  await page.screenshot({
    path: "artifacts/offline/receipt-offline.png",
    fullPage: true,
  });
  await closeDialog();
  await page.reload();
  await expect(page.locator(".profile-metrics").first()).toContainText("₱2,500.00");
  report.finalBalance = "₱2,500.00";
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/offline/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  await page
    .screenshot({ path: "artifacts/offline/failure.png", fullPage: true })
    .catch(() => {});
  await writeFile(
    "artifacts/offline/report.json",
    JSON.stringify({ ...report, failure: String(error) }, null, 2),
  );
  throw error;
} finally {
  await context.setOffline(false);
  await context.close();
  await browser.close();
}
