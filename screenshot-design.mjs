import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Login with just username (test mode)
await page.goto('https://crm.waybuild-software.de');
await page.waitForTimeout(2000);

const usernameField = page.locator('input[name="name"], input[type="text"]').first();
await usernameField.fill('can.chef');
await page.locator('button[type="submit"], input[type="submit"]').first().click();
await page.waitForTimeout(3000);

console.log('URL after login:', page.url());

// Dashboard
await page.screenshot({ path: '/tmp/m365-01-dashboard.png', fullPage: true });

// Kunden
await page.goto('https://crm.waybuild-software.de/kunden');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/m365-02-kunden.png', fullPage: true });

// Aufträge
await page.goto('https://crm.waybuild-software.de/auftraege');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/m365-03-auftraege.png', fullPage: true });

// To-dos (Kanban)
await page.goto('https://crm.waybuild-software.de/todos');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/m365-04-todos.png', fullPage: true });

// Plantafel
await page.goto('https://crm.waybuild-software.de/plantafel');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/m365-05-plantafel.png', fullPage: true });

// Angebot ansehen (falls vorhanden)
await page.goto('https://crm.waybuild-software.de/angebote');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/m365-06-angebote.png', fullPage: true });

await browser.close();
console.log('All screenshots done');
