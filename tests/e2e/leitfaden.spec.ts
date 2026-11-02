import { expect, test, type Browser, type Page } from '@playwright/test';
import { anmelden, bestaetigen, erwarteKeinQuerScrollen } from './hilfe';
import { vorschauSperre } from './ziel';

/**
 * Leitfaden beim Termin (Jamil msgs 4302/4304; Entscheidungen 4340: 1c / 2b / 3a / 4b): Einstellungen, EINE Fläche am
 * Handy, Kundendaten landen in der Kundenakte, Abschluss mit Begründung → Hinweis ans Büro, Eingaben ohne Netz werden
 * nachgeschickt. Legt eigene Kunden/Aufträge/Termine an und löscht sie am Ende.
 */
const BUERO = 'buero@bauwelt.test';
const MONTEUR = 'monteur@bauwelt.test';

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, { method: methode, headers: koerper === undefined ? undefined : { 'content-type': 'application/json' }, body: koerper === undefined ? undefined : JSON.stringify(koerper) });
			return { status: a.status, text: await a.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

/** Kunde (ohne E-Mail), Auftrag und Besichtigung heute für Murat (Monteur) – als Büro angelegt. */
async function besichtigungHeute(page: Page, name: string) {
	const kunde = await api(page, 'POST', '/api/kunden', { art: 'privat', nachname: name });
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `Besichtigung ${name}`, kundeId: kunde.id });
	const woche = await api(page, 'GET', '/api/plantafel');
	const murat = woche.mitarbeiter.find((m: { name: string }) => m.name === 'Murat Öztürk');
	const beginn = new Date(Date.now() + 5 * 60_000);
	const ende = new Date(Math.min(beginn.getTime() + 60 * 60_000, new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }) + 'T23:59:00+01:00').getTime()));
	const termin = await api(page, 'POST', '/api/einsaetze', { auftragId: auftrag.id, benutzerId: murat.id, beginn: beginn.toISOString(), ende: ende.toISOString(), art: 'besichtigung' });
	return { kunde, auftrag, termin };
}

async function alsMonteur(browser: Browser, opt: object) {
	const ctx = await browser.newContext(opt);
	const seite = await ctx.newPage();
	await anmelden(seite, MONTEUR);
	return { ctx, seite };
}

test('Einstellungen: Leitfaden an, Besichtigung angehakt, Schritt hinzufügen und wieder entfernen', async ({ page }) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus (Chef ohne Zwei-Faktor)');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/einstellungen/leitfaden');
	await expect(page.getByRole('heading', { name: 'Leitfaden beim Termin' })).toBeVisible();
	await expect(page.getByRole('group', { name: 'Termin-Arten' }).getByLabel('Besichtigung')).toBeChecked();
	const schritte = page.getByTestId('leitfaden-schritt');
	const vorher = await schritte.count();
	expect(vorher).toBeGreaterThan(0);
	await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);

	await page.getByRole('button', { name: '+ Schritt hinzufügen' }).click();
	await schritte.last().getByLabel('Titel').fill('E2E Gibt es Haustiere?');
	await page.getByTestId('leitfaden-speichern').click();
	await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
	await page.reload();
	await expect(schritte).toHaveCount(vorher + 1);
	await expect(schritte.last().getByLabel('Titel')).toHaveValue('E2E Gibt es Haustiere?');

	await schritte.last().getByRole('button', { name: 'Entfernen' }).click();
	await bestaetigen(page, 'Entfernen');
	await page.getByTestId('leitfaden-speichern').click();
	await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
	await page.reload();
	await expect(schritte).toHaveCount(vorher);
});

