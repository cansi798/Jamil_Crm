import { describe, expect, it } from 'vitest';
import { GET } from '../../src/routes/api/gesundheit/+server';

describe('GET /api/gesundheit', () => {
	it('liefert 200 und { ok: true }', async () => {
		const antwort = await GET({} as Parameters<typeof GET>[0]);
		expect(antwort.status).toBe(200);
		expect(await antwort.json()).toEqual({ ok: true });
	});
});
