import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld } from './kunden';
import { farbeAusLogo } from './logo-farbe';
import { STANDARD_FARBE } from '../farbe';
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
	/** Erscheinungsbild Kundenportal (Migration 096, msg 2953) – leer = Standard */
	dunkelFarbe: string | null;
	hintergrundFarbe: string | null;
	titelSchrift: 'montserrat' | 'inter' | null;
	textSchrift: 'inter' | 'opensans' | null;
	/** Überschriften in Großbuchstaben: 'ja' | 'nein' (als Text, damit das Formular es wie die anderen Felder schickt) */
	titelGross: 'ja' | 'nein';
	hatLogo: boolean;
	logoTyp: string | null;
	/** Zeitpunkt des letzten Logo-Wechsels (für Cache-Brecher in der Oberfläche). */
	logoGeaendert: string | null;
	/** Zweite Variante für dunkle Hintergründe (Seitenleiste der App, msg 3014). */
	hatLogoDunkel: boolean;
	logoDunkelGeaendert: string | null;
	/** Aus dem Logo erkannte Farbe (msg 3016) und ob die Hausfarbe von Hand gewählt ist (sonst folgt sie dem Logo). */
	logoFarbe: string | null;
	farbeEigen: boolean;
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
	farbe: ['farbe', 'Farbe', 7],
	dunkelFarbe: ['dunkel_farbe', 'Dunkle Farbe', 7],
	hintergrundFarbe: ['hintergrund_farbe', 'Hintergrundfarbe', 7],
	titelSchrift: ['titel_schrift', 'Schrift für Überschriften', 20],
	textSchrift: ['text_schrift', 'Schrift für Text', 20],
	titelGross: ['titel_gross', 'Großbuchstaben', 4]
} as const;
const FARB_FELDER = new Set(['farbe', 'dunkelFarbe', 'hintergrundFarbe']);
const SCHRIFTEN: Record<string, readonly string[]> = { titelSchrift: ['montserrat', 'inter'], textSchrift: ['inter', 'opensans'] };

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
	dunkelFarbe: null,
	hintergrundFarbe: null,
	titelSchrift: null,
	textSchrift: null,
	titelGross: 'nein',
	hatLogo: false,
	logoTyp: null,
	logoGeaendert: null,
	hatLogoDunkel: false,
	logoDunkelGeaendert: null,
	logoFarbe: null,
	farbeEigen: false
};

const AUSWAHL = `firmenname, strasse, plz, ort, telefon, email, web, steuernummer, ust_id, iban, bic, bank, fusszeile, farbe,
	dunkel_farbe, hintergrund_farbe, titel_schrift, text_schrift, titel_gross,
	logo is not null as hat_logo, logo_typ, logo_geaendert, logo_dunkel is not null as hat_logo_dunkel, logo_dunkel_geaendert,
	logo_farbe, farbe_eigen`;

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
		dunkelFarbe: z.dunkel_farbe ?? null,
		hintergrundFarbe: z.hintergrund_farbe ?? null,
		titelSchrift: z.titel_schrift ?? null,
		textSchrift: z.text_schrift ?? null,
		titelGross: z.titel_gross === true ? 'ja' : 'nein',
		hatLogo: z.hat_logo === true,
		logoTyp: z.logo_typ,
		logoGeaendert: z.logo_geaendert ? new Date(z.logo_geaendert).toISOString() : null,
		hatLogoDunkel: z.hat_logo_dunkel === true,
		logoDunkelGeaendert: z.logo_dunkel_geaendert ? new Date(z.logo_dunkel_geaendert).toISOString() : null,
		logoFarbe: z.logo_farbe ?? null,
		farbeEigen: z.farbe_eigen === true
	};
}

export async function holeProfil(k: Kontext): Promise<Profil> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select ${tx.unsafe(AUSWAHL)} from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return zuProfil(z);
	});
}

