import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { textFeld } from './kunden';
import { pruefeBild } from './bildpruefung';

/**
 * Briefkopf (Betriebsprofil) und Logo eines Betriebs – eine Zeile `app.betrieb_profil` je Betrieb (RLS). Das Logo
 * liegt als `bytea` in der Datenbank (nicht im Dateisystem) und wird nie mit dem Profil ausgeliefert, nur über
 * `holeLogo`. Rechteprüfung machen die Aufrufer (`einstellungen`; Logo lesen auch mit `angebote.bearbeiten`).
 */

export type Profil = {
	firmenname: string | null;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
	telefon: string | null;
	email: string | null;
	web: string | null;
	steuernummer: string | null;
	ustId: string | null;
	iban: string | null;
	bic: string | null;
	bank: string | null;
	fusszeile: string | null;
	/** Hausfarbe (#rrggbb), z. B. für die Online-Buchungsseite */
	farbe: string | null;
	hatLogo: boolean;
	logoTyp: string | null;
	/** Zeitpunkt des letzten Logo-Wechsels (für Cache-Brecher in der Oberfläche). */
	logoGeaendert: string | null;
};

/** Feld → [Spalte, Beschriftung, höchste Länge] – entspricht den Check-Constraints in Migration 013. */
const FELDER = {
	firmenname: ['firmenname', 'Firmenname', 200],
	strasse: ['strasse', 'Straße', 200],
	plz: ['plz', 'PLZ', 20],
	ort: ['ort', 'Ort', 200],
	telefon: ['telefon', 'Telefon', 50],
	email: ['email', 'E-Mail', 200],
	web: ['web', 'Internetseite', 200],
	steuernummer: ['steuernummer', 'Steuernummer', 50],
	ustId: ['ust_id', 'USt-IdNr.', 20],
	iban: ['iban', 'IBAN', 42],
	bic: ['bic', 'BIC', 11],
	bank: ['bank', 'Bank', 200],
	fusszeile: ['fusszeile', 'Fußzeile', 500],
	farbe: ['farbe', 'Farbe', 7]
} as const;

export type ProfilFeld = keyof typeof FELDER;
export const PROFIL_FELDER = Object.keys(FELDER) as ProfilFeld[];

export const LOGO_MAX_BYTES = 1_048_576;
export const LOGO_MAX_PX = 1500;
const LOGO_MELDUNG = 'Bitte ein PNG- oder JPEG-Bild bis 1 MB hochladen';

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
const BIC = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

const LEER: Profil = {
	firmenname: null,
	strasse: null,
	plz: null,
	ort: null,
	telefon: null,
	email: null,
	web: null,
	steuernummer: null,
	ustId: null,
	iban: null,
	bic: null,
	bank: null,
	fusszeile: null,
	farbe: null,
	hatLogo: false,
	logoTyp: null,
	logoGeaendert: null
};

const AUSWAHL = `firmenname, strasse, plz, ort, telefon, email, web, steuernummer, ust_id, iban, bic, bank, fusszeile, farbe,
	logo is not null as hat_logo, logo_typ, logo_geaendert`;

function zuProfil(z: Record<string, any> | undefined): Profil {
	if (!z) return { ...LEER };
	return {
		firmenname: z.firmenname,
		strasse: z.strasse,
		plz: z.plz,
		ort: z.ort,
		telefon: z.telefon,
		email: z.email,
		web: z.web,
		steuernummer: z.steuernummer,
		ustId: z.ust_id,
		iban: z.iban,
		bic: z.bic,
		bank: z.bank,
		fusszeile: z.fusszeile,
		farbe: z.farbe ?? null,
		hatLogo: z.hat_logo === true,
		logoTyp: z.logo_typ,
		logoGeaendert: z.logo_geaendert ? new Date(z.logo_geaendert).toISOString() : null
	};
}

export async function holeProfil(k: Kontext): Promise<Profil> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select ${tx.unsafe(AUSWAHL)} from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return zuProfil(z);
	});
}