test('Monteur: Leitfaden aus „Heute“, Kundendaten landen in der Kundenakte, Abschluss mit Begründung → Hinweis ans Büro', async ({ page, browser }, info) => {
	test.skip(!!vorschauSperre(), 'legt Testdaten an – nicht gegen die Vorschau');
	await anmelden(page, BUERO);
	const name = `E2E-Leitfaden ${info.project.name} ${Date.now()}`;
	const { kunde, auftrag, termin } = await besichtigungHeute(page, name);
	const { ctx, seite } = await alsMonteur(browser, info.project.use);
	try {
		await seite.goto('/');
		// Startseite „Heute“: am Termin Kontaktweg (noch keine Angabe) und Knopf „Leitfaden starten“
		const zeile = seite.locator('li').filter({ hasText: name });
		await expect(zeile.getByTestId('plan-kontaktweg')).toContainText('keine Angabe');
		await zeile.getByRole('link', { name: /Leitfaden starten/ }).click();
		await expect(seite).toHaveURL(new RegExp(`/leitfaden/${termin.id}$`));
		const lf = seite.getByTestId('leitfaden');
		await expect(lf.getByRole('heading', { name })).toBeVisible();
		await erwarteKeinQuerScrollen(seite, seite.viewportSize()!.width);

		// E-Mail und Kontaktweg → Kundenakte
		const email = seite.getByTestId('schritt-email').getByLabel('E-Mail-Adresse');
		await email.fill('kunde.e2e@example.org');
		await email.press('Tab');
		await seite.getByTestId('schritt-kontaktweg').getByRole('radio', { name: 'Kontaktweg: per Chat' }).click();
		await expect.poll(async () => (await api(page, 'GET', `/api/kunden/${kunde.id}`)).email).toBe('kunde.e2e@example.org');
		await expect.poll(async () => (await api(page, 'GET', `/api/kunden/${kunde.id}`)).bevorzugter_kontakt).toBe('chat');
		await expect(seite.getByTestId('schritt-email')).toContainText('Steht in der Kundenakte');

		// Pflicht „Fotos“ und „Vorhaben“ fehlen → nur mit Begründung
		const fuss = seite.getByTestId('leitfaden-abschluss');
		await expect(fuss).toContainText('Noch offen (Pflicht)');
		await fuss.getByRole('button', { name: 'Mit Begründung abschließen' }).click();
		await expect(seite.getByRole('alert').filter({ hasText: 'bitte kurz begründen' })).toBeVisible();
		await fuss.getByLabel('Begründung').fill('Kunde musste dringend weg');
		await fuss.getByRole('button', { name: 'Mit Begründung abschließen' }).click();
		await expect(seite.getByTestId('leitfaden-status')).toContainText('erledigt mit Begründung');

		// Büro: Hinweis in der Glocke, Karte „Leitfaden“ im Auftrag mit Begründung
		await expect.poll(async () => (await api(page, 'GET', '/api/benachrichtigungen')).liste.some((n: { link: string }) => n.link.includes(auftrag.id))).toBe(true);
		await page.goto(`/auftraege/${auftrag.id}`);
		await expect(page.getByTestId('auftrag-leitfaden').getByTestId('leitfaden-begruendung')).toContainText('Kunde musste dringend weg');
		await expect(page.getByTestId('termin-leitfaden')).toContainText('mit Begründung');
	} finally {
		await ctx.close();
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`);
	}
});

test('Ohne Netz: Eingabe bleibt auf dem Gerät und geht raus, sobald wieder Netz da ist (4b)', async ({ page, browser }, info) => {
	test.skip(!!vorschauSperre(), 'legt Testdaten an – nicht gegen die Vorschau');
	await anmelden(page, BUERO);
	const name = `E2E-Offline ${info.project.name} ${Date.now()}`;
	const { kunde, auftrag, termin } = await besichtigungHeute(page, name);
	const { ctx, seite } = await alsMonteur(browser, info.project.use);
	try {
		await seite.goto(`/leitfaden/${termin.id}`);
		await expect(seite.getByTestId('leitfaden')).toBeVisible();
		await ctx.setOffline(true);
		const feld = seite.getByTestId('schritt-vorhaben').getByRole('textbox');
		await feld.fill('Bad komplett neu, ohne Netz erfasst');
		await feld.press('Tab');
		await expect(seite.getByTestId('leitfaden-wartet')).toContainText('Kein Netz');
		await expect(seite.getByTestId('schritt-vorhaben')).toHaveClass(/erledigt/);
		await ctx.setOffline(false);
		await expect(seite.getByTestId('leitfaden-wartet')).toHaveCount(0, { timeout: 15_000 });
		const stand = await api(page, 'GET', `/api/leitfaden/${termin.id}`).catch(() => null);
		// Büro darf die Plantafel bearbeiten → sieht den Stand
		expect(stand?.antworten?.vorhaben?.wert).toBe('Bad komplett neu, ohne Netz erfasst');
	} finally {
		await ctx.close();
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`);
	}
});

test('Protokoll im Leitfaden (msg 4353): Felder, Foto und Unterschrift auf der einen Fläche, PDF beim Abschluss', async ({ page, browser }, info) => {
	test.skip(!!vorschauSperre(), 'legt Testdaten an – nicht gegen die Vorschau');
	await anmelden(page, BUERO);
	const name = `E2E-Protokoll ${info.project.name} ${Date.now()}`;
	const { kunde, auftrag, termin } = await besichtigungHeute(page, name);
	const { ctx, seite } = await alsMonteur(browser, info.project.use);
	try {
		await seite.goto(`/leitfaden/${termin.id}`);
		const prot = seite.getByTestId('protokoll-protokoll');
		await expect(prot).toBeVisible();
		await prot.locator('[data-feld="bereich"] input').fill('Bad im 1. OG');
		await prot.locator('[data-feld="bereich"] input').press('Tab');
		await prot.getByTestId('foto-fotos').setInputFiles({ name: 'raum.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
		const feld = prot.locator('[data-feld="unterschrift_kunde"]');
		await feld.getByTestId('name-unterschrift_kunde').fill('Erika Mustermann');
		const canvas = feld.getByTestId('unterschrift-canvas');
		await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		const box = (await canvas.boundingBox())!;
		await seite.mouse.move(box.x + 20, box.y + box.height / 2);
		await seite.mouse.down();
		for (let i = 1; i <= 12; i++) await seite.mouse.move(box.x + 20 + i * 15, box.y + box.height / 2 - Math.sin(i / 2) * 30);
		await seite.mouse.up();
		await feld.getByTestId('unterschrift-speichern').click();
		await expect(seite.getByTestId('schritt-protokoll')).toHaveClass(/erledigt/, { timeout: 15_000 });
		await erwarteKeinQuerScrollen(seite, seite.viewportSize()!.width);
		// Rest des Leitfadens mit Begründung abschließen → Protokoll wird abgeschlossen (PDF)
		await expect(seite.getByTestId('leitfaden-wartet')).toHaveCount(0, { timeout: 15_000 });
		const fuss = seite.getByTestId('leitfaden-abschluss');
		await fuss.getByLabel('Begründung').fill('Nur Protokoll getestet');
		await fuss.getByRole('button', { name: 'Mit Begründung abschließen' }).click();
		await expect(seite.getByTestId('leitfaden-status')).toContainText('erledigt mit Begründung');
		const stand = await api(page, 'GET', `/api/leitfaden/${termin.id}`);
		expect(stand.protokolle.protokoll.status).toBe('abgeschlossen');
		expect(stand.protokolle.protokoll.antworten.bereich).toBe('Bad im 1. OG');
	} finally {
		await ctx.close();
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`).catch(() => null);
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`).catch(() => null);
	}
});
