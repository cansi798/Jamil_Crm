import { expect, test, type Browser, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Zeiterfassung (Wunsch Jamil msgs 2770–2776): Monteur stempelt auf „Start“ mit einem Tipp (Start → Pause → Weiter →
 * Fertig), sieht die laufende Zeit oben, trägt im Nachweis eine Zeit mit Grund nach und korrigiert/löscht sie; Chef sieht
 * den Monteur, gibt die Woche frei und lädt CSV/PDF. Nur in der Vorschau mit Testmodus (Testzugänge ohne Zwei-Faktor).
 */

async function alsTestzugang(browser: Browser, name: string, viewport: { width: number; height: number }): Promise<Page> {
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill(name);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	return page;
}

const laufendeZeit = (page: Page) => page.getByTestId('laufende-zeit').locator('visible=true');

test('Monteur: Start → Pause → Weiter → Fertig auf „Start“, Anzeige oben, Nachtragen mit Grund', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const page = await alsTestzugang(browser, 'jamil.monteur', viewport);
	await page.goto('/');
	const karte = page.getByTestId('heute-zeiterfassung');
	await expect(karte).toBeVisible();
	// aufräumen, falls ein früherer Lauf etwas offen ließ
	if (await karte.getByRole('button', { name: /^Fertig$|^Fahrt beenden$/ }).first().isVisible()) {
		await karte.getByRole('button', { name: /^Fertig$|^Fahrt beenden$/ }).first().click();
		await expect(laufendeZeit(page)).toHaveCount(0);
	}
	const erster = karte.locator('.zeit-auftrag').first();
	await erster.getByRole('button', { name: /Arbeitszeit starten/ }).click();
	await expect(laufendeZeit(page)).toContainText('Arbeit');
	await expect(erster.getByText('Arbeit läuft')).toBeVisible();
	await erster.getByRole('button', { name: 'Pause' }).click();
	await expect(laufendeZeit(page)).toContainText('Pause');
	await erster.getByRole('button', { name: 'Weiter' }).click();
	await expect(laufendeZeit(page)).toContainText('Arbeit');
	await erster.getByRole('button', { name: 'Fertig' }).click();
	await expect(laufendeZeit(page)).toHaveCount(0);
	await erwarteKeinQuerScrollen(page, viewport.width);

	// Nachweis: nachtragen nur mit Grund, dann korrigieren und löschen
	await page.goto('/zeiten?ansicht=tag&tag=2026-01-05');
	await expect(page.getByRole('heading', { name: 'Zeiten' })).toBeVisible();
	await page.getByRole('button', { name: 'Zeit nachtragen' }).click();
	const f = page.locator('form[action="?/nachtragen"]');
	await f.locator('select[name="auftragId"]').selectOption({ index: 1 });
	await f.locator('input[name="von"]').fill('07:00');
	await f.locator('input[name="bis"]').fill('15:30');
	await f.locator('input[name="pauseMin"]').fill('30');
	await f.locator('input[name="grund"]').fill(`E2E ${info.project.name}`);
	await f.getByRole('button', { name: 'Nachtragen' }).click();
	await expect(page.getByTestId('summe-arbeit')).toHaveText('8:00 h');
	await expect(page.getByText('korrigiert').first()).toBeVisible();
	await erwarteKeinQuerScrollen(page, viewport.width);
	await page.getByRole('button', { name: 'Korrigieren' }).first().click();
	const k = page.locator('form[action="?/korrigieren"]');
	await k.locator('input[name="von"]').fill('07:30');
	await k.locator('input[name="grund"]').fill('später angefangen');
	await k.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('summe-arbeit')).toHaveText('7:30 h');
	await page.getByRole('button', { name: 'Korrigieren' }).first().click();
	await page.locator('form[action="?/korrigieren"] input[name="grund"]').fill('E2E aufräumen');
	await page.locator('form[action="?/korrigieren"]').getByRole('button', { name: 'Löschen' }).click();
	await expect(page.getByTestId('summe-arbeit')).toHaveText('0:00 h');
	await page.context().close();
});