/** Prüft die angegebenen Felder (unbekannte Felder → 400) und liefert Spalte → Wert. */
export function pruefeProfilEingabe(e: Record<string, unknown>): Record<string, string | null> {
	const unbekannt = Object.keys(e).filter((f) => !Object.hasOwn(FELDER, f));
	if (unbekannt.length > 0) throw new ApiFehler(400, `Unbekanntes Feld: ${unbekannt[0]}`);
	const werte: Record<string, string | null> = {};
	for (const feld of PROFIL_FELDER) {
		if (!Object.hasOwn(e, feld)) continue;
		const [spalte, beschriftung, max] = FELDER[feld];
		let w = textFeld(e[feld], beschriftung, max);
		if (w !== null && feld === 'email' && !EMAIL.test(w)) throw new ApiFehler(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
		if (w !== null && feld === 'iban') {
			w = w.replace(/\s+/g, '').toUpperCase();
			if (!IBAN.test(w)) throw new ApiFehler(400, 'Bitte eine gültige IBAN eingeben (15 bis 34 Zeichen).');
		}
		if (w !== null && feld === 'bic') {
			w = w.replace(/\s+/g, '').toUpperCase();
			if (!BIC.test(w)) throw new ApiFehler(400, 'Bitte eine gültige BIC eingeben (8 oder 11 Zeichen).');
		}
		if (w !== null && feld === 'farbe') {
			w = w.toLowerCase();
			if (!/^#[0-9a-f]{6}$/.test(w)) throw new ApiFehler(400, 'Bitte eine Farbe wählen.');
		}
		werte[spalte] = w;
	}
	return werte;
}

/** Speichert die angegebenen Felder (fehlende bleiben, leere werden null) und liefert das ganze Profil. */
export async function speichereProfil(k: Kontext, e: Record<string, unknown>): Promise<Profil> {
	const werte = pruefeProfilEingabe(e);
	return mitBetrieb(k, async (tx) => {
		const spalten = Object.keys(werte);
		if (spalten.length > 0) {
			await tx`
				insert into app.betrieb_profil ${tx({ betrieb_id: k.betriebId, ...werte })}
				on conflict (betrieb_id) do update set ${tx(werte, ...spalten)}`;
		}
		const [z] = await tx`select ${tx.unsafe(AUSWAHL)} from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return zuProfil(z);
	});
}

/**
 * Prüft und speichert das Logo: PNG oder JPEG (erkannt an den Bytes, nicht an Dateiname oder Typ-Angabe; vollständig
 * geprüft mit `pruefeBild`, damit kaputte Bilddaten nie bis zum PDF kommen), höchstens 1 MB und 1500 × 1500 Pixel. Bei einem Fehler bleibt das bisherige Logo unverändert.
 */
export async function speichereLogo(k: Kontext, bytes: Uint8Array): Promise<Profil> {
	if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) {
		throw new ApiFehler(400, LOGO_MELDUNG);
	}
	const info = pruefeBild(bytes);
	if (!info || info.breite < 1 || info.hoehe < 1) throw new ApiFehler(400, LOGO_MELDUNG);
	if (info.breite > LOGO_MAX_PX || info.hoehe > LOGO_MAX_PX) {
		throw new ApiFehler(
			400,
			`Das Logo ist ${info.breite} × ${info.hoehe} Pixel groß – höchstens ${LOGO_MAX_PX} × ${LOGO_MAX_PX} Pixel.`
		);
	}
	const daten = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return mitBetrieb(k, async (tx) => {
		await tx`
			insert into app.betrieb_profil (betrieb_id, logo, logo_typ, logo_geaendert)
			values (${k.betriebId}, ${daten}, ${info.typ}, clock_timestamp())
			on conflict (betrieb_id) do update
				set logo = excluded.logo, logo_typ = excluded.logo_typ, logo_geaendert = excluded.logo_geaendert`;
		const [z] = await tx`select ${tx.unsafe(AUSWAHL)} from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return zuProfil(z);
	});
}

export async function holeLogo(k: Kontext): Promise<{ bytes: Uint8Array; typ: string } | null> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select logo, logo_typ from app.betrieb_profil where betrieb_id = ${k.betriebId} and logo is not null`;
		if (!z) return null;
		const buf = z.logo as Buffer;
		return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), typ: z.logo_typ };
	});
}

export async function loescheLogo(k: Kontext): Promise<Profil> {
	return mitBetrieb(k, async (tx) => {
		await tx`
			update app.betrieb_profil set logo = null, logo_typ = null, logo_geaendert = clock_timestamp()
			where betrieb_id = ${k.betriebId} and logo is not null`;
		const [z] = await tx`select ${tx.unsafe(AUSWAHL)} from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return zuProfil(z);
	});
}

/** Liest die Logo-Datei aus einer Anfrage: Formular (Feld `logo`) oder rohe Bytes. Zu große Anfragen → 400. */
export async function leseLogoAusAnfrage(request: Request): Promise<Uint8Array> {
	const laenge = Number(request.headers.get('content-length') ?? '0');
	if (laenge > LOGO_MAX_BYTES + 64 * 1024) throw new ApiFehler(400, LOGO_MELDUNG);
	const typ = request.headers.get('content-type') ?? '';
	if (/^multipart\/form-data/i.test(typ)) {
		let datei: FormDataEntryValue | null;
		try {
			datei = (await request.formData()).get('logo');
		} catch {
			throw new ApiFehler(400, LOGO_MELDUNG);
		}
		if (!datei || typeof datei === 'string') throw new ApiFehler(400, LOGO_MELDUNG);
		return dateiBytes(datei);
	}
	return new Uint8Array(await request.arrayBuffer());
}

export async function dateiBytes(datei: File): Promise<Uint8Array> {
	if (datei.size > LOGO_MAX_BYTES) throw new ApiFehler(400, LOGO_MELDUNG);
	return new Uint8Array(await datei.arrayBuffer());
}
