/**
 * Statuskette der Aufträge – ohne Serverbezug, damit Oberfläche und Server dieselbe Liste benutzen.
 * Reihenfolge und Beschriftungen sind fest (Pflichtenheft Abschnitt 6): Anfrage → Angebot → Beauftragt → In Arbeit →
 * Abgenommen → Abgerechnet. Ein Wechsel geht immer nur einen Schritt vor oder zurück.
 */

export const STATUS = ['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet'] as const;

export type AuftragStatus = (typeof STATUS)[number];

export const STATUS_NAMEN: Record<AuftragStatus, string> = {
	anfrage: 'Anfrage',
	angebot: 'Angebot',
	beauftragt: 'Beauftragt',
	in_arbeit: 'In Arbeit',
	abgenommen: 'Abgenommen',
	abgerechnet: 'Abgerechnet'
};

export function istStatus(w: unknown): w is AuftragStatus {
	return typeof w === 'string' && (STATUS as readonly string[]).includes(w);
}

/** Nur ein Schritt vor oder zurück; „bleibt gleich“ ist kein Wechsel. */
export function erlaubterWechsel(von: AuftragStatus, nach: AuftragStatus): boolean {
	return Math.abs(STATUS.indexOf(von) - STATUS.indexOf(nach)) === 1;
}

/** Nächster bzw. vorheriger Status (oder `null` am Ende der Kette). */
export function naechsterStatus(s: AuftragStatus): AuftragStatus | null {
	return STATUS[STATUS.indexOf(s) + 1] ?? null;
}
export function vorigerStatus(s: AuftragStatus): AuftragStatus | null {
	const i = STATUS.indexOf(s);
	return i > 0 ? STATUS[i - 1] : null;
}
