import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';

/** Wiederkehrende To-dos (Wunsch Jamil, msg 2501): im Auftrag anlegen, abhaken → nächstes erscheint, beenden. */
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

test('Wartung als wiederkehrendes To-do: anlegen, abhaken → nächstes, Wiederholung beenden', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const kunden = await api(page, 'GET', '/api/kunden');
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `E2E Serie ${info.project.name} ${Date.now()}`, kundeId: kunden[0].id });
	try {
		await page.goto(`/auftraege/${auftrag.id}`);
		// eingeklappt, bis man „+ To-do hinzufügen“ drückt (msg 2579)
		await expect(page.locator('form.td-neu')).toHaveCount(0);
		await page.getByRole('button', { name: 'To-do hinzufügen' }).click();
		const f = page.locator('form.td-neu');
		await f.getByLabel('Neues To-do').fill('Heizung warten');
		const haken = f.getByRole('checkbox', { name: /Wiederkehrend/ });
		// normale Größe, nicht als riesiges Kästchen gestreckt (Jamil msg 2557)
		const box = (await haken.boundingBox())!;
		expect(box.width).toBeLessThan(30);
		expect(box.height).toBeLessThan(30);
		// Beschriftung neben dem Häkchen in einer Zeile, nicht Buchstabe für Buchstabe umbrochen (msg 2559)
		const zeile = (await f.locator('label.kd-haken').boundingBox())!;
		expect(zeile.height).toBeLessThan(60);
		expect(zeile.width).toBeGreaterThan(200);
		await haken.check();
		await f.locator('select[name="wiederholung"]').selectOption('woechentlich');
		await f.locator('input[name="intervall"]').fill('2');
		await f.getByRole('button', { name: 'To-do speichern' }).click();
		// nach dem Speichern wieder zu
		await expect(page.locator('form.td-neu')).toHaveCount(0);
		const offen = page.getByRole('list', { name: 'Offene To-dos' }).locator('.tl-zeile', { hasText: 'Heizung warten' });
		await expect(offen).toHaveCount(1);
		await expect(offen).toContainText('alle 2 Wochen');
		// abhaken → nächste Instanz entsteht automatisch; die erledigte steht eingeklappt unten
		await offen.getByRole('checkbox', { name: '„Heizung warten“ erledigt' }).check();
		await expect(page.getByRole('button', { name: /1 erledigt anzeigen/ })).toBeVisible();
		await expect(offen).toHaveCount(1);
		// Wiederholung beenden (Zeile aufklappen)
		await offen.locator('.tl-titel').click();
		await offen.getByRole('button', { name: 'Wiederholung beenden' }).click();
		await expect(offen.getByText('Wiederholung beendet')).toBeVisible();
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
	}
});
