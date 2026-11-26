import { expect, test, type Page } from "@playwright/test";

// Local demo accounts from supabase/seed.sql (never production).
const PASSWORD = "TireFlow-demo-2026";

async function signIn(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(`${user}@tireflow.test`);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//);
}

test("owner signs in and sees the dashboard with real figures", async ({ page }) => {
  await signIn(page, "owner");
  await expect(page).toHaveURL(/\/app\/tireflow-demo\/dashboard/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // tire sets stored comes from the seeded data (60)
  await expect(page.getByText(/^6\d$/).first()).toBeVisible();
});

test("signed-out users are sent to sign in", async ({ page }) => {
  await page.goto("/app/tireflow-demo/customers");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("a visitor books online without an account and cancels via the private link", async ({ page }) => {
  await page.goto("/s/tireflow-demo?lang=en");
  await page.getByText("Seasonal wheel change").click();
  await expect(page.getByText(/Estimated price/)).toBeVisible();
  // pick the first day with free times
  const days = page.locator("button.shrink-0");
  const slot = page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first();
  for (let i = 1; i < 10; i++) {
    await days.nth(i).click();
    try {
      await slot.waitFor({ state: "visible", timeout: 5000 });
      await slot.click();
      break;
    } catch {
      // no free time that day, try the next one
    }
  }
  await page.getByLabel("First name").fill("E2E");
  await page.getByLabel("Phone").fill(`+420 601 ${String(Date.now()).slice(-6)}`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Booking confirmed")).toBeVisible();
  await page.getByText("Your booking", { exact: true }).click();
  await page.waitForURL(/\/booking\//);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Cancelled")).toBeVisible();
});

test("a mechanic cannot open finance", async ({ page }) => {
  await signIn(page, "mechanic");
  await page.goto("/app/tireflow-demo/finance");
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("link", { name: /finance|finance/i })).toHaveCount(0);
});