/** Nur die Hausfarbe (für die App-Hülle aller Benutzer des Betriebs; keine weiteren Profildaten). */
export async function hausfarbe(k: Kontext): Promise<string | null> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`select farbe from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return (z?.farbe as string | null) ?? null;
	});
}

/** Prüft die angegebenen Felder (unbekannte Felder → 400) und liefert Spalte → Wert. */
export function pruefeProfilEingabe(e: Record<string, unknown>): Record<string, string | boolean | null> {
	const unbekannt = Object.keys(e).filter((f) => !Object.hasOwn(FELDER, f));
	if (unbekannt.length > 0) throw new ApiFehler(400, `Unbekanntes Feld: ${unbekannt[0]}`);
	const werte: Record<string, string | boolean | null> = {};
	for (const feld of PROFIL_FELDER) {
		if (!Object.hasOwn(e, feld)) continue;
		const [spalte, beschriftung, max] = FELDER[feld];
		if (feld === 'titelGross') {
			werte[spalte] = e[feld] === true || e[feld] === 'ja';
			continue;
		}
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
		if (w !== null && SCHRIFTEN[feld] && !SCHRIFTEN[feld].includes(w)) throw new ApiFehler(400, `${beschriftung}: unbekannte Schrift.`);
		if (w !== null && FARB_FELDER.has(feld)) {
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
		// Hausfarbe: nur eine wirklich geänderte Farbe gilt als „von Hand gewählt“ (msg 3016). Der Farbwähler schickt
		// immer einen Wert – ohne Farbe den Standard (Gold); das ist keine Änderung.
		if ('farbe' in werte) {
			const [alt] = await tx`select farbe from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
			const bisher = (alt?.farbe as string | null) ?? null;
			if (werte.farbe === bisher || (bisher === null && werte.farbe === STANDARD_FARBE)) delete werte.farbe;
			else werte.farbe_eigen = true;
		}
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
 * Logo-Varianten: „briefkopf“ = das Logo für PDFs, Portal und helle Flächen (dunkel auf hell); „dunkel“ = optionale
 * zweite Variante für dunkle Hintergründe (Seitenleiste der App, msg 3014). Spaltennamen nur aus dieser festen Liste.
 */
export type LogoVariante = 'briefkopf' | 'dunkel';
const LOGO_SPALTEN: Record<LogoVariante, { bytes: string; typ: string; geaendert: string }> = {
	briefkopf: { bytes: 'logo', typ: 'logo_typ', geaendert: 'logo_geaendert' },
	dunkel: { bytes: 'logo_dunkel', typ: 'logo_dunkel_typ', geaendert: 'logo_dunkel_geaendert' }
};

/**
 * Prüft und speichert das Logo: PNG oder JPEG (erkannt an den Bytes, nicht an Dateiname oder Typ-Angabe; vollständig
 * geprüft mit `pruefeBild`, damit kaputte Bilddaten nie bis zum PDF kommen), höchstens 1 MB und 1500 × 1500 Pixel. Bei einem Fehler bleibt das bisherige Logo unverändert.
 */
export async function speichereLogo(k: Kontext, bytes: Uint8Array, variante: LogoVariante = 'briefkopf'): Promise<Profil> {
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
	const s = LOGO_SPALTEN[variante];
	return mitBetrieb(k, async (tx) => {
		await tx`
			insert into app.betrieb_profil (betrieb_id, ${tx.unsafe(s.bytes)}, ${tx.unsafe(s.typ)}, ${tx.unsafe(s.geaendert)})
			values (${k.betriebId}, ${daten}, ${info.typ}, clock_timestamp())
			on conflict (betrieb_id) do update
				set ${tx.unsafe(s.bytes)} = excluded.${tx.unsafe(s.bytes)}, ${tx.unsafe(s.typ)} = excluded.${tx.unsafe(s.typ)},
					${tx.unsafe(s.geaendert)} = excluded.${tx.unsafe(s.geaendert)}`;
		// Akzentfarbe aus dem Logo (msg 3016): das Briefkopf-Logo bestimmt sie; die helle Variante nur, solange es
		// keine gibt. Ist die Hausfarbe nicht von Hand gewählt, folgt sie automatisch.
		const erkannt = farbeAusLogo(bytes);
		if (variante === 'briefkopf') await tx`update app.betrieb_profil set logo_farbe = ${erkannt} where betrieb_id = ${k.betriebId}`;
		else if (erkannt) await tx`update app.betrieb_profil set logo_farbe = coalesce(logo_farbe, ${erkannt}) where betrieb_id = ${k.betriebId}`;
		await folgeLogoFarbe(tx, k);
		const [z] = await tx`select ${tx.unsafe(AUSWAHL)} from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return zuProfil(z);
	});
}

export async function holeLogo(k: Kontext, variante: LogoVariante = 'briefkopf'): Promise<{ bytes: Uint8Array; typ: string } | null> {
	const s = LOGO_SPALTEN[variante];
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select ${tx.unsafe(s.bytes)} as logo, ${tx.unsafe(s.typ)} as logo_typ from app.betrieb_profil
			where betrieb_id = ${k.betriebId} and ${tx.unsafe(s.bytes)} is not null`;
		if (!z) return null;
		const buf = z.logo as Buffer;
		return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), typ: z.logo_typ };
	});
}

