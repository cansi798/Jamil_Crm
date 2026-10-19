/** Stufen für „Lautstärke“ und „Schmutz“ je To-do (Wunsch Jamil, msg 2486: nur 3 Stufen). */
export const STUFEN = [1, 2, 3] as const;
export type Stufe = (typeof STUFEN)[number];

export const STUFE_NAMEN: Record<Stufe, string> = { 1: 'gering', 2: 'mittel', 3: 'hoch' };

/** „gering“, „mittel“, „hoch“ – oder null. */
export const stufeName = (n: number | null | undefined): string | null =>
	n === 1 || n === 2 || n === 3 ? STUFE_NAMEN[n] : null;
