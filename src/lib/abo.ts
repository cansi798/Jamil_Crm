/**
 * Abo-Status eines Betriebs (wie der Check in `app.betriebe.abo_status`) mit deutschen Namen – ohne Serverbezug,
 * darf auch in Oberflächen-Komponenten genutzt werden.
 */
export const ABO_STATUS = ['test', 'aktiv', 'ueberfaellig', 'gekuendigt', 'gesperrt'] as const;

export type AboStatus = (typeof ABO_STATUS)[number];

export const ABO_STATUS_NAMEN: Record<AboStatus, string> = {
	test: 'Test',
	aktiv: 'Aktiv',
	ueberfaellig: 'Überfällig',
	gekuendigt: 'Gekündigt',
	gesperrt: 'Gesperrt'
};

export const istAboStatus = (wert: unknown): wert is AboStatus =>
	typeof wert === 'string' && (ABO_STATUS as readonly string[]).includes(wert);
