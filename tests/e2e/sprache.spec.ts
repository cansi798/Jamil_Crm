import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Sprachsteuerung im Browser (Stufe 1d) mit FakeKi (CRM_KI_ANBIETER=fake): Befehl tippen → Bestätigungskarte →
 * „Ja, speichern“. Als Büro (Rechte für Kunden, Aufträge, To-dos, Plantafel; ohne Pflicht-2FA – wie 1b/1c).
 * Ohne Mikrofon-Freigabe (Chromium ohne Fake-Gerät) zeigt der Knopf die Karte „Kein Zugriff aufs Mikrofon“ mit
 * Texteingabe. Die Aufnahme mit Fake-Audiodatei steht in sprache-mikrofon.spec.ts.
 */
const BUERO = 'buero@bauwelt.test';
const MONTEUR = 'monteur@bauwelt.test';
const FOTOS = process.env.FOTO_ORDNER;

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const antwort = await fetch(url, {
				method: methode,
				headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});
			return { status: antwort.status, text: await antwort.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

const foto = async (page: Page, name: string, projekt: string) => {
	if (FOTOS) await page.screenshot({ path: `${FOTOS}/1d-${name}-${projekt}.png` });
};

/** Öffnet den Sprach-Dialog und wechselt zur Texteingabe. */
async function befehlTippen(page: Page, text: string) {
	await page.getByRole('button', { name: 'Sprachbefehl' }).click();
	const dialog = page.getByRole('dialog', { name: 'Sprachbefehl' });
	await expect(dialog).toBeVisible();
	const tippen = dialog.getByRole('button', { name: 'Befehl tippen' });
	if (await tippen.isVisible()) await tippen.click();
	await dialog.getByLabel('Befehl').fill(text);
	await dialog.getByRole('button', { name: 'Verstehen' }).click();
	return dialog;
}

test.describe('Sprachsteuerung', () => {
	test('Mikrofon-Knopf nur mit Modul sprache, groß genug, ohne Querscrollen', async ({ page }, info) => {
		await anmelden(page, BUERO);
		const knopf = page.getByRole('button', { name: 'Sprachbefehl' });
		await expect(knopf).toBeVisible();
		const box = (await knopf.boundingBox())!;
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		await foto(page, 'mikrofon-knopf', info.project.name);
	});

	test('ohne Mikrofon-Freigabe: Hinweis „Kein Zugriff aufs Mikrofon“ + Texteingabe', async ({ page }, info) => {
		await anmelden(page, BUERO);
		await page.getByRole('button', { name: 'Sprachbefehl' }).click();
		const dialog = page.getByRole('dialog', { name: 'Sprachbefehl' });
		await expect(dialog.getByText('Kein Zugriff aufs Mikrofon')).toBeVisible();
		await expect(dialog.getByLabel('Befehl')).toBeVisible();
		await foto(page, 'mikrofon-verweigert', info.project.name);
		await dialog.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(dialog).toBeHidden();
	});

	test('„Neues To-do für Murat: Silikonfuge erneuern, bis Freitag“ → Karte → Ja → To-do erscheint', async ({ page }, info) => {
		await anmelden(page, BUERO);
		const titel = `Silikonfuge erneuern ${info.project.name === 'mobil' ? 'Bad' : 'Küche'}`;
		const dialog = await befehlTippen(page, `Neues To-do für Murat: ${titel}, bis Freitag`);
		const karte = dialog.getByRole('region', { name: 'Bestätigung' });
		await expect(karte.getByRole('heading', { name: 'To-do anlegen' })).toBeVisible();
		await expect(karte).toContainText(titel);
		await expect(karte).toContainText('Murat Öztürk');
		await expect(karte).toContainText(/Freitag, \d{2}\.\d{2}\.\d{4}/);
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		await foto(page, 'bestaetigungskarte', info.project.name);
		await karte.getByRole('button', { name: 'Ja, speichern' }).click();
		await expect(dialog.getByRole('status')).toContainText(`To-do „${titel}“ angelegt`);
		let id: string | null = null;
		try {
			await page.goto('/todos?nur=alle');
			await expect(page.getByText(titel).first()).toBeVisible();
			const todos = await api(page, 'GET', '/api/todos?nur=alle');
			const t = todos.find((x: any) => x.titel === titel);
			expect(t).toBeTruthy();
			id = t.id;
			expect(t.zustaendigName).toBe('Murat Öztürk');
			// Protokoll: Quelle Sprache
			const verlauf = await api(page, 'GET', `/api/protokoll?tabelle=todos&datensatz=${t.id}`);
			expect(verlauf.eintraege[0].quelle).toBe('sprache');
		} finally {
			if (id) await api(page, 'DELETE', `/api/todos/${id}`);
		}
	});

	test('Mehrdeutigkeit: zwei Kunden gleichen Namens → Auswahl mit Ort → Auftrag beim gewählten Kunden', async ({ page }, info) => {
		await anmelden(page, BUERO);
		const name = `Doppelt${info.project.name === 'mobil' ? 'mob' : 'desk'}`;
		const kiel = await api(page, 'POST', '/api/kunden', { art: 'privat', vorname: 'Eva', nachname: name, ort: 'Kiel' });
		const luebeck = await api(page, 'POST', '/api/kunden', { art: 'privat', vorname: 'Tom', nachname: name, ort: 'Lübeck' });
		let auftragId: string | null = null;
		try {
			const dialog = await befehlTippen(page, `Neuer Auftrag Dachrinne reinigen bei ${name}`);
			const karte = dialog.getByRole('region', { name: 'Bestätigung' });
			await expect(karte.getByText(`Meinen Sie Kunde ${name} in Kiel oder in Lübeck?`)).toBeVisible();
			const speichern = karte.getByRole('button', { name: 'Ja, speichern' });
			await expect(speichern).toBeDisabled();
			await foto(page, 'auswahl', info.project.name);
			await karte.getByRole('button', { name: `Tom ${name}, Lübeck` }).click();
			await expect(speichern).toBeEnabled();
			await speichern.click();
			const status = dialog.getByRole('status');
			await expect(status).toContainText(/Auftrag A-\d{4}-\d{4} „Dachrinne reinigen“ angelegt/);
			await status.getByRole('link', { name: 'Öffnen' }).click();
			await page.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/);
			auftragId = page.url().split('/').pop()!;
			const a = await api(page, 'GET', `/api/auftraege/${auftragId}`);
			expect(a.kundeId).toBe(luebeck.id);
		} finally {
			if (auftragId) await api(page, 'DELETE', `/api/auftraege/${auftragId}`);
			await api(page, 'DELETE', `/api/kunden/${kiel.id}`);
			await api(page, 'DELETE', `/api/kunden/${luebeck.id}`);
		}
	});

	test('Monteur: Angebot per Sprache → „Dafür fehlt Ihnen die Berechtigung“, kein Speichern', async ({ page }) => {
		await anmelden(page, MONTEUR);
		const dialog = await befehlTippen(page, 'Erstelle ein Angebot für Schröder: 12 Quadratmeter Wandfliesen');
		const karte = dialog.getByRole('region', { name: 'Bestätigung' });
		await expect(karte.getByRole('alert')).toHaveText('Dafür fehlt Ihnen die Berechtigung');
		await expect(karte.getByRole('button', { name: 'Ja, speichern' })).toHaveCount(0);
	});

	test('nicht unterstützt → „Das kann ich noch nicht“', async ({ page }) => {
		await anmelden(page, BUERO);
		const dialog = await befehlTippen(page, 'Schreib eine Rechnung für Schröder');
		await expect(dialog.getByRole('heading', { name: 'Das kann ich noch nicht' })).toBeVisible();
	});
});
