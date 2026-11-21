import { describe, expect, it } from 'vitest';
import { ausAnfrageSpeicher, mitAnfrageSpeicher } from '../../src/lib/server/anfrage-speicher';

describe('Anfrage-Speicher (Werte einmal je lesender Anfrage)', () => {
	it('lädt in einer GET-Anfrage nur einmal, auch bei gleichzeitigen Aufrufen', async () => {
		let geladen = 0;
		const laden = async () => {
			geladen++;
			return ['plantafel'];
		};
		await mitAnfrageSpeicher('GET', async () => {
			const [a, b] = await Promise.all([ausAnfrageSpeicher('x', laden), ausAnfrageSpeicher('x', laden)]);
			await ausAnfrageSpeicher('x', laden);
			expect(a).toEqual(['plantafel']);
			expect(b).toBe(a);
		});
		expect(geladen).toBe(1);
	});

	it('jede Anfrage hat ihren eigenen Speicher', async () => {
		let geladen = 0;
		const laden = async () => ++geladen;
		await mitAnfrageSpeicher('GET', () => ausAnfrageSpeicher('y', laden));
		await mitAnfrageSpeicher('GET', () => ausAnfrageSpeicher('y', laden));
		expect(geladen).toBe(2);
	});

	it('Schreibanfragen (POST) und Aufrufe außerhalb einer Anfrage lesen immer frisch', async () => {
		let geladen = 0;
		const laden = async () => ++geladen;
		await mitAnfrageSpeicher('POST', async () => {
			await ausAnfrageSpeicher('z', laden);
			await ausAnfrageSpeicher('z', laden);
		});
		await ausAnfrageSpeicher('z', laden);
		expect(geladen).toBe(3);
	});

	it('ein Fehler wird nicht gespeichert – der nächste Aufruf lädt neu', async () => {
		let versuch = 0;
		const laden = async () => {
			versuch++;
			if (versuch === 1) throw new Error('weg');
			return 'ok';
		};
		await mitAnfrageSpeicher('GET', async () => {
			await expect(ausAnfrageSpeicher('f', laden)).rejects.toThrow('weg');
			await expect(ausAnfrageSpeicher('f', laden)).resolves.toBe('ok');
		});
	});
});
