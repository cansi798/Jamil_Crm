import { expect, test, type Browser, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen, personenWaehlen } from './hilfe';

/**
 * Online-Buchung (Jamil msgs 2684/2686) im Browser, gegen die Vorschau im Testmodus:
 * Chef legt einen Dienst (Murat + Sabine, abwechselnd) mit Frage und Mitarbeiter-Link an, Arbeitszeiten Mo–Fr 8–17;
 * ein Kunde bucht über den Murat-Link (ohne Anmeldung) → Kunde, Auftrag „Anfrage“ und Termin entstehen, zuständig ist
 * immer Murat; ein zweiter Kunde, der dieselbe Zeit gewählt hat, bekommt „nicht mehr frei“. Am Ende sagt der Kunde ab
 * und der Chef räumt Auftrag und Kunde auf. Bildschirmfotos (BILDSCHIRMFOTOS=<ordner>) als crm-buchung-*.png.
 */

const MURAT = 'Murat Öztürk';
const SABINE = 'Sabine Schäfer';
const foto = async (page: Page, name: string) => {
	const ordner = process.env.BILDSCHIRMFOTOS;
	if (ordner) await page.screenshot({ path: `${ordner}/crm-buchung-${name}.png`, fullPage: true });
};

async function alsChef(page: Page) {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
}

