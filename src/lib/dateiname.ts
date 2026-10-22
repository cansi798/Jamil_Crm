import { berlinTag, berlinUhrzeit, tagDeutsch } from './zeit';

/**
 * Anzeigename einer Datei (Jamil msg 3133): Fotos aus der App/Dokumentation heißen oft nur wie eine Kennung
 * („a7e7637e-9935-4924-bb59-d561c0dd5eca.JPG“). Solche Namen zeigen wir als „Foto vom 21.10.2026, 14:32“
 * (bzw. „Dokument vom …“); echte Namen bleiben unverändert. Der Download nutzt weiter den gespeicherten Namen.
 */

const KENNUNG = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,64}|IMG[_-]?\d{4,}|image|bild|foto|photo|blob)$/i;

/** Ist der Name (ohne Endung) nur eine Kennung statt eines lesbaren Namens? */
export function istKennungsName(name: string): boolean {
	const ohneEndung = name.trim().replace(/\.[A-Za-z0-9]{1,5}$/, '');
	return KENNUNG.test(ohneEndung);
}

export function anzeigeDateiname(name: string, typ: string, angelegt: string | Date): string {
	if (!istKennungsName(name)) return name;
	const d = typeof angelegt === 'string' ? new Date(angelegt) : angelegt;
	const art = typ.startsWith('image/') ? 'Foto' : typ === 'application/pdf' ? 'PDF' : 'Dokument';
	return `${art} vom ${tagDeutsch(berlinTag(d))}, ${berlinUhrzeit(d)}`;
}
