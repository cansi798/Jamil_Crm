import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Bevorzugter Kontaktweg am Kunden (Jamil, Talk msgs 4289/4291): Auswahl im Formular (Keine Angabe / E-Mail / Chat /
 * Telefon), Abzeichen in Kundenakte, Kundenliste (mit Filter) und Auftrag. Legt eigene Daten an und löscht sie am Ende.
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

test('Kontaktweg: anlegen mit Chat, Abzeichen in Akte und Liste, Filter, ändern auf Telefon, leeren', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const name = `E2E-Kontakt ${info.project.name} ${Date.now()}`;
	let id: string | null = null;
	try {
		await page.goto('/kunden/neu');
		const wahl = page.getByRole('radiogroup', { name: 'Bevorzugter Kontaktweg' });
		await expect(wahl.getByRole('radio')).toHaveCount(4);
		await expect(wahl.getByRole('radio', { name: 'Kontaktweg: keine Angabe' })).toBeChecked();
		await page.getByLabel('Nachname *').fill(name);
		// „Telefon“ meint eindeutig das Eingabefeld – die Radio-Felder heißen „Kontaktweg: per …“
		await page.getByLabel('Telefon', { exact: true }).fill('0171 1234567');
		await page.getByLabel('E-Mail', { exact: true }).fill('kontakt@example.org');
		await wahl.getByRole('radio', { name: 'Kontaktweg: per Chat' }).click();
		await expect(wahl.getByRole('radio', { name: 'Kontaktweg: per Chat' })).toBeChecked();
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		await page.getByRole('button', { name: 'Kunde anlegen' }).click();
		await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}$/);
		id = page.url().split('/').at(-1)!;

		// Kundenakte: Abzeichen im Kontakt-Bereich
		const kontakt = page.getByTestId('kontaktweg');
		await expect(kontakt.getByTestId('kontaktweg-chip')).toHaveText(/Chat/);
		await expect(kontakt.getByTestId('kontaktweg-chip')).toHaveAttribute('data-weg', 'chat');
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);

		// Kundenliste: Abzeichen in der Zeile, Filter Chat findet ihn, Filter Telefon nicht
		await page.goto(`/kunden?suche=${encodeURIComponent(name)}`);
		const zeile = page.getByRole('link', { name: new RegExp(name) });
		await expect(zeile.getByTestId('kontaktweg-chip')).toHaveText(/Chat/);
		await page.getByRole('combobox', { name: /Kontaktweg/ }).selectOption('telefon');
		await expect(page).toHaveURL(/kontakt=telefon/);
		await expect(page).toHaveURL(/suche=/);
		await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
		await page.getByRole('combobox', { name: /Kontaktweg/ }).selectOption('chat');
		await expect(page).toHaveURL(/kontakt=chat/);
		await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();

		// Bearbeiten: Auswahl ist vorbelegt, Wechsel auf Telefon → „bevorzugt“ neben der Nummer, Verlauf zeigt die Änderung
		await page.goto(`/kunden/${id}/bearbeiten`);
		const wahl2 = page.getByRole('radiogroup', { name: 'Bevorzugter Kontaktweg' });
		await expect(wahl2.getByRole('radio', { name: 'Kontaktweg: per Chat' })).toBeChecked();
		await wahl2.getByRole('radio', { name: 'Kontaktweg: per Anruf' }).click();
		await page.getByRole('button', { name: 'Speichern' }).click();
		await expect(page).toHaveURL(new RegExp(`/kunden/${id}$`));
		await expect(page.getByTestId('kontaktweg').getByTestId('kontaktweg-chip')).toHaveAttribute('data-weg', 'telefon');
		await expect(page.locator('.ka-bevorzugt')).toHaveText('bevorzugt');
		await page.getByText('Änderungsprotokoll der Kundendaten').click();
		await expect(page.getByText('Bevorzugter Kontaktweg: Chat → Telefon')).toBeVisible();

		// Keine Angabe: ruhiges Leer-Abzeichen
		await page.goto(`/kunden/${id}/bearbeiten`);
		await page.getByRole('radiogroup', { name: 'Bevorzugter Kontaktweg' }).getByRole('radio', { name: 'Kontaktweg: keine Angabe' }).click();
		await page.getByRole('button', { name: 'Speichern' }).click();
		await expect(page.getByTestId('kontaktweg').getByTestId('kontaktweg-chip')).toHaveText('Kontaktweg: keine Angabe');
	} finally {
		if (id) await api(page, 'DELETE', `/api/kunden/${id}`);
	}
});

test('Kontaktweg im Auftrag: immer sichtbar, direkt änderbar, gespeichert beim Kunden (Jamil msg 4337)', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const kunde = await api(page, 'POST', '/api/kunden', { art: 'privat', nachname: `E2E-KontaktAuftrag ${info.project.name} ${Date.now()}` });
	let auftragId: string | null = null;
	try {
		const auftrag = await api(page, 'POST', '/api/auftraege', { titel: 'E2E Kontaktweg', kundeId: kunde.id });
		auftragId = auftrag.id;
		await page.goto(`/auftraege/${auftragId}`);
		const bereich = page.getByTestId('auftrag-kontaktweg');
		await expect(bereich).toBeVisible();
		const wahl = bereich.getByRole('combobox', { name: 'Bevorzugter Kontaktweg' });
		await expect(wahl).toHaveValue('');
		await wahl.selectOption('chat');
		await expect.poll(async () => (await api(page, 'GET', `/api/kunden/${kunde.id}`)).bevorzugter_kontakt).toBe('chat');
		await page.reload();
		await expect(page.getByTestId('auftrag-kontaktweg').getByRole('combobox', { name: 'Bevorzugter Kontaktweg' })).toHaveValue('chat');
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		// Kundenakte zeigt dasselbe
		await page.goto(`/kunden/${kunde.id}`);
		await expect(page.getByTestId('kontaktweg').getByTestId('kontaktweg-chip')).toHaveAttribute('data-weg', 'chat');
	} finally {
		if (auftragId) await api(page, 'DELETE', `/api/auftraege/${auftragId}`);
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`);
	}
});
