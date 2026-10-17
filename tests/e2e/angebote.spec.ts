import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Angebote im Browser (Vorschau mit Seed-Daten). Angebote erstellt das Büro (Rechte „Angebote bearbeiten“ und
 * „Preise sehen“, ohne Pflicht zur Zwei-Faktor-Anmeldung – wie der Chef). Der Test legt einen eigenen Auftrag an,
 * erstellt darin ein Angebot aus zwei Katalogpositionen und einer freien Position, lädt das PDF, markiert es als
 * versendet und räumt am Ende wieder auf (Angebot zurück auf Entwurf und löschen, Auftrag zurück auf Anfrage und
 * löschen) – die Seed-Daten bleiben unberührt.
 */
const BUERO = 'buero@bauwelt.test';
const MONTEUR = 'monteur@bauwelt.test';

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const antwort = await fetch(url, {
				method: methode,
				headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});
			const typ = antwort.headers.get('content-type') ?? '';
			if (typ.includes('application/pdf')) return { status: antwort.status, typ, groesse: (await antwort.arrayBuffer()).byteLength, text: '' };
			return { status: antwort.status, typ, groesse: 0, text: await antwort.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return { ...r, json: r.text ? JSON.parse(r.text) : null };
}

test.describe('Angebote', () => {
	test('Büro: Auftrag → Angebot erstellen → 2 Katalog- + 1 freie Position → Summe → PDF → versendet → Auftrag „Angebot“', async ({ page }, info) => {
		page.on('dialog', (d) => d.accept()); // „Position ohne Preis – trotzdem erstellen?“ (falls Katalogpreise fehlen)
		await anmelden(page, BUERO);
		// Katalog vorbereiten: Startvorlage Fliesen (idempotent; der Seed hat sie schon mit Beispielpreisen)
		await api(page, 'POST', '/api/katalog/vorlagen', { gewerk: 'fliesen' });
		const kunden = (await api(page, 'GET', '/api/kunden')).json;
		const auftrag = (await api(page, 'POST', '/api/auftraege', { titel: `E2E Angebot ${info.project.name} ${Date.now()}`, kundeId: kunden[0].id })).json;
		let angebotId: string | null = null;
		try {
			await page.goto(`/auftraege/${auftrag.id}`);
			await expect(page.getByRole('heading', { name: 'Angebote' })).toBeVisible();
			await page.getByRole('button', { name: 'Angebot erstellen' }).click();
			await page.waitForURL(/\/angebote\/[0-9a-f-]{36}$/);
			angebotId = page.url().split('/').pop()!;
			await expect(page.getByRole('heading', { name: /^Angebot AN-\d{4}-\d{4,}$/ })).toBeVisible();

			// zwei Katalogpositionen
			await page.getByRole('button', { name: '+ Aus Katalog' }).click();
			const katalog = page.getByRole('region', { name: 'Aus Katalog wählen' });
			const suche = katalog.getByRole('searchbox', { name: 'Katalog durchsuchen' });
			await suche.fill('Bodenfliesen');
			await katalog.getByRole('button', { name: /Bodenfliesen verlegen/ }).first().click();
			await suche.fill('Abdichtung');
			await katalog.getByRole('button', { name: /Abdichtung im Verbund/ }).first().click();
			await katalog.getByRole('button', { name: 'Schließen' }).click();
			// eine freie Position
			await page.getByRole('button', { name: '+ Freie Position' }).click();
			await page.getByLabel('Bezeichnung Position 3').fill('Anfahrt und Baustelleneinrichtung');
			await page.getByLabel('Menge Position 3').fill('1');
			await page.getByLabel('Einheit Position 3').selectOption('psch');
			await page.getByLabel('Einzelpreis Position 3').fill('45,00');
			await page.getByLabel('Menge Position 1').fill('12,5');
			await page.getByLabel('Menge Position 2').fill('6');
			await expect(page.getByTestId('position')).toHaveCount(3);
			await expect(page.locator('.sb-brutto')).toContainText('€');

			await page.getByRole('button', { name: 'Speichern' }).click();
			await expect(page.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();
			await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
			const gespeichert = (await api(page, 'GET', `/api/angebote/${angebotId}`)).json;
			expect(gespeichert.positionen).toHaveLength(3);
			expect(gespeichert.positionen[0]).toMatchObject({ menge: 12.5 });
			expect(gespeichert.positionen[2]).toMatchObject({ bezeichnung: 'Anfahrt und Baustelleneinrichtung', einheit: 'psch', einzelpreisCent: 4500 });
			await expect(page.locator('.sb-brutto')).toHaveText(new RegExp(`^${gespeichert.bruttoCent >= 100000 ? '\\d{1,3}(\\.\\d{3})+' : '\\d+'},\\d{2}\\s€$`));

			// PDF: Download über den Knopf und Inhaltstyp/Größe über die API
			const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF herunterladen' }).click()]);
			expect(download.suggestedFilename()).toMatch(/^Angebot_AN-\d{4}-\d{4,}\.pdf$/);
			const pdf = await api(page, 'GET', `/api/angebote/${angebotId}/pdf`);
			expect(pdf.typ).toBe('application/pdf');
			expect(pdf.groesse).toBeGreaterThan(5000);

			await page.getByRole('button', { name: 'Als versendet markieren' }).click();
			await expect(page.getByTestId('angebot-status')).toHaveText('Versendet');
			await expect(page.getByLabel('Menge Position 1')).toBeDisabled();
			await page.goto(`/auftraege/${auftrag.id}`);
			await expect(page.getByRole('list', { name: 'Statuskette' }).locator('[aria-current="step"]')).toHaveText('Angebot');
			await expect(page.locator('main')).toContainText('Versendet');
		} finally {
			if (angebotId) {
				const a = (await api(page, 'GET', `/api/angebote/${angebotId}`)).json;
				if (a.status === 'versendet') await api(page, 'POST', `/api/angebote/${angebotId}/status`, { status: 'entwurf' });
				await api(page, 'DELETE', `/api/angebote/${angebotId}`);
			}
			const au = (await api(page, 'GET', `/api/auftraege/${auftrag.id}`)).json;
			if (au.status === 'angebot') await api(page, 'POST', `/api/auftraege/${auftrag.id}/status`, { status: 'anfrage' });
			await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		}
	});

	test('Monteur: im Auftrag kein Bereich „Angebote“ und keine €-Beträge; /angebote und /katalog → 403', async ({ page }) => {
		await anmelden(page, MONTEUR);
		await page.goto('/auftraege');
		const erster = page.locator('main a[href^="/auftraege/"]').first();
		await expect(erster).toBeVisible();
		await erster.click();
		await page.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/);
		await expect(page.getByRole('heading', { name: 'Einsätze' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Angebote' })).toHaveCount(0);
		expect(await page.content()).not.toContain('€');
		const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
		await expect(nav.getByRole('link', { name: 'Angebote' })).toHaveCount(0);
		for (const pfad of ['/angebote', '/katalog', '/einstellungen/briefkopf']) {
			const r = await page.goto(pfad);
			expect(r?.status(), pfad).toBe(403);
		}
	});
});
