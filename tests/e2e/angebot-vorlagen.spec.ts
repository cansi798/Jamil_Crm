import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Angebots-Vorlagen im Browser (Wunsch Jamil, 19.10.2026): Vorlage mit Katalog- und freier Position anlegen, beim
 * „Angebot erstellen“ im Auftrag eine Beispiel-Vorlage wählen, im Entwurf „+ Aus Vorlage“ einfügen. Legt einen eigenen
 * Auftrag an und räumt am Ende auf (Angebot, Vorlage, Auftrag) – die Seed-Daten bleiben unberührt.
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

test('Angebots-Vorlage anlegen, beim Erstellen wählen und im Entwurf einfügen', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const name = `E2E-Vorlage ${info.project.name} ${Date.now()}`;
	const kunden = await api(page, 'GET', '/api/kunden');
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `E2E Angebotsvorlage ${Date.now()}`, kundeId: kunden[0].id });
	let vorlageId: string | null = null;
	let angebotId: string | null = null;
	try {
		// 1. Vorlage anlegen: eine Katalogposition (Preis nicht änderbar) und eine freie Position
		await page.goto('/angebot-vorlagen');
		await expect(page.getByRole('heading', { name: 'Angebots-Vorlagen' })).toBeVisible();
		await expect(page.getByRole('link', { name: /Badsanierung komplett \(Beispiel\)/ })).toBeVisible();
		await page.getByRole('link', { name: '+ Neue Vorlage' }).click();
		await page.getByLabel('Name *').fill(name);
		await page.getByRole('button', { name: '+ Aus Katalog' }).click();
		const katalog = page.getByRole('region', { name: 'Aus Katalog wählen' });
		await katalog.getByRole('searchbox', { name: 'Katalog durchsuchen' }).fill('Silikonfugen');
		await katalog.getByRole('button', { name: /Silikonfugen erneuern/ }).first().click();
		await katalog.getByRole('button', { name: 'Schließen' }).click();
		await expect(page.getByLabel('Einzelpreis Position 1')).toBeDisabled();
		await page.getByRole('button', { name: '+ Freie Position' }).click();
		await page.getByLabel('Bezeichnung Position 2').fill('Kleinmaterial');
		await page.getByLabel('Einheit Position 2').selectOption('psch');
		await page.getByLabel('Einzelpreis Position 2').fill('25,00');
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
		await page.waitForURL(/\/angebot-vorlagen\/[0-9a-f-]{36}\?gespeichert=1$/);
		vorlageId = new URL(page.url()).pathname.split('/').pop()!;
		await expect(page.getByText('Vorlage angelegt.')).toBeVisible();

		// 2. Im Auftrag „Angebot erstellen“ mit Beispiel-Vorlage
		await page.goto(`/auftraege/${auftrag.id}`);
		await page.getByRole('button', { name: 'Angebot hinzufügen' }).click();
		await page.getByRole('button', { name: 'Aus Vorlage' }).click();
		await page.getByLabel('Angebots-Vorlage').selectOption({ label: 'Vorlage: Badsanierung komplett (Beispiel)' });
		await page.getByRole('button', { name: 'Angebot erstellen' }).click();
		await page.waitForURL(/\/angebote\/[0-9a-f-]{36}$/);
		angebotId = page.url().split('/').pop()!;
		await expect(page.getByTestId('position')).toHaveCount(8);
		await expect(page.getByLabel('Bezeichnung Position 7')).toHaveValue('Entsorgung Bauschutt');
		await expect(page.getByLabel('Einleitung')).toHaveValue(/Sanierung Ihres Badezimmers/);

		// 3. Im Entwurf „+ Aus Vorlage“: eigene Vorlage hinten anhängen, freie Position mit ihrem Preis
		await page.getByRole('button', { name: '+ Aus Vorlage' }).click();
		const bereich = page.getByRole('region', { name: 'Aus Vorlage einfügen' });
		await bereich.getByLabel('Angebots-Vorlage').selectOption({ label: `${name} (2 Positionen)` });
		await bereich.getByRole('button', { name: 'Einfügen' }).click();
		await expect(page.getByRole('status').filter({ hasText: `Vorlage „${name}“ eingefügt (2 Positionen)` })).toBeVisible();
		await expect(page.getByTestId('position')).toHaveCount(10);
		await expect(page.getByLabel('Bezeichnung Position 10')).toHaveValue('Kleinmaterial');
		await expect(page.getByLabel('Einzelpreis Position 10')).toHaveValue('25,00');
		// danach normal änderbar
		await page.getByLabel('Menge Position 10').fill('2');
		await page.getByRole('button', { name: 'Speichern' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();
		const gespeichert = await api(page, 'GET', `/api/angebote/${angebotId}`);
		expect(gespeichert.positionen[9]).toMatchObject({ bezeichnung: 'Kleinmaterial', menge: 2, einzelpreisCent: 2500 });
	} finally {
		if (angebotId) await api(page, 'DELETE', `/api/angebote/${angebotId}`);
		if (vorlageId) await api(page, 'DELETE', `/api/angebot-vorlagen/${vorlageId}`);
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
	}
});