async function arbeitszeiten(page: Page, person: string) {
	await page.goto('/einstellungen/online-buchung/zeiten');
	await page.getByRole('button', { name: /^Mitarbeiter \(Pflichtfeld\)/ }).click();
	await page.getByRole('option', { name: person }).click();
	await expect(page.getByRole('button', { name: new RegExp(`^Mitarbeiter \\(Pflichtfeld\\): ${person}`) })).toBeVisible();
	await page.getByRole('button', { name: 'Mo–Fr 8–17 Uhr eintragen' }).click();
	const speichern = page.getByTestId('zeiten-speichern');
	if (await speichern.isEnabled()) {
		await speichern.click();
		await expect(page.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();
	}
}

async function bucherSeite(browser: Browser, link: string, projekt: string): Promise<Page> {
	const ctx = await browser.newContext(projekt === 'mobil' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
	const p = await ctx.newPage();
	await p.goto(link);
	await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
	return p;
}

async function waehleErstenTermin(p: Page): Promise<string> {
	const zeit = p.locator('.tw-zeit').first();
	await expect(zeit).toBeVisible();
	const beginn = (await zeit.getAttribute('data-beginn'))!;
	await zeit.click();
	return beginn;
}

let telefonNr = 0;
async function angabenAusfuellen(p: Page, nachname: string, email: string) {
	await p.getByLabel('Vorname *', { exact: true }).fill('Erika');
	await p.getByLabel('Name *', { exact: true }).fill(nachname);
	await p.getByLabel('E-Mail *').fill(email);
	// eigene Nummer je Buchung (Kunden werden über E-Mail ODER Telefon wiedererkannt)
	await p.getByLabel('Telefon *').fill(`040 ${String(Date.now()).slice(-7)}${++telefonNr}`);
	await p.getByLabel(/^Straße und Hausnummer/).fill('Testweg 7');
	await p.getByLabel(/^PLZ/).fill('22846');
	await p.getByLabel(/^Ort/).fill('Norderstedt');
	await p.getByRole('radio', { name: 'Ja' }).click();
	await p.getByRole('checkbox', { name: /Ich bin einverstanden/ }).check();
}

test('Online-Buchung: Dienst anlegen, buchen ohne Anmeldung, Doppelbuchung verhindert, Link nur für Murat', async ({ page, browser }, info) => {
	test.setTimeout(180_000);
	const projekt = info.project.name;
	const kennung = `${projekt}-${Date.now().toString(36)}`;
	const dienstName = `E2E Besichtigung ${kennung}`;
	await alsChef(page);

	// 1. Arbeitszeiten (Mo–Fr 8–17) für beide
	await arbeitszeiten(page, MURAT);
	await arbeitszeiten(page, SABINE);
	await foto(page, `${projekt}-zeiten`);

	// 2. Dienst anlegen: abwechselnd Murat + Sabine
	await page.goto('/einstellungen/online-buchung');
	await page.getByRole('button', { name: 'Dienst hinzufügen' }).click();
	const neu = page.getByRole('region', { name: 'Dienst hinzufügen' });
	await neu.getByLabel('Name').fill(dienstName);
	await personenWaehlen(neu, 'Mitarbeiter', [MURAT, SABINE]);
	await neu.getByRole('button', { name: 'Anlegen' }).click();
	await expect(page).toHaveURL(/\/einstellungen\/online-buchung\/[0-9a-f-]{36}$/);
	const dienstUrl = page.url();

	// Vorlauf „keiner“, eine Ja/Nein-Frage, speichern
	await page.getByLabel('Mindestvorlauf').selectOption({ label: 'keiner' });
	await page.getByTestId('feld-dazu').selectOption('janein');
	await page.getByLabel('Beschriftung / Frage').fill('Gibt es Parkplätze?');
	await page.getByTestId('dienst-speichern').click();
	await expect(page.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();

	// Link nur für Murat
	await page.getByLabel('Eigener Link für einen Mitarbeiter').selectOption({ label: MURAT });
	await page.getByRole('button', { name: 'Link anlegen' }).click();
	await expect(page.getByTestId('buchungslink')).toHaveCount(2);
	const muratLink = await page.locator('li', { hasText: `Nur ${MURAT}` }).getByTestId('buchungslink').inputValue();
	expect(muratLink).toMatch(/\/buchen\/[A-Za-z0-9_-]{32}$/);
	await foto(page, `${projekt}-dienst`);
	// gleicher Ursprung wie die Testseite (ORIGIN der Vorschau kann die öffentliche Adresse sein)
	const pfad = new URL(new URL(muratLink).pathname, page.url()).href;

	// 3. Zwei Kunden öffnen gleichzeitig den Link und wählen dieselbe (erste freie) Zeit
	const kunde1 = await bucherSeite(browser, pfad, projekt);
	const kunde2 = await bucherSeite(browser, pfad, projekt);
	await expect(kunde1.getByText('mit Murat')).toBeVisible();
	await erwarteKeinQuerScrollen(kunde1, projekt === 'mobil' ? 390 : 1280);
	await foto(kunde1, `${projekt}-buchen`);
	const beginn = await waehleErstenTermin(kunde1);
	expect(await waehleErstenTermin(kunde2)).toBe(beginn);
	await angabenAusfuellen(kunde1, `Bucher ${kennung}`, `e2e-${kennung}@beispiel.test`);
	await angabenAusfuellen(kunde2, `Zweiter ${kennung}`, `e2e2-${kennung}@beispiel.test`);
	await kunde1.waitForTimeout(3200); // Zeitstempel-Schutz: nicht schneller als 3 Sekunden
	await foto(kunde1, `${projekt}-formular`);

	await kunde1.getByTestId('buchen').click();
	await expect(kunde1).toHaveURL(/\/buchung\/[A-Za-z0-9_-]{43}\?neu=1$/);
	await expect(kunde1.getByRole('heading', { name: 'Vielen Dank, Ihr Termin ist gebucht!' })).toBeVisible();
	await expect(kunde1.getByRole('link', { name: 'In meinen Kalender (.ics)' })).toBeVisible();
	await foto(kunde1, `${projekt}-bestaetigung`);

	// zweiter Kunde: dieselbe Zeit ist weg
	await kunde2.getByTestId('buchen').click();
	await expect(kunde2.getByRole('alert')).toContainText('nicht mehr frei');
	await expect(kunde2.locator(`.tw-zeit[data-beginn="${beginn}"]`)).toHaveCount(0);
	await foto(kunde2, `${projekt}-vergeben`);

	// .ics lädt
	const ics = await kunde1.request.get(kunde1.url().replace('?neu=1', '') + '/kalender');
	expect(ics.headers()['content-type']).toContain('text/calendar');
	expect(await ics.text()).toContain('BEGIN:VEVENT');

	// 4. Chef: Auftrag „Anfrage“ mit Online-Buchung, Murat zuständig, Termin in der Plantafel
	await page.goto(dienstUrl);
	const buchung = page.locator('li', { hasText: `Bucher ${kennung}` });
	await expect(buchung).toContainText(MURAT);
	await buchung.getByRole('link', { name: 'Auftrag' }).click();
	await expect(page).toHaveURL(/\/auftraege\/[0-9a-f-]{36}$/);
	const auftragUrl = page.url();
	const karte = page.getByTestId('online-buchung');
	await expect(karte).toContainText(dienstName);
	await expect(karte).toContainText(MURAT);
	await expect(karte).toContainText('Gibt es Parkplätze?');
	await expect(karte).toContainText('Ja');
	await expect(page.getByRole('button', { name: /^Auftragsquelle: Online-Buchung/ })).toBeVisible();
	await foto(page, `${projekt}-auftrag`);

	// 5. Zweite Buchung über den Murat-Link (Sabine wäre frei) → wieder Murat
	const kunde3 = await bucherSeite(browser, pfad, projekt);
	await waehleErstenTermin(kunde3);
	await angabenAusfuellen(kunde3, `Dritter ${kennung}`, `e2e3-${kennung}@beispiel.test`);
	await kunde3.waitForTimeout(3200);
	await kunde3.getByTestId('buchen').click();
	await expect(kunde3).toHaveURL(/\/buchung\//);
	await page.goto(dienstUrl);
	const dritte = page.locator('li', { hasText: `Dritter ${kennung}` });
	await expect(dritte).toContainText(MURAT);
	await expect(dritte).not.toContainText(SABINE);
	const auftrag3Url = new URL((await dritte.getByRole('link', { name: 'Auftrag' }).getAttribute('href'))!, page.url()).href;

	// 6. Aufräumen: Kunden sagen ab (Termine frei), Dienst ausschalten/löschen
	for (const k of [kunde1, kunde3]) {
		await k.goto(k.url().replace('?neu=1', ''));
		await k.getByRole('button', { name: 'Termin absagen' }).click();
		await k.getByRole('button', { name: 'Ja, absagen' }).click();
		await expect(k.getByRole('heading', { name: 'Termin abgesagt' })).toBeVisible();
	}
	await foto(kunde1, `${projekt}-abgesagt`);
	await page.goto(auftragUrl);
	await expect(page.getByTestId('online-buchung')).toContainText('vom Kunden abgesagt');
	await page.goto(dienstUrl);
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Dienst löschen' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'nur ausgeschaltet' })).toBeVisible();
	expect((await kunde1.request.get(pfad)).status()).toBe(404);
	for (const k of [kunde1, kunde2, kunde3]) await k.context().close();
	// Aufträge und Kunden der Test-Buchungen wieder löschen
	for (const url of [auftragUrl, auftrag3Url]) {
		await page.goto(url);
		const kundeUrl = new URL((await page.locator('.af-stamm a').first().getAttribute('href'))!, page.url()).href;
		await page.getByText('Auftrag löschen …').click();
		await page.getByRole('button', { name: 'Endgültig löschen' }).click();
		await expect(page).not.toHaveURL(url);
		await page.goto(kundeUrl);
		await page.getByText('Kunde löschen …').click();
		await page.getByRole('button', { name: 'Endgültig löschen' }).click();
		await expect(page).not.toHaveURL(kundeUrl);
	}
});
