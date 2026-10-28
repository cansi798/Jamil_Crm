import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';

/**
 * Frei gestaltbare Protokolle (Wunsch Jamil, msg 2649): Der Monteur startet im Auftrag das „Abdichtungsprotokoll Bad“,
 * füllt Schritt für Schritt aus – „Weiter“ bleibt gesperrt, bis das Foto der Abdichtung da ist –, lässt den Kunden
 * unterschreiben und schließt ab. Danach: gesperrt, PDF in den Dokumenten des Auftrags, Eintrag im Verlauf.
 * Mit FOTOS=<ordner> entstehen Bildschirmfotos (crm-protokoll-*.png).
 */
const BUERO = 'buero@bauwelt.test';
const MONTEUR = 'monteur@bauwelt.test';
const FOTOS = process.env.FOTOS;

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

/** Ein echtes JPEG (Canvas im Browser) als Testfoto. */
async function testJpeg(page: Page): Promise<Buffer> {
	const b64 = await page.evaluate(() => {
		const c = document.createElement('canvas');
		c.width = 640;
		c.height = 480;
		const g = c.getContext('2d')!;
		g.fillStyle = '#8fa3b8';
		g.fillRect(0, 0, 640, 480);
		g.fillStyle = '#2b6cb0';
		g.fillRect(60, 300, 520, 140);
		g.fillStyle = '#fff';
		g.font = 'bold 40px sans-serif';
		g.fillText('Abdichtung Dusche', 120, 200);
		return c.toDataURL('image/jpeg', 0.8).split(',')[1];
	});
	return Buffer.from(b64, 'base64');
}

const foto = async (page: Page, name: string) => {
	if (FOTOS) await page.screenshot({ path: `${FOTOS}/crm-protokoll-${name}.png`, fullPage: true });
};

