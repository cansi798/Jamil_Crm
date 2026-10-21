import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Sprachsteuerung im Browser (Stufe 1d) mit FakeKi (CRM_KI_ANBIETER=fake): Befehl tippen → Bestätigungskarte →
 * „Ja, speichern“. Als Büro (Rechte für Kunden, Aufträge, Aufgaben, Plantafel; ohne Pflicht-2FA – wie 1b/1c).
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
	test('Frage „Was steht heute für mich an?“: Antwort ohne Speichern, mit Vorlesen und Links (msg 2647)', async ({ page }) => {
		// Büro: Der Monteur hat seit msg 3011 standardmäßig keine Sprachsteuerung mehr
		await anmelden(page, BUERO);
		const dialog = await befehlTippen(page, 'Was steht heute für mich an?');
		const karte = dialog.getByRole('region', { name: 'Bestätigung' });
		await expect(karte.getByRole('heading', { name: 'Tagesplan heute' })).toBeVisible();
		await expect(karte).toContainText(/Du hast heute/);
		await expect(karte.getByRole('region', { name: 'Termine' })).toBeVisible();
		await expect(karte.getByRole('button', { name: 'Ja, speichern' })).toHaveCount(0);
		await expect(karte.getByRole('button', { name: 'Schließen' })).toBeVisible();
	});

	test('Neue Befehle: Status „weiter“ zeigt die Bestätigung mit Auftrag und neuem Status', async ({ page }) => {
		await anmelden(page, BUERO);
		const kunden = await api(page, 'GET', '/api/kunden');
		const titel = `E2E Sprachstatus ${Date.now()}`;
		const auftrag = await api(page, 'POST', '/api/auftraege', { titel, kundeId: kunden[0].id });
		try {
			const dialog = await befehlTippen(page, `Auftrag ${titel} weiter`);
			const karte = dialog.getByRole('region', { name: 'Bestätigung' });
			await expect(karte.getByRole('heading', { name: 'Auftragsstatus ändern' })).toBeVisible();
			await expect(karte).toContainText('Anfrage → Angebot');
			await karte.getByRole('button', { name: 'Ja, speichern' }).click();
			await expect(dialog).toContainText('ist jetzt „Angebot“');
		} finally {
			await api(page, 'POST', `/api/auftraege/${auftrag.id}/status`, { status: 'anfrage' }).catch(() => null);
			await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`).catch(() => null);
		}
	});

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

	test('„Neue Aufgabe für Murat: Silikonfuge erneuern, bis Freitag“ → Karte → Ja → Aufgabe erscheint', async ({ page }, info) => {
		await anmelden(page, BUERO);
		const titel = `Silikonfuge erneuern ${info.project.name === 'mobil' ? 'Bad' : 'Küche'}`;
		const dialog = await befehlTippen(page, `Neue Aufgabe für Murat: ${titel}, bis Freitag`);
		const karte = dialog.getByRole('region', { name: 'Bestätigung' });
		await expect(karte.getByRole('heading', { name: 'Aufgabe anlegen' })).toBeVisible();
		await expect(karte).toContainText(titel);
		await expect(karte).toContainText('Murat Öztürk');
		await expect(karte).toContainText(/Freitag, \d{2}\.\d{2}\.\d{4}/);
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		await foto(page, 'bestaetigungskarte', info.project.name);
		await karte.getByRole('button', { name: 'Ja, speichern' }).click();
		await expect(dialog.getByRole('status')).toContainText(`Aufgabe „${titel}“ angelegt`);
		let id: string | null = null;
		try {
			// Listenansicht: Das Board zeigt am Handy nur eine Spalte (Reiter) – die Aufgabe mit Fälligkeit steht unter
			// „In Arbeit“, nicht im ersten Reiter. Die Liste zeigt alle offenen Aufgaben auf jeder Breite.
			await page.goto('/todos?person=alle&ansicht=liste');
			await expect(page.getByRole('list', { name: 'Offene Aufgaben' }).getByText(titel).first()).toBeVisible();
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

	test('Mehrere Schritte in einem Satz: Kunde → Auftrag → Termin, nummerierte Vorschau, einmal bestätigen (msg 2983)', async ({ page }, info) => {
		await anmelden(page, BUERO);
		// Nur Buchstaben (Namenserkennung): „Mehrschritt“ + Projekt + Zeit als Buchstaben
		const name = `Mehrschritt${info.project.name === 'mobil' ? 'm' : 'd'}${String(Date.now()).slice(-6).replace(/\d/g, (z) => 'abcdefghij'[Number(z)])}`;
		let kundeId: string | null = null;
		let auftragId: string | null = null;
		try {
			const dialog = await befehlTippen(page, `Leg Kunde ${name} an, mach einen Auftrag Badsanierung und plan Murat für Montag ein.`);
			const karte = dialog.getByRole('region', { name: 'Bestätigung' });
			await expect(karte.getByRole('heading', { name: '3 Schritte' })).toBeVisible();
			const schritte = karte.getByRole('list', { name: 'Schritte' }).getByRole('listitem');
			await expect(schritte).toHaveCount(3);
			await expect(schritte.nth(0)).toContainText('Kunde anlegen');
			await expect(schritte.nth(0)).toContainText(name);
			await expect(schritte.nth(1)).toContainText('Auftrag anlegen');
			await expect(schritte.nth(1)).toContainText('(neu, Schritt 1)');
			await expect(schritte.nth(2)).toContainText('Termin einplanen');
			await expect(schritte.nth(2)).toContainText('Murat Öztürk');
			await expect(schritte.nth(2)).toContainText('(neu, Schritt 2)');
			await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
			await foto(page, 'mehrere-schritte', info.project.name);
			await karte.getByRole('button', { name: 'Ja, speichern' }).click();
			const status = dialog.getByRole('status');
			await expect(status).toContainText('Alle 3 Schritte erledigt');
			await expect(status.getByRole('list', { name: 'Ergebnis der Schritte' }).getByRole('listitem')).toHaveCount(3);
			await expect(status).not.toContainText('fehlgeschlagen');
			const kunden = await api(page, 'GET', `/api/kunden?suche=${name}`);
			expect(kunden).toHaveLength(1);
			kundeId = kunden[0].id;
			const auftraege = await api(page, 'GET', `/api/auftraege?kunde=${kundeId}`);
			expect(auftraege.map((x: any) => x.titel)).toEqual(['Badsanierung']);
			auftragId = auftraege[0].id;
			const a = await api(page, 'GET', `/api/auftraege/${auftragId}`);
			expect(a.kommenderTermin?.art ?? 'montage').toBeTruthy();
			const plan = await api(page, 'GET', `/api/plantafel?tag=${a.kommenderTermin.beginn.slice(0, 10)}`);
			expect(plan.einsaetze.some((e: any) => e.auftragId === auftragId && e.benutzerName === 'Murat Öztürk')).toBe(true);
		} finally {
			if (auftragId) await api(page, 'DELETE', `/api/auftraege/${auftragId}`);
			if (kundeId) await api(page, 'DELETE', `/api/kunden/${kundeId}`);
		}
	});

	test('Monteur ohne „Sprachsteuerung nutzen“ (Standard, msg 3011): kein Mikrofon-Knopf, Sprach-API 403', async ({ page }, info) => {
		await anmelden(page, MONTEUR);
		await page.goto('/');
		await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).first()).toBeAttached();
		await expect(page.getByRole('button', { name: 'Sprachbefehl' })).toHaveCount(0);
		await page.goto('/todos');
		await expect(page.getByRole('button', { name: 'Sprachbefehl' })).toHaveCount(0);
		const r = await page.evaluate(async () => {
			const a = await fetch('/api/sprache/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Neue Aufgabe Test' }) });
			return { status: a.status, koerper: await a.json() };
		});
		expect(r.status).toBe(403);
		expect(r.koerper.fehler).toBe('Die Sprachsteuerung ist für Ihre Rolle nicht freigeschaltet.');
		await foto(page, 'monteur-ohne-mikrofon', info.project.name);
	});

	test('nicht unterstützt → „Das kann ich noch nicht“', async ({ page }) => {
		await anmelden(page, BUERO);
		const dialog = await befehlTippen(page, 'Schreib eine Rechnung für Schröder');
		await expect(dialog.getByRole('heading', { name: 'Das kann ich noch nicht' })).toBeVisible();
	});

	test('KI-Angebotsentwurf im Auftrag: Stichworte → Entwurf aus Katalogpositionen, unsichere gelb „bitte prüfen“', async ({ page }, info) => {
		await anmelden(page, BUERO);
		await api(page, 'POST', '/api/katalog/vorlagen', { gewerk: 'fliesen' });
		const kunden = await api(page, 'GET', '/api/kunden');
		const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `E2E KI-Entwurf ${info.project.name}`, kundeId: kunden[0].id });
		let angebotId: string | null = null;
		try {
			await page.goto(`/auftraege/${auftrag.id}`);
			await page.getByRole('button', { name: 'Angebot hinzufügen' }).click();
			await page.getByText('KI-Entwurf', { exact: true }).click();
			await page.getByLabel('Leistungen (Stichworte)').fill('12 m² Bodenfliesen und Abdichtung');
			await page.getByRole('button', { name: 'Entwurf erstellen' }).click();
			await page.waitForURL(/\/angebote\/[0-9a-f-]{36}$/);
			angebotId = page.url().split('/').pop()!;
			const angebot = await api(page, 'GET', `/api/angebote/${angebotId}`);
			expect(angebot.status).toBe('entwurf');
			const boden = angebot.positionen.find((p: any) => /Bodenfliesen/.test(p.bezeichnung));
			expect(boden).toMatchObject({ menge: 12 });
			expect(boden.katalogPositionId).toBeTruthy();
			const abdichtung = angebot.positionen.find((p: any) => /Abdichtung/.test(p.bezeichnung));
			expect(abdichtung.beschreibung).toMatch(/^Bitte prüfen \(KI-Vorschlag\)/);
			await expect(page.getByText('bitte prüfen (KI-Vorschlag)').first()).toBeVisible();
			await page.getByTestId('position').filter({ hasText: 'bitte prüfen (KI-Vorschlag)' }).first().scrollIntoViewIfNeeded();
			await foto(page, 'ki-angebotsentwurf', info.project.name);
		} finally {
			if (angebotId) await api(page, 'DELETE', `/api/angebote/${angebotId}`);
			await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		}
	});
});
