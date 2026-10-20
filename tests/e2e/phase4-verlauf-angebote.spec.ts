import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Phase 4 (Wunsch Jamil, 19.10.2026): Angebote ohne Auftrag, nachträglich zuordnen (im Angebot und im Auftrag) und der
 * Kunden-Verlauf als Zeitleiste. Legt eigene Daten an und löscht sie wieder.
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

test('Angebot ohne Auftrag → im Angebot einem Auftrag zuordnen; zweites im Auftrag zuordnen; Kunden-Verlauf', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const stempel = `${info.project.name} ${Date.now()}`;
	const kunde = await api(page, 'POST', '/api/kunden', { art: 'privat', nachname: `E2E-Verlauf ${stempel}`, ort: 'Norderstedt' });
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `E2E Zuordnen ${stempel}`, kundeId: kunde.id });
	const angebote: string[] = [];
	try {
		// 1. Auf der Kundenseite „+ Angebot ohne Auftrag“
		await page.goto(`/kunden/${kunde.id}`);
		await page.getByRole('button', { name: '+ Angebot ohne Auftrag' }).click();
		await page.waitForURL(/\/angebote\/[0-9a-f-]{36}$/);
		angebote.push(page.url().split('/').pop()!);
		await expect(page.getByRole('link', { name: '← Angebote' })).toBeVisible();
		const zuordnen = page.getByRole('region', { name: 'Angebot zuordnen' });
		await expect(zuordnen).toContainText(`Kunde: E2E-Verlauf ${stempel}`);
		// 2. Einem Auftrag zuordnen (Suche nach dem Titel)
		await zuordnen.getByRole('searchbox', { name: 'Zum Zuordnen suchen' }).fill(`E2E Zuordnen ${stempel}`);
		await zuordnen.getByRole('button', { name: 'Suchen' }).click();
		await zuordnen.getByRole('button', { name: new RegExp(`E2E Zuordnen ${stempel}`) }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Zugeordnet' })).toBeVisible();
		await expect(page.getByRole('link', { name: /← Auftrag A-/ })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Angebot zuordnen' })).toHaveCount(0);

		// 3. Zweites Angebot ohne Auftrag und Kunde (Angebotsliste) → im Auftrag zuordnen
		await page.goto('/angebote');
		await page.getByRole('button', { name: '+ Angebot ohne Auftrag' }).click();
		await page.waitForURL(/\/angebote\/[0-9a-f-]{36}$/);
		const zweites = page.url().split('/').pop()!;
		angebote.push(zweites);
		const nummer = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Angebot ', '');
		await page.goto(`/auftraege/${auftrag.id}`);
		await page.getByRole('button', { name: 'Angebot hinzufügen' }).click();
		await page.getByRole('button', { name: 'Bestehendes zuordnen' }).click();
		await page.getByLabel('Bestehendes Angebot zuordnen').selectOption({ value: zweites });
		await page.getByRole('button', { name: 'Zuordnen', exact: true }).click();
		await expect(page.getByRole('link', { name: new RegExp(nummer) })).toBeVisible();

		// 4. Kunden-Verlauf: Auftrag und Angebote; Filter „Angebote“
		await page.goto(`/kunden/${kunde.id}`);
		const zeitleiste = page.getByRole('list', { name: 'Verlauf des Kunden' });
		await expect(zeitleiste.getByText(/Auftrag A-\d{4}-\d+ angelegt/)).toBeVisible();
		await expect(zeitleiste.getByText(/^Angebot AN-/)).toHaveCount(2);
		await page.getByRole('button', { name: 'Angebote', exact: true }).click();
		await expect(zeitleiste.getByText(/angelegt/)).toHaveCount(0);
		await expect(zeitleiste.getByText(/^Angebot AN-/)).toHaveCount(2);
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
	} finally {
		for (const id of angebote) await api(page, 'DELETE', `/api/angebote/${id}`);
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`);
	}
});
