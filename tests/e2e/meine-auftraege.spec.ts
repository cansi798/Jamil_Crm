import { expect, test, type Browser, type Page } from '@playwright/test';
import { anmelden } from './hilfe';

/**
 * Wünsche Jamil (msgs 2489, 2490, 2497): Mitarbeiter direkt im Auftrag zuweisen; der Mitarbeiter sieht den Auftrag
 * unter „Meine Aufträge“ und die To-dos des Auftrags unter „Meine To-dos“. Geprüft mit dem Testzugang
 * „jamil.monteur“ (nur im Testmodus der Vorschau). Eigene Daten, am Ende gelöscht.
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

test('Büro weist „Jamil (Test) – Monteur“ im Auftrag zu → er sieht Auftrag und To-dos unter „Meine“', async ({ page, browser }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus (Testzugänge)');
	await anmelden(page, BUERO);
	const titel = `E2E Meine ${info.project.name} ${Date.now()}`;
	const kunden = await api(page, 'GET', '/api/kunden');
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel, kundeId: kunden[0].id });
	try {
		await page.goto(`/auftraege/${auftrag.id}`);
		const zuweisen = page.locator('details.af-zuweisen');
		if ((await zuweisen.getAttribute('open')) === null) await zuweisen.locator('summary').click();
		await zuweisen.getByRole('checkbox', { name: 'Jamil (Test) – Monteur' }).check();
		await expect(page.getByRole('list', { name: 'Zuständige Mitarbeiter' }).getByText('Jamil (Test) – Monteur')).toBeVisible();
		await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
		// To-do ohne direkte Zuweisung im Auftrag
		await page.getByRole('button', { name: 'To-do hinzufügen' }).click();
		const f = page.locator('form.td-neu');
		await f.getByLabel('Neues To-do').fill('Material holen (E2E)');
		await f.getByRole('button', { name: 'To-do speichern' }).click();
		await expect(page.locator('.tl-zeile', { hasText: 'Material holen (E2E)' })).toBeVisible();

		const monteur = await alsTestzugang(browser, 'jamil.monteur');
		await monteur.goto(`/auftraege?ansicht=liste&suche=${encodeURIComponent(titel)}`);
		const karte = monteur.getByRole('link', { name: new RegExp(titel) });
		await expect(karte).toBeVisible();
		await expect(karte).toContainText('zuständig');
		await monteur.goto('/todos');
		await expect(monteur.locator('.kanban-karte', { hasText: 'Material holen (E2E)' })).toContainText('über den Auftrag');
		await monteur.context().close();
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
	}
});
