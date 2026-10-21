import type { TestType } from '@playwright/test';

/**
 * Wohin laufen die Browser-Tests? Standard ist ein EIGENER lokaler Testserver mit eigener Datenbank
 * (`scripts/start-testserver.sh`, Port 8310) – nie die Vorschau, die Jamil und Can benutzen (Jamil msgs 3075/3076:
 * liegengebliebene „E2E …“-Testdaten). Anderes Ziel: `BASE_URL=…`.
 */
export const STANDARD_ZIEL = 'http://127.0.0.1:8310';

export const basisUrl = (env: Record<string, string | undefined> = process.env): string => env.BASE_URL || STANDARD_ZIEL;

/** Die Vorschau: öffentlich crm.waybuild-software.de, auf dem Server 127.0.0.1:8300. */
export function istVorschau(url: string): boolean {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return false;
	}
	if (u.hostname === 'crm.waybuild-software.de' || u.hostname.endsWith('.crm.waybuild-software.de')) return true;
	return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && u.port === '8300';
}

/** Grund, warum ein schreibender Test nicht laufen darf – oder `null`. Erzwingen nur mit `CRM_E2E_VORSCHAU=1`. */
export function vorschauSperre(env: Record<string, string | undefined> = process.env): string | null {
	if (!istVorschau(basisUrl(env)) || env.CRM_E2E_VORSCHAU === '1') return null;
	return (
		`Dieser Test legt Buchungen, Kundenportal-Links oder Testkunden an und läuft deshalb nicht gegen die Vorschau (${basisUrl(env)}). ` +
		'Eigenen Testserver starten (scripts/start-testserver.sh) – oder ausnahmsweise CRM_E2E_VORSCHAU=1 setzen.'
	);
}

/** Am Anfang einer schreibenden Spec-Datei aufrufen: überspringt alle Tests der Datei gegen die Vorschau. */
export function nurAufTestserver(test: TestType<any, any>): void {
	const grund = vorschauSperre();
	test.skip(grund !== null, grund ?? '');
}
