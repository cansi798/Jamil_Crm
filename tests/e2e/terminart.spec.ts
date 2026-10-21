import { expect, test, type Page } from '@playwright/test';
import { tagKurz, tagPlus, berlinTag } from '../../src/lib/zeit';
import { erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Terminarten (Jamil msg 3074): eine gepflegte Liste unter Einstellungen → Terminarten, wählbar im Dialog „Einsatz
 * anlegen“ der Plantafel (Dauer füllt „Bis“), sichtbar am Termin, änderbar und abwählbar („– keine –“). Nur „online
 * buchbare“ Terminarten sind über ihren Buchungslink erreichbar. Läuft nur auf einem eigenen Testserver; am Ende
 * (auch nach einem Fehler) räumt /api/testmodus/aufraeumen Terminart und Termin weg.
 */

nurAufTestserver(test);

const kennungen: string[] = [];

async function alsChef(page: Page) {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
}

test.afterAll(async ({ browser }) => {
	if (kennungen.length === 0) return;
	const ctx = await browser.newContext();
	try {
		const page = await ctx.newPage();
		await alsChef(page);
		for (const kennung of kennungen.splice(0)) {
			// über fetch im Browser (das Sitzungs-Cookie ist „Secure“ und geht über http nur im Browser auf 127.0.0.1 mit)
			const r = await page.evaluate(async (k) => {
				const a = await fetch('/api/testmodus/aufraeumen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kennung: k }) });
				return { status: a.status, text: await a.text() };
			}, kennung);
			expect(r.status, r.text).toBe(200);
		}
	} finally {
		await ctx.close();
	}
});

test('Terminart anlegen, im Einsatz-Dialog wählen (Dauer → Bis), am Termin sehen, ändern; online buchbar steuert den Link', async ({ page }, info) => {
	test.setTimeout(120_000);
	const projekt = info.project.name;
	const kennung = `${projekt}-${Date.now().toString(36)}`;
	kennungen.push(kennung);
	const name = `E2E Terminart ${kennung}`;
	const titel = `E2E Termin ${kennung}`;
	await alsChef(page);

	// 1. Terminart anlegen: 90 Minuten, NICHT online buchbar
	await page.goto('/einstellungen/terminarten');
	await expect(page.getByRole('heading', { level: 1, name: 'Terminarten' })).toBeVisible();
	await page.getByRole('button', { name: 'Terminart hinzufügen' }).click();
	const neu = page.getByRole('region', { name: 'Terminart hinzufügen' });
	await neu.getByLabel('Name').fill(name);
	await neu.getByLabel('Dauer (Minuten)').fill('90');
	await neu.getByRole('checkbox', { name: /Online buchbar/ }).uncheck();
	await neu.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/einstellungen\/terminarten\/[0-9a-f-]{36}$/);
	await expect(page.getByText('nur Plantafel')).toBeVisible();
	const link = await page.getByTestId('buchungslink').first().inputValue();
	const pfad = new URL(new URL(link).pathname, page.url()).href;
	// nicht online buchbar → der Buchungslink gilt nicht
	expect((await page.request.get(pfad)).status()).toBe(404);

	// Liste: Eintrag mit „nur Plantafel“; Menü „Terminarten“ unter Stammdaten
	await page.goto('/einstellungen/terminarten');
	const zeile = page.getByTestId('terminart').filter({ hasText: name });
	await expect(zeile).toContainText('nur Plantafel');
	await erwarteKeinQuerScrollen(page, projekt === 'mobil' ? 390 : 1280);

	// 2. Plantafel: eigener Termin in drei Wochen mit dieser Terminart
	const tag = tagPlus(berlinTag(new Date()), 21);
	await page.goto(`/plantafel?ansicht=tag&tag=${tag}`);
	await page.getByRole('button', { name: `Neuer Termin am ${tagKurz(tag)}` }).click();
	const dialog = page.getByRole('dialog', { name: 'Einsatz anlegen' });
	await expect(dialog).toBeVisible();
	await dialog.getByText('📌 Eigener Termin (ohne Auftrag)').click();
	await dialog.getByLabel('Titel *').fill(titel);
	await dialog.getByLabel('Von').fill('09:30');
	const auswahl = dialog.getByLabel('Terminart');
	await expect(auswahl.locator('option').first()).toHaveText('– keine –');
	await auswahl.selectOption({ label: `${name} (90 Min.)` });
	await expect(dialog.getByLabel('Bis')).toHaveValue('11:00');
	await expect(dialog.getByRole('status')).toContainText('Dauer 90 Min. übernommen');
	await dialog.getByRole('button', { name: 'Einsatz anlegen' }).click();
	await expect(dialog).toBeHidden();
	const eintrag = page.locator('li', { hasText: titel });
	await expect(eintrag).toContainText(name);
	await expect(eintrag).toContainText('09:30–11:00');

	// 3. Bearbeiten: Terminart steht drin, auf „– keine –“ ändern
	await eintrag.getByRole('button', { name: `${titel} bearbeiten` }).click();
	const bearbeiten = page.getByRole('dialog', { name: 'Einsatz bearbeiten' });
	await expect(bearbeiten.getByLabel('Terminart')).toHaveValue(/[0-9a-f-]{36}/);
	await bearbeiten.getByLabel('Terminart').selectOption({ label: '– keine –' });
	await bearbeiten.getByRole('button', { name: 'Speichern' }).click();
	await expect(bearbeiten).toBeHidden();
	await expect(page.locator('li', { hasText: titel })).not.toContainText(name);

	// 4. online buchbar einschalten (Liste) → Buchungsseite erreichbar, Terminart-Name als Überschrift
	await page.goto('/einstellungen/terminarten');
	await zeile.getByRole('checkbox', { name: 'online buchbar' }).check();
	await expect(zeile).toContainText('online buchbar');
	const buchen = await page.context().newPage();
	await buchen.goto(pfad);
	await expect(buchen.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(buchen.getByText(name)).toBeVisible();
	await buchen.close();

	// Online-Buchung zeigt sie unter „Online buchbare Terminarten“
	await page.goto('/einstellungen/online-buchung');
	await expect(page.getByRole('list', { name: 'Online buchbare Terminarten' })).toContainText(name);
});
