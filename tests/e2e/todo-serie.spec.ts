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
		const f = page.locator('form.td-neu');
		await f.getByLabel('Neues To-do').fill('Heizung warten');
		await f.getByRole('checkbox', { name: /Wiederholen/ }).check();
		await f.locator('select[name="wiederholung"]').selectOption('woechentlich');
		await f.locator('input[name="intervall"]').fill('2');
		await f.getByRole('button', { name: '+ To-do' }).click();
		const karten = page.locator('.kanban-karte', { hasText: 'Heizung warten' });
		await expect(karten).toHaveCount(1);
		await expect(karten.first()).toContainText('Wiederholt sich: alle 2 Wochen');
		// abhaken → nächste Instanz entsteht automatisch
		await karten.first().getByRole('button', { name: 'Als erledigt markieren' }).click();
		await expect(karten).toHaveCount(2);
		const offen = page.locator('.kanban-spalte[data-spalte="offen"] .kanban-karte, .kanban-spalte[data-spalte="in-arbeit"] .kanban-karte', {
			hasText: 'Heizung warten'
		});
		await expect(offen).toHaveCount(1);
		// Wiederholung beenden
		await offen.getByText('Bearbeiten').click();
		await offen.getByRole('button', { name: 'Wiederholung beenden' }).click();
		await expect(page.locator('.kanban-karte', { hasText: 'Heizung warten' }).getByText('Wiederholung beendet').first()).toBeVisible();
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
	}
});
