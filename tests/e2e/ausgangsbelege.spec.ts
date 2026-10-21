import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Ausgangsbelege (Jamil msg 2948): früher „Angebote“ – jetzt Reiter Angebote, Auftragsbestätigungen, Rechnungen;
 * alte Adressen /angebote… werden umgeleitet. Nur in der Vorschau mit Testmodus (can.chef).
 */
test('Ausgangsbelege: Umleitung, einheitliche Reiter, Suche überall, AB-Liste mit Filter und PDF, Rechnungen im selben Rahmen', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	const reiter = page.getByRole('navigation', { name: 'Ausgangsbelege' });

	// alte Adresse mit Filter → neuer Reiter, Filter bleibt
	await page.goto('/angebote?status=entwurf');
	await expect(page).toHaveURL(/\/ausgangsbelege\/angebote\?status=entwurf$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Ausgangsbelege' })).toBeVisible();
	await expect(reiter.getByRole('link')).toHaveText(['Angebote', 'Auftragsbestätigungen', 'Rechnungen']);
	await expect(reiter.getByRole('link', { name: 'Angebote' })).toHaveAttribute('aria-current', 'page');
	await expect(page.locator('a[aria-current="page"]', { hasText: 'Ausgangsbelege' }).first()).toBeAttached();
	await erwarteKeinQuerScrollen(page, viewport.width);

	// Einheitlichkeit (Jamil msgs 3054–3056): jeder Reiter hat Suche, Reiter, Status, Kennzahl-Streifen in derselben Reihenfolge
	for (const [pfad, name] of [['angebote', 'Angebote'], ['auftragsbestaetigungen', 'Auftragsbestätigungen'], ['rechnungen', 'Rechnungen']] as const) {
		await page.goto(`/ausgangsbelege/${pfad}`);
		const suche = page.getByRole('searchbox', { name: `${name} suchen` });
		await expect(suche).toHaveAttribute('placeholder', 'Nummer, Auftrag oder Kunde');
		const kopf = page.getByRole('region', { name, exact: true });
		await expect(kopf.getByRole('navigation', { name: 'Zeitraum' }).getByRole('link')).toHaveText(['Monat', 'Quartal', 'Jahr', '12 Mon.', 'Gesamt']);
		const y = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!.y;
		expect(await y(suche)).toBeLessThan(await y(kopf));
		expect(await y(reiter)).toBeLessThan(await y(kopf));
		await erwarteKeinQuerScrollen(page, viewport.width);
	}

	// Suche auch bei Angeboten
	await page.goto('/ausgangsbelege/angebote');
	await page.getByRole('searchbox', { name: 'Angebote suchen' }).fill('zzz-gibt-es-nicht');
	await page.getByRole('searchbox', { name: 'Angebote suchen' }).press('Enter');
	await expect(page).toHaveURL(/suche=zzz-gibt-es-nicht/);
	await expect(page.getByText('Keine Angebote für diesen Filter.')).toBeVisible();

	// Auftragsbestätigungen
	await reiter.getByRole('link', { name: 'Auftragsbestätigungen' }).click();
	await expect(page).toHaveURL(/\/ausgangsbelege\/auftragsbestaetigungen$/);
	await expect(page.getByRole('group', { name: 'Auftragsbestätigungen: Kennzahlen' })).toBeVisible();
	await expect(page.getByRole('button', { name: /Ansichten/ })).toBeVisible();
	await erwarteKeinQuerScrollen(page, viewport.width);
	const zeilen = page.locator('li[data-beleg]');
	if ((await zeilen.count()) > 0) {
		const pdf = zeilen.first().getByRole('link', { name: /^PDF AB-/ });
		const href = await pdf.getAttribute('href');
		expect(href).toMatch(/^\/api\/auftragsbestaetigungen\/[0-9a-f-]{36}\/pdf$/);
		const r = await page.evaluate(async (url) => {
			const a = await fetch(url);
			return { status: a.status, typ: a.headers.get('content-type') ?? '', kopf: new TextDecoder().decode((await a.arrayBuffer()).slice(0, 5)) };
		}, href!);
		expect(r).toEqual({ status: 200, typ: expect.stringContaining('application/pdf'), kopf: '%PDF-' });
	} else {
		await expect(page.getByText('Noch keine Auftragsbestätigungen')).toBeVisible();
	}
	await page.getByRole('navigation', { name: 'Status' }).getByRole('link', { name: 'Versendet' }).click();
	await expect(page).toHaveURL(/status=gesendet/);
	for (const s of await page.locator('li[data-beleg] .an-status').allInnerTexts()) expect(s).toBe('Versendet');
	await page.getByRole('searchbox', { name: 'Auftragsbestätigungen suchen' }).fill('zzz-gibt-es-nicht');
	await page.getByRole('searchbox', { name: 'Auftragsbestätigungen suchen' }).press('Enter');
	await expect(page).toHaveURL(/suche=zzz-gibt-es-nicht/);
	await expect(page).toHaveURL(/status=gesendet/);
	await expect(page.getByText('Keine Auftragsbestätigungen für diesen Filter.')).toBeVisible();

	// Rechnungen: gleicher Rahmen, Suche und Status gesperrt, Leerzustand mittig
	await reiter.getByRole('link', { name: 'Rechnungen' }).click();
	await expect(page).toHaveURL(/\/ausgangsbelege\/rechnungen$/);
	await expect(page.getByText('Rechnungen kommen mit der Lexware-Anbindung')).toBeVisible();
	await expect(page.getByRole('searchbox', { name: 'Rechnungen suchen' })).toBeDisabled();
	await expect(page.getByRole('group', { name: 'Status' }).getByRole('button')).toHaveText(['Alle', 'Offen', 'Bezahlt', 'Überfällig']);
	for (const b of await page.getByRole('group', { name: 'Status' }).getByRole('button').all()) await expect(b).toBeDisabled();
	await expect(page.getByRole('group', { name: 'Rechnungen: Kennzahlen' })).toBeVisible();
	const leer = await page.locator('.beleg-leer .kd-leer').evaluate((el) => {
		const k = el.getBoundingClientRect();
		const symbol = getComputedStyle(el, '::before');
		return { links: k.left, rechts: k.right, breite: el.scrollWidth, sichtbar: el.clientWidth, symbolBreite: symbol.width, anzeige: getComputedStyle(el).display };
	});
	expect(leer.anzeige).toBe('grid'); // Symbol mittig über dem Text, nicht links daneben
	expect(leer.breite).toBeLessThanOrEqual(leer.sichtbar);
	await erwarteKeinQuerScrollen(page, viewport.width);

	// Menüeintrag führt zum ersten Reiter
	await page.goto('/ausgangsbelege');
	await expect(page).toHaveURL(/\/ausgangsbelege\/angebote$/);
	await ctx.close();
});