test('Chef: Zeiten des Monteurs, Woche freigeben, Export CSV/PDF', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const chef = await alsTestzugang(browser, 'can.chef', viewport);
	await chef.goto('/zeiten');
	// Personenauswahl (PersonWahl): Monteur wählen → Seite lädt mit ?person=…
	await chef.getByRole('button', { name: /^Person( \(Pflichtfeld\))?:/ }).click();
	await chef.getByRole('option', { name: /Monteur/ }).first().click();
	await chef.waitForURL(/person=/);
	const monteurId = new URL(chef.url()).searchParams.get('person');
	await chef.goto(`/zeiten?ansicht=woche&person=${monteurId}`);
	await expect(chef.locator('.zt-tabelle')).toBeVisible();
	const freigeben = chef.getByRole('button', { name: 'Woche freigeben' });
	if (await freigeben.isVisible()) {
		await freigeben.click();
		await expect(chef.getByText(/freigegeben/).first()).toBeVisible();
	}
	const [csv] = await Promise.all([chef.waitForEvent('download'), chef.getByRole('link', { name: 'CSV', exact: true }).click()]);
	expect(csv.suggestedFilename()).toMatch(/^Arbeitszeitnachweis_.*\.csv$/);
	const [pdf] = await Promise.all([chef.waitForEvent('download'), chef.getByRole('link', { name: 'PDF' }).click()]);
	expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
	await erwarteKeinQuerScrollen(chef, viewport.width);
	await chef.context().close();
});

test('Auftrag: Abfahrt → Angekommen → Fertig, Material hinzufügen und entfernen', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const page = await alsTestzugang(browser, 'can.chef', viewport);
	await page.goto('/auftraege');
	const href = await page.locator('a[href^="/auftraege/"]').evaluateAll((l) => l.map((a) => a.getAttribute('href')).find((h) => /^\/auftraege\/[0-9a-f-]{36}$/.test(h ?? '')));
	await page.goto(href!);
	const zeit = page.locator('#zeiterfassung');
	await expect(zeit).toBeVisible();
	if (await zeit.getByRole('button', { name: /^Fertig$|^Fahrt beenden$/ }).first().isVisible()) await zeit.getByRole('button', { name: /^Fertig$|^Fahrt beenden$/ }).first().click();
	await zeit.getByRole('button', { name: /^Abfahrt/ }).click();
	await expect(laufendeZeit(page)).toContainText('Fahrt');
	await zeit.getByRole('button', { name: 'Angekommen' }).click();
	await expect(laufendeZeit(page)).toContainText('Arbeit');
	await zeit.getByRole('button', { name: 'Fertig' }).click();
	await expect(laufendeZeit(page)).toHaveCount(0);

	const material = page.locator('#material');
	await material.getByRole('button', { name: 'Material hinzufügen' }).click();
	const name = `E2E Silikon ${info.project.name} ${Date.now()}`;
	await material.locator('form[action="?/materialNeu"] input[name="bezeichnung"]').fill(name);
	await material.locator('form[action="?/materialNeu"] input[name="menge"]').fill('2');
	await material.locator('form[action="?/materialNeu"]').getByRole('button', { name: 'Speichern' }).click();
	await expect(material.getByText(name)).toBeVisible();
	await erwarteKeinQuerScrollen(page, viewport.width);
	await material.getByRole('button', { name: `${name} entfernen` }).click();
	await expect(material.getByText(name)).toHaveCount(0);
	await page.context().close();
});

test('Monatssicht: Monat wählen, Wochen- und Monatssumme, Teamübersicht für den Chef', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const chef = await alsTestzugang(browser, 'can.chef', viewport);
	await chef.goto('/zeiten?ansicht=monat&monat=2026-10');
	await expect(chef.getByText('Oktober 2026').first()).toBeVisible();
	await expect(chef.locator('.zt-woche.gesamt')).toContainText('Monat');
	await expect(chef.getByTestId('team')).toBeVisible();
	const [team] = await Promise.all([chef.waitForEvent('download'), chef.getByRole('link', { name: 'Team-CSV' }).click()]);
	expect(team.suggestedFilename()).toMatch(/^Zeiten_Team_2026-10-01_2026-10-31\.csv$/);
	await erwarteKeinQuerScrollen(chef, viewport.width);
	await chef.context().close();
});
