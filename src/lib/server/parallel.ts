/**
 * Wartet auf alle Werte eines Objekts gleichzeitig (wie `Promise.all`, aber mit Namen statt Positionen):
 *   const { a, b } = await parallel({ a: ladeA(), b: bedingung ? ladeB() : null });
 * Für `load`-Funktionen mit vielen unabhängigen Abfragen – nacheinander addieren sich die Wartezeiten.
 */
export async function parallel<T extends Record<string, unknown>>(o: T): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
	const schluessel = Object.keys(o);
	const werte = await Promise.all(schluessel.map((s) => o[s]));
	return Object.fromEntries(schluessel.map((s, i) => [s, werte[i]])) as { [K in keyof T]: Awaited<T[K]> };
}
