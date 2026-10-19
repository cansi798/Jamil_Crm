import { berlinTag, berlinUhrzeit, tagKurz } from './zeit';

/** Art eines Termins (Einsatz) im Auftrag – Wunsch Jamil (19.10.2026); Migration 024. */
export const EINSATZ_ARTEN = ['besichtigung', 'montage', 'wartung'] as const;
export type EinsatzArt = (typeof EINSATZ_ARTEN)[number];

export const EINSATZ_ART_NAMEN: Record<EinsatzArt, string> = {
	besichtigung: 'Besichtigung',
	montage: 'Montage',
	wartung: 'Wartung'
};

export const istEinsatzArt = (w: unknown): w is EinsatzArt =>
	typeof w === 'string' && (EINSATZ_ARTEN as readonly string[]).includes(w);

/** „Besichtigung · Di 21.10., 09:00“ – nächster Termin eines Auftrags (statt des früheren „Geplant ab“). */
export function terminKurz(t: { beginn: string; art: string }): string {
	const d = new Date(t.beginn);
	const art = istEinsatzArt(t.art) ? EINSATZ_ART_NAMEN[t.art] : 'Termin';
	return `${art} · ${tagKurz(berlinTag(d))}, ${berlinUhrzeit(d)}`;
}
