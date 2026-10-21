import { expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as OTPAuth from 'otpauth';

/** Zugangsdaten aus `.zugangsdaten-dev` (geschrieben von scripts/seed-dev.ts; Schlüssel TAB Wert). */
export function zugang(schluessel: string): string {
	const text = readFileSync('.zugangsdaten-dev', 'utf8');
	for (const zeile of text.split('\n')) {
		const [k, ...rest] = zeile.split('\t');
		if (k === schluessel) return rest.join('\t').trim();
	}
	throw new Error(`Kein Eintrag „${schluessel}“ in .zugangsdaten-dev – bitte npm run seed:dev ausführen`);
}

/**
 * Meldet sich mit E-Mail und Passwort an (ohne zweiten Faktor). Läuft die Vorschau im Testmodus (CRM_TESTMODUS=1,
 * Feld „Benutzername“), wird der Weg „Mit E-Mail und Passwort anmelden“ benutzt – gleiche Prüfung wie ohne Testmodus.
 */
export async function anmelden(page: Page, email: string): Promise<void> {
	await page.goto('/anmelden');
	const testmodus = page.getByText('Mit E-Mail und Passwort anmelden');
	if (await testmodus.isVisible()) {
		await page.getByLabel('Benutzername').fill(email);
		await testmodus.click();
	} else {
		await page.getByLabel('E-Mail').fill(email);
	}
	await page.getByLabel('Passwort').fill(zugang(email));
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden$/);
}

/** Aktueller TOTP-Code zu einem Base32-Geheimnis (gleiche Parameter wie src/lib/server/auth/totp.ts). */
export function totpCode(geheimnis: string, zeit = Date.now()): string {
	return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(geheimnis), digits: 6, period: 30 }).generate({
		timestamp: zeit
	});
}

/**
 * Anmeldung als Plattform-Admin mit Passwort und echtem TOTP-Code (Geheimnis aus `.zugangsdaten-dev`). Ein Code gilt
 * nur einmal: Wurde der aktuelle Zeitschritt schon benutzt (z. B. von einem Lauf kurz davor), wird der nächste
 * abgewartet. Endet in der Plattform-Verwaltung (/admin).
 */
export async function anmeldenAlsAdmin(page: Page): Promise<void> {
	await anmelden(page, 'admin@crm.test');
	await expect(page).toHaveURL(/\/anmelden\/zweiter-faktor$/);
	const geheimnis = zugang('totp:admin@crm.test');
	for (let versuch = 0; versuch < 2; versuch++) {
		await page.getByLabel('Code').fill(totpCode(geheimnis));
		await page.getByRole('button', { name: 'Bestätigen' }).click();
		const ergebnis = await Promise.race([
			// Der jeweils andere Zweig läuft später in sein Zeitlimit – ohne catch wäre das eine unbehandelte Ablehnung.
			page.waitForURL(/\/admin$/, { timeout: 15_000 }).then(() => 'angemeldet', () => 'zeit'),
			page.getByRole('alert').waitFor({ timeout: 15_000 }).then(() => 'abgelehnt', () => 'zeit')
		]);
		if (ergebnis === 'angemeldet') return;
		await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
	}
	await expect(page).toHaveURL(/\/admin$/);
}

/** Kein horizontales Scrollen: Der Inhalt ist nicht breiter als das Fenster. */
export async function erwarteKeinQuerScrollen(page: Page, breite: number): Promise<void> {
	const scrollBreite = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(scrollBreite, `scrollWidth auf ${page.url()}`).toBeLessThanOrEqual(breite);
}

export const hauptnavigation = (page: Page) => page.getByRole('navigation', { name: 'Hauptnavigation' });

/**
 * Personen in der Personenauswahl (PersonWahl, mehrfach) ankreuzen: Chip „<feld>: …“ öffnen, Namen ankreuzen,
 * „Fertig“. `bereich` grenzt die Suche ein (Formular, Region).
 */
export async function personenWaehlen(bereich: Page | Locator, feld: string, namen: string[]): Promise<void> {
	const esc = feld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	await bereich.getByRole('button', { name: new RegExp(`^${esc}( \\(Pflichtfeld\\))?:`) }).click();
	const liste = bereich.getByRole('dialog', { name: feld });
	for (const n of namen) await liste.getByRole('checkbox', { name: n, exact: true }).check();
	await liste.getByRole('button', { name: 'Fertig' }).click();
}

/** Eine Person in der Personenauswahl (PersonWahl, einzeln) wählen. */
export async function personWaehlen(bereich: Page | Locator, feld: string, name: string): Promise<void> {
	const esc = feld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	await bereich.getByRole('button', { name: new RegExp(`^${esc}( \\(Pflichtfeld\\))?:`) }).click();
	await bereich.getByRole('option', { name, exact: true }).click();
}

/**
 * Kundenportal öffnen; fragt es nach dem Passwort (msg 3037), wird `PORTAL_PASSWORT` eingegeben (bei vorübergehenden
 * Test-Links die PLZ des Kunden).
 */
export async function portalOeffnen(page: Page, token: string): Promise<void> {
	await page.goto(`/portal/${token}`);
	const feld = page.locator('#pp-passwort');
	if (await feld.isVisible()) {
		await feld.fill(process.env.PORTAL_PASSWORT ?? '');
		await page.getByRole('button', { name: 'Öffnen' }).click();
		await page.locator('#pp-passwort').waitFor({ state: 'detached' });
	}
}
