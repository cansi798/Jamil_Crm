import { expect, test, type Page } from '@playwright/test';
import { bestaetigen, erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Ablauf je Auftragsquelle (Jamil msg 3703): Einstellung „gilt / überspringen“, neuer Auftrag der Quelle, Statusleiste
 * und Board lassen den übersprungenen Status aus. Legt eine Test-Quelle und einen Auftrag an und räumt sie wieder weg.
 */
nurAufTestserver(test);

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	return page.evaluate(
		async ({ methode, url, koerper }) => {
			const r = await fetch(url, { method: methode, headers: { 'content-type': 'application/json' }, body: koerper ? JSON.stringify(koerper) : undefined });
			return { status: r.status, json: await r.json().catch(() => null) };
		},
		{ methode, url, koerper }
	);
}

test('Einstellung „überspringen“ wirkt auf neuen Auftrag, Statusleiste und Board', async ({ page }, info) => {
	const mobil = info.project.name === 'mobil';
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	const name = `E2E Ablauf ${info.project.name} ${Date.now() % 100000}`;
	let auftragId: string | null = null;
	try {
		// 1. Quelle anlegen und „Angebot erstellen“ überspringen
		await page.goto('/einstellungen/quellen');
		await page.getByRole('button', { name: 'Auftragsquelle hinzufügen' }).click();
		await page.getByPlaceholder('z. B. Instagram').fill(name);
		await page.getByRole('button', { name: 'Hinzufügen' }).click();
		await expect(page.getByRole('textbox', { name: `Name ${name}` })).toBeVisible();
		const abschnitt = page.getByRole('region', { name: 'Ablauf je Auftragsquelle' });
		await abschnitt.getByLabel('Auftragsquelle für den Ablauf').selectOption({ label: name });
		const zeile = abschnitt.locator('tr[data-schritt="ohne_angebot"]');
		await expect(zeile.getByRole('radio', { name: 'gilt' })).toBeChecked();
		await zeile.getByRole('radio', { name: 'überspringen' }).check();
		await page.getByTestId('ablauf-speichern').click();
		await expect(abschnitt.getByText('Ablauf gespeichert.')).toBeVisible();
		await expect(page.locator('li', { has: page.getByRole('textbox', { name: `Name ${name}` }) }).getByTestId('quelle-uebersprungen')).toHaveText('1 Schritt übersprungen');
		await erwarteKeinQuerScrollen(page, mobil ? 390 : 1280);
		// nach dem Neuladen gespeichert
		await page.reload();
		await abschnitt.getByLabel('Auftragsquelle für den Ablauf').selectOption({ label: name });
		await expect(abschnitt.locator('tr[data-schritt="ohne_angebot"]').getByRole('radio', { name: 'überspringen' })).toBeChecked();
		await expect(abschnitt.locator('tr[data-schritt="neu"]').getByRole('radio', { name: 'gilt' })).toBeChecked();

		// 2. Neuer Auftrag dieser Quelle: beginnt bei „Anfrage“, „Angebot“ ist übersprungen, „Weiter“ geht zu „Beauftragt“
		await page.goto('/auftraege/neu');
		await page.getByRole('radio', { name: 'Ohne Kunde' }).check();
		await page.locator('input[name="titel"]').fill(name);
		await page.locator('select[name="quelleId"]').selectOption({ label: name });
		await page.getByRole('button', { name: 'Auftrag anlegen' }).click();
		await page.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/);
		auftragId = page.url().split('/').pop()!;
		if (mobil) {
			await expect(page.getByRole('combobox', { name: 'Status' })).toContainText('Angebot (übersprungen)');
			await expect(page.getByRole('button', { name: 'Weiter → Beauftragt' })).toBeVisible();
		} else {
			await expect(page.locator('.sk-leiste li.uebersprungen')).toHaveText('Angebot');
			await expect(page.getByTitle('Weiter zu „Beauftragt“')).toBeVisible();
		}

		// 3. Board: Karte in „Anfrage“; nach „Weiter“ in „Beauftragt“
		await page.goto('/auftraege?ansicht=board');
		if (mobil) await page.locator('.ab-reiter').getByRole('button', { name: /^Anfrage/ }).click();
		await expect(page.locator('[data-spalte="anfrage"] .ab-karte', { hasText: name })).toBeVisible();
		const r = await api(page, 'POST', `/api/auftraege/${auftragId}/status`, { status: 'angebot' });
		expect(r.status).toBe(200);
		expect(r.json.status).toBe('beauftragt');
		await page.reload();
		if (mobil) await page.locator('.ab-reiter').getByRole('button', { name: /^Beauftragt/ }).click();
		await expect(page.locator('[data-spalte="beauftragt"] .ab-karte', { hasText: name })).toBeVisible();
		await erwarteKeinQuerScrollen(page, mobil ? 390 : 1280);
	} finally {
		if (auftragId) {
			// zurück geht zum vorigen geltenden Status „Anfrage“ – dort darf gelöscht werden
			await api(page, 'POST', `/api/auftraege/${auftragId}/status`, { status: 'anfrage' });
			expect((await api(page, 'DELETE', `/api/auftraege/${auftragId}`)).status).toBeLessThan(300);
		}
		await page.goto('/einstellungen/quellen');
		const loeschen = page.getByRole('button', { name: `${name} löschen` });
		if (await loeschen.count()) {
			await loeschen.click();
			await bestaetigen(page);
			await expect(page.getByRole('textbox', { name: `Name ${name}` })).toHaveCount(0);
		}
	}
});
