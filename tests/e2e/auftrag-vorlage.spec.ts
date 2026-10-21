import { expect, test, type Browser, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen, personenWaehlen } from './hilfe';

/**
 * „Aufgaben aus Vorlage“ am bestehenden Auftrag (Jamil msg 2975) und Mitarbeiter/Zeitraum je Aufgabe (msgs
 * 2977/2978): Vorschau, „nur fehlende“, Verlauf, mehrere Mitarbeiter direkt in der Zeile, Zeitraum im Bearbeiten,
 * zugewiesener Monteur sieht den Auftrag. Legt Vorlage und Auftrag selbst an und räumt am Ende auf.
 */
const BUERO = 'buero@bauwelt.test';

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, {
				method: methode,
				headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});
			return { status: a.status, text: await a.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

async function alsTestzugang(browser: Browser, name: string): Promise<Page> {
	const ctx = await browser.newContext();
	const p = await ctx.newPage();
	await p.goto('/anmelden');
	await p.getByLabel('Benutzername').fill(name);
	await p.getByRole('button', { name: 'Anmelden' }).click();
	await expect(p).not.toHaveURL(/\/anmelden/);
	return p;
}

test('Vorlage auf bestehenden Auftrag anwenden, Mitarbeiter und Zeitraum je Aufgabe', async ({ page, browser }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus (Testzugänge)');
	await anmelden(page, BUERO);
	const breite = page.viewportSize()!.width;
	const name = `E2E Bad ${info.project.name} ${Date.now()}`;
	const fliesen = `Fliesen abschlagen ${Date.now()}`;
	const vorlage = await api(page, 'POST', '/api/auftrag-vorlagen', {
		name,
		todos: [{ titel: fliesen, lautstaerke: 3, schmutz: 3 }, { titel: 'Silikon fugen' }, { titel: 'Abnahme mit Kunde' }]
	});
	const kunden = await api(page, 'GET', '/api/kunden');
	const titel = `E2E Vorlage-Auftrag ${info.project.name} ${Date.now()}`;
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel, kundeId: kunden[0].id });
	try {
		await api(page, 'POST', '/api/todos', { titel: 'Silikon fugen', auftragId: auftrag.id });
		await page.goto(`/auftraege/${auftrag.id}`);

		// Knopf neben „Aufgabe hinzufügen“
		await expect(page.getByRole('button', { name: 'Aufgabe hinzufügen' })).toBeVisible();
		await page.getByRole('button', { name: 'Aufgaben aus Vorlage', exact: true }).click();
		const feld = page.getByRole('region', { name: 'Aufgaben aus Vorlage', exact: true });
		await feld.locator('select[name="vorlageId"]').selectOption(vorlage.id);
		const vorschau = feld.getByRole('group', { name: 'Vorschau der Aufgaben' });
		await expect(vorschau.getByRole('listitem')).toHaveCount(3);
		await expect(vorschau.getByRole('listitem').filter({ hasText: 'Silikon fugen' })).toContainText('schon vorhanden – wird übersprungen');
		await expect(feld.getByRole('button', { name: '2 Aufgaben hinzufügen' })).toBeVisible();
		await feld.getByRole('radio', { name: 'Alle hinzufügen' }).check();
		await expect(feld.getByRole('button', { name: '3 Aufgaben hinzufügen' })).toBeVisible();
		await feld.getByRole('radio', { name: 'Nur fehlende hinzufügen' }).check();
		await erwarteKeinQuerScrollen(page, breite);
		await feld.getByRole('button', { name: '2 Aufgaben hinzufügen' }).click();

		await expect(page.getByRole('status').filter({ hasText: `Vorlage „${name}“ übernommen: 2 Aufgaben hinzugefügt, 1 schon vorhanden (übersprungen).` })).toBeVisible();
		const offen = page.getByRole('list', { name: 'Offene Aufgaben' });
		await expect(offen.locator('.tl-zeile', { hasText: fliesen })).toHaveCount(1);
		await expect(offen.locator('.tl-zeile', { hasText: 'Silikon fugen' })).toHaveCount(1);
		await expect(offen.locator('.tl-zeile', { hasText: 'Abnahme mit Kunde' })).toHaveCount(1);
		await expect(page.getByText(`Aufgaben-Vorlage „${name}“ übernommen (2 Aufgaben)`)).toBeVisible();

		// Mehrere Mitarbeiter direkt in der Zeile (jeder Mitarbeiter des Betriebs)
		const zeile = offen.locator('.tl-zeile', { hasText: fliesen });
		await personenWaehlen(zeile, `Mitarbeiter für „${fliesen}“`, ['Murat Öztürk', 'Jamil (Test) – Monteur']);
		await expect(zeile.getByRole('button', { name: new RegExp(`^Mitarbeiter für „${fliesen}“: (?=.*Murat Öztürk)(?=.*Jamil \\(Test\\) – Monteur)`) })).toBeVisible();
		await page.reload();
		await expect(zeile.getByRole('button', { name: new RegExp(`^Mitarbeiter für „${fliesen}“: (?=.*Murat Öztürk)(?=.*Jamil \\(Test\\) – Monteur)`) })).toBeVisible();

		// Zeitraum im Bearbeiten: „Zeitraum“ von–bis
		await zeile.locator('.tl-titel').click();
		const f = zeile.locator('form.tl-formular');
		await f.getByRole('radio', { name: 'Zeitraum' }).check();
		await f.locator('input[name="vonTag"]').fill('2026-11-02');
		await f.locator('input[name="faellig"]').fill('2026-11-04');
		await f.getByRole('button', { name: 'Speichern' }).click();
		await expect(zeile.locator('.tl-faellig')).toHaveText('Mo 02.11. – Mi 04.11.');
		await erwarteKeinQuerScrollen(page, breite);

		// Der zugewiesene Monteur sieht den Auftrag (über die Aufgabe) und die Aufgabe unter „Meine“
		const monteur = await alsTestzugang(browser, 'jamil.monteur');
		await monteur.goto(`/auftraege?ansicht=liste&suche=${encodeURIComponent(titel)}`);
		await expect(monteur.getByRole('link', { name: new RegExp(titel) })).toBeVisible();
		await monteur.goto('/todos');
		await expect(monteur.locator('.kanban-karte', { hasText: fliesen })).toContainText('Mo 02.11. – Mi 04.11.');
		await monteur.context().close();
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		await api(page, 'DELETE', `/api/auftrag-vorlagen/${vorlage.id}`);
	}
});