test('Monteur füllt das Abdichtungsprotokoll mit Foto und Unterschrift aus → gesperrt, PDF im Auftrag', async ({ page, browser }, info) => {
	const mobil = info.project.name === 'mobil';
	// Büro legt einen Auftrag an und macht den Monteur zuständig
	const buero = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' })).newPage();
	await anmelden(buero, BUERO);
	const woche = await api(buero, 'GET', '/api/plantafel');
	const monteur = woche.mitarbeiter.find((m: { name: string }) => m.name === 'Murat Öztürk');
	const kunde = (await api(buero, 'GET', '/api/kunden'))[0];
	const auftrag = await api(buero, 'POST', '/api/auftraege', {
		titel: `E2E Bad abdichten ${info.project.name} ${Date.now()}`,
		kundeId: kunde.id,
		zustaendige: [monteur.id]
	});

	try {
		await anmelden(page, MONTEUR);
		await page.goto(`/auftraege/${auftrag.id}`);
		await page.getByTestId('protokoll-vorlage').selectOption({ label: 'Abdichtungsprotokoll Bad' });
		await page.getByTestId('protokoll-starten').click();
		await page.waitForURL(/\/protokolle\/[0-9a-f-]{36}$/);
		const protokollUrl = page.url();
		const weiter = page.getByTestId('weiter');

		// Schritt 1: Untergrund (Datum ist schon heute)
		await expect(page.getByText('Schritt 1 von 5')).toBeVisible();
		await expect(weiter).toBeDisabled();
		await page.getByRole('radio', { name: 'Zementestrich' }).click();
		await page.getByLabel('Restfeuchte Estrich').fill('1,8');
		await page.getByRole('radio', { name: 'Ja' }).click();
		if (mobil) await foto(page, 'schritt1-mobil');
		await expect(weiter).toBeEnabled();
		await weiter.click();

		// Schritt 2: Abdichtung – Checkliste muss vollständig sein
		await expect(page.getByText('Schritt 2 von 5')).toBeVisible();
		await page.getByRole('radio', { name: 'Flüssigabdichtung' }).click();
		for (const punkt of ['Grundierung aufgetragen', 'Dichtband in Ecken und Übergängen', 'Manschetten an Durchdringungen', 'Bodenablauf eingebunden']) {
			await page.getByLabel(punkt).check();
		}
		await expect(weiter).toBeDisabled();
		await expect(page.getByTestId('noch-offen')).toContainText('1 Punkt offen');
		await page.getByLabel('Zwei Schichten aufgetragen').check();
		await weiter.click();

		// Schritt 3: ohne Foto der Abdichtung kein „Weiter“
		await expect(page.getByText('Schritt 3 von 5')).toBeVisible();
		await expect(weiter).toBeDisabled();
		await expect(page.getByTestId('noch-offen')).toContainText('Foto der Abdichtung – Foto fehlt');
		await foto(page, mobil ? 'weiter-gesperrt-mobil' : 'weiter-gesperrt-desktop');
		await page.getByTestId('foto-foto_abdichtung').setInputFiles({ name: 'abdichtung.jpg', mimeType: 'image/jpeg', buffer: await testJpeg(page) });
		await expect(page.locator('[data-feld="foto_abdichtung"] img')).toHaveCount(1);
		await expect(weiter).toBeEnabled();
		if (mobil) await foto(page, 'foto-mobil');
		await weiter.click();

		// Schritt 4: Mängel – „ja“ zeigt Beschreibung und Foto (Pflicht), „nein“ nicht
		await expect(page.getByText('Schritt 4 von 5')).toBeVisible();
		await page.getByRole('radio', { name: 'Ja' }).click();
		await expect(page.getByLabel('Beschreibung des Mangels')).toBeVisible();
		await expect(weiter).toBeDisabled();
		await page.getByRole('radio', { name: 'Nein' }).click();
		await expect(page.getByLabel('Beschreibung des Mangels')).toHaveCount(0);
		await weiter.click();

		// Schritt 5: Unterschrift des Kunden (Pflicht)
		await expect(page.getByText('Schritt 5 von 5')).toBeVisible();
		await expect(page.getByTestId('abschliessen')).toBeDisabled();
		const feld = page.locator('[data-feld="unterschrift_kunde"]');
		await feld.getByTestId('name-unterschrift_kunde').fill('Erika Mustermann');
		const canvas = feld.getByTestId('unterschrift-canvas');
		await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		const box = (await canvas.boundingBox())!;
		await page.mouse.move(box.x + 20, box.y + 140);
		await page.mouse.down();
		for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 18, box.y + 140 - Math.sin(i / 2) * 60);
		await page.mouse.up();
		await feld.getByTestId('unterschrift-speichern').click();
		await expect(feld.locator('img')).toHaveCount(1);
		await expect(feld).toContainText('Erika Mustermann');
		await expect(page.getByTestId('speicher-stand')).toHaveText('Gespeichert');
		if (mobil) await foto(page, 'unterschrift-mobil');

		// Abschließen → gesperrt
		await page.getByTestId('abschliessen').click();
		await expect(page.getByTestId('protokoll-abgeschlossen')).toContainText('unterschrieben von Erika Mustermann');
		await expect(page.getByTestId('weiter')).toHaveCount(0);
		await expect(page.locator('input:not([disabled])[type="text"]')).toHaveCount(0);
		await foto(page, mobil ? 'abgeschlossen-mobil' : 'abgeschlossen-desktop');

		// Gesperrt auch für die API
		const id = protokollUrl.split('/').pop()!;
		const r = await page.evaluate(
			async (id) =>
				(await fetch(`/api/protokoll-formulare/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"antworten":{}}' })).status,
			id
		);
		expect(r).toBe(409);

		// PDF existiert (abgelegt) und liegt in den Dokumenten des Auftrags; Verlauf
		const pdf = await page.evaluate(async (id) => {
			const r = await fetch(`/api/protokoll-formulare/${id}/pdf`);
			const b = new Uint8Array(await r.arrayBuffer());
			return { typ: r.headers.get('content-type'), kopf: String.fromCharCode(...b.slice(0, 5)), laenge: b.length };
		}, id);
		expect(pdf.typ).toBe('application/pdf');
		expect(pdf.kopf).toBe('%PDF-');
		expect(pdf.laenge).toBeGreaterThan(20_000); // mit Foto und Unterschrift
		const dateien = await api(buero, 'GET', `/api/dateien?auftragId=${auftrag.id}`);
		expect(dateien.map((d: { name: string; typ: string }) => d.typ)).toContain('application/pdf');
		expect(dateien.find((d: { typ: string }) => d.typ === 'application/pdf').name).toMatch(/^Protokoll Abdichtungsprotokoll Bad \d{2}\.\d{2}\.\d{4}\.pdf$/);

		await buero.goto(`/auftraege/${auftrag.id}`);
		await expect(buero.locator('a[href^="/protokolle/"]')).toContainText('Abgeschlossen');
		await expect(buero.getByText(/Protokoll „Abdichtungsprotokoll Bad“ abgeschlossen – unterschrieben von Erika Mustermann/)).toBeVisible();
		if (!mobil) {
			await buero.getByRole('heading', { name: 'Protokolle', exact: true }).scrollIntoViewIfNeeded();
			await foto(buero, 'auftrag-desktop');
		}
	} finally {
		// Aufräumen: Auftrag (Status Anfrage) samt Protokoll und Dokumenten löschen
		await api(buero, 'DELETE', `/api/auftraege/${auftrag.id}`);
		await buero.context().close();
	}
});

test('Baukasten: Vorlage öffnen, Feld mit Bedingung, Live-Vorschau sperrt „Weiter“', async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'Baukasten am Desktop');
	await anmelden(page, BUERO);
	await page.goto('/einstellungen/protokoll-vorlagen');
	await expect(page.getByRole('heading', { name: 'Protokoll- & Aufmaß-Vorlagen' })).toBeAttached();
	await foto(page, 'vorlagen-liste-desktop');
	await page.getByRole('link', { name: /Abnahmeprotokoll/ }).first().click();
	await page.waitForURL(/\/einstellungen\/protokoll-vorlagen\/[0-9a-f-]{36}$/);
	// Feld mit Bedingung aufklappen: „Fotos der Mängel“ ist Pflicht nur bei Mängeln
	await page.getByRole('button', { name: /Fotos der Mängel/ }).click();
	await expect(page.locator('.pb-bedingung')).toContainText('Pflicht, wenn „Mängel vorhanden?“ ist ja');
	// Vorschau: Schritt 1 sperrt, bis die Pflichtfelder da sind
	const vorschau = page.getByRole('complementary', { name: 'Live-Vorschau' });
	await expect(vorschau.getByTestId('weiter')).toBeDisabled();
	await vorschau.getByLabel('Datum der Abnahme').fill('2026-10-20');
	await vorschau.getByRole('radio', { name: 'Gesamtabnahme' }).click();
	await expect(vorschau.getByTestId('weiter')).toBeEnabled();
	await vorschau.getByRole('radio', { name: 'Teilabnahme' }).click();
	await expect(vorschau.getByLabel('Welcher Teil wird abgenommen?')).toBeVisible();
	await expect(vorschau.getByTestId('weiter')).toBeDisabled();
	await foto(page, 'baukasten-desktop');
	// Ohne Änderung: Speichern gesperrt
	await expect(page.getByTestId('vorlage-speichern')).toBeDisabled();
});