export async function loescheLogo(k: Kontext, variante: LogoVariante = 'briefkopf'): Promise<Profil> {
	const s = LOGO_SPALTEN[variante];
	return mitBetrieb(k, async (tx) => {
		await tx`
			update app.betrieb_profil set ${tx.unsafe(s.bytes)} = null, ${tx.unsafe(s.typ)} = null, ${tx.unsafe(s.geaendert)} = clock_timestamp()
			where betrieb_id = ${k.betriebId} and ${tx.unsafe(s.bytes)} is not null`;
		// ohne jedes Logo keine Logo-Farbe mehr (dann Standard, solange nicht von Hand gewählt)
		await tx`update app.betrieb_profil set logo_farbe = null where betrieb_id = ${k.betriebId} and logo is null and logo_dunkel is null`;
		await folgeLogoFarbe(tx, k);
		const [z] = await tx`select ${tx.unsafe(AUSWAHL)} from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return zuProfil(z);
	});
}

/** Hausfarbe folgt der Logo-Farbe, solange sie nicht von Hand gewählt ist. */
async function folgeLogoFarbe(tx: TransactionSql, k: Kontext): Promise<void> {
	await tx`update app.betrieb_profil set farbe = logo_farbe where betrieb_id = ${k.betriebId} and not farbe_eigen and farbe is distinct from logo_farbe`;
}

/**
 * Hausfarbe (msg 3016): `logo` = wieder der Logo-Farbe folgen, `standard` = Standard-Theme (Gold), sonst eine eigene
 * Farbe (#rrggbb, Farbwähler).
 */
export async function setzeHausfarbe(k: Kontext, wahl: unknown): Promise<Profil> {
	if (wahl !== 'logo' && wahl !== 'standard' && !(typeof wahl === 'string' && /^#[0-9a-fA-F]{6}$/.test(wahl))) {
		throw new ApiFehler(400, 'Bitte eine Farbe wählen.');
	}
	return mitBetrieb(k, async (tx) => {
		await tx`insert into app.betrieb_profil (betrieb_id) values (${k.betriebId}) on conflict (betrieb_id) do nothing`;
		if (wahl === 'logo') await tx`update app.betrieb_profil set farbe_eigen = false where betrieb_id = ${k.betriebId}`;
		else await tx`update app.betrieb_profil set farbe_eigen = true, farbe = ${wahl === 'standard' ? null : (wahl as string).toLowerCase()} where betrieb_id = ${k.betriebId}`;
		await folgeLogoFarbe(tx, k);
		const [z] = await tx`select ${tx.unsafe(AUSWAHL)} from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return zuProfil(z);
	});
}

/**
 * Logos für die App-Marke oben links (msg 3014): welche Varianten es gibt und wann sie zuletzt geändert wurden
 * (Cache-Brecher). Für jeden angemeldeten Benutzer des Betriebs – ein Logo ist nicht vertraulich.
 */
export async function markenLogos(k: Kontext): Promise<{ hell: string | null; dunkel: string | null; name: string | null }> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select firmenname, case when logo is not null then coalesce(logo_geaendert, now())::text end as hell,
				case when logo_dunkel is not null then coalesce(logo_dunkel_geaendert, now())::text end as dunkel
			from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return { hell: z?.hell ?? null, dunkel: z?.dunkel ?? null, name: z?.firmenname ?? null };
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
