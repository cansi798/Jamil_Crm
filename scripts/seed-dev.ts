import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import * as OTPAuth from 'otpauth';
import { ladeEnv, urlAusUmgebung } from './migrate';
import { hashePasswort, pruefePasswort } from '../src/lib/server/auth/passwort';
import { VORLAGEN, VORLAGEN_NAMEN, type Vorlage } from '../src/lib/server/rechte';
import { totpUri } from '../src/lib/server/auth/totp';
import { berlinTag, berlinZeitpunkt, tagPlus, wocheVon } from '../src/lib/zeit';
import { GUELTIG_TAGE, STANDARD_EINLEITUNG, STANDARD_SCHLUSS } from '../src/lib/server/angebote';

/**
 * Entwicklungsdaten (nur für die lokale Sandbox, nie für Produktion): Betrieb „Bauwelt“ (Tarif test) mit den
 * drei Rollen aus den Vorlagen, je ein Benutzer Chef/Büro/Monteur, ein Plattform-Admin und 5 Beispielkunden; dazu
 * (Stufe 1b) 6 Beispielaufträge über alle Status, To-dos, Einsätze in dieser und der nächsten Woche (mit einer
 * Doppelbelegung und einem Urlaub) und „heute“-Einsätze für jeden Monteur – auch die persönlichen Test-Zugänge;
 * (Stufe 1c) Briefkopf mit Bauwelt-Logo, Startvorlagen Bad/Sanitär und Fliesen mit Beispielpreisen, zwei Angebote.
 *
 * Idempotent: Was es schon gibt (Betrieb nach Name, Rolle nach Vorlage, Benutzer nach E-Mail, Kunde nach Name),
 * wird nicht noch einmal angelegt und nicht verändert. Passwörter sind zufällig und stehen nur in der Datei
 * `.zugangsdaten-dev` (gitignored, Modus 600) – nie in der Ausgabe. Ein schon notiertes Passwort bleibt beim
 * nächsten Lauf gleich (passt der Hash nicht mehr dazu, wird er wieder auf das notierte Passwort gesetzt); fehlt es
 * in der Datei, bekommt der Benutzer ein neues.
 *
 * Läuft als Superuser `crm` (wie Migrationen): `crm_app` darf keine Benutzer anlegen (Carry T9).
 *
 * Zwei-Faktor: Der Chef richtet sie bei der ersten Anmeldung selbst ein (Pflicht wegen Recht „einstellungen“).
 * Für den Plattform-Admin legt der Seed das TOTP-Geheimnis gleich fest und notiert es (samt otpauth-URI für die
 * Authenticator-App) in der Zugangsdatei – so kann sich das Team als Admin anmelden und der E2E-Test mit einem
 * echten Code arbeiten. Ein Code ist trotzdem bei jeder Admin-Anmeldung nötig.
 *
 * Aufruf: `npm run seed:dev` (im Container crm-dev). Läuft nur gegen die Sandbox-Datenbank `crm` und nie mit
 * NODE_ENV=production (siehe `pruefeSandbox`).
 */

export const STANDARD_DATEI = fileURLToPath(new URL('../.zugangsdaten-dev', import.meta.url));

const BETRIEB = 'Bauwelt';

const BENUTZER: { email: string; name: string; vorlage: Vorlage }[] = [
	{ email: 'chef@bauwelt.test', name: 'Jürgen Weiß', vorlage: 'chef' },
	{ email: 'buero@bauwelt.test', name: 'Sabine Schäfer', vorlage: 'buero' },
	{ email: 'monteur@bauwelt.test', name: 'Murat Öztürk', vorlage: 'monteur' }
];
const ADMIN = { email: 'admin@crm.test', name: 'Plattform-Admin' };

type Kunde = {
	art: 'privat' | 'firma';
	firma?: string;
	anrede?: string;
	vorname?: string;
	nachname?: string;
	email?: string;
	telefon?: string;
	strasse?: string;
	plz?: string;
	ort?: string;
	notiz?: string;
};

const KUNDEN: Kunde[] = [
	{
		art: 'privat',
		anrede: 'Herr',
		vorname: 'Jörg',
		nachname: 'Größer',
		telefon: '089 1234567',
		strasse: 'Hauptstraße 5',
		plz: '80331',
		ort: 'München'
	},
	{
		art: 'privat',
		anrede: 'Frau',
		vorname: 'Ursula',
		nachname: 'Weißenböck',
		email: 'ursula.weissenboeck@example.org',
		strasse: 'Königsweg 12',
		plz: '90402',
		ort: 'Nürnberg',
		notiz: 'Schlüssel liegt bei der Nachbarin (Erdgeschoss links).'
	},
	{
		art: 'firma',
		firma: 'Bäckerei Krümel GmbH',
		vorname: 'Özlem',
		nachname: 'Yılmaz',
		telefon: '0221 987654',
		strasse: 'Domstraße 3',
		plz: '50668',
		ort: 'Köln'
	},
	{
		art: 'firma',
		firma: 'Gärtnerei Grünfeld',
		email: 'info@gaertnerei-gruenfeld.example',
		strasse: 'Am Rübenacker 7',
		plz: '40210',
		ort: 'Düsseldorf'
	},
	{
		art: 'privat',
		anrede: 'Herr',
		vorname: 'Björn',
		nachname: 'Schröder',
		telefon: '0451 445566',
		strasse: 'Fischergrube 21',
		plz: '23552',
		ort: 'Lübeck'
	}
];

/** Liest die Zugangsdatei (Schlüssel TAB Wert je Zeile, # = Kommentar). Fehlt sie, ist das Ergebnis leer. */
export function leseZugangsdaten(datei: string): Map<string, string> {
	const daten = new Map<string, string>();
	if (!existsSync(datei)) return daten;
	for (const zeile of readFileSync(datei, 'utf8').split('\n')) {
		if (zeile.startsWith('#') || !zeile.includes('\t')) continue;
		const [schluessel, ...rest] = zeile.split('\t');
		daten.set(schluessel.trim(), rest.join('\t').trim());
	}
	return daten;
}

function schreibeZugangsdaten(datei: string, daten: Map<string, string>): void {
	const kopf = [
		'# Zugangsdaten der lokalen Entwicklungsumgebung (CRM System) – nicht weitergeben, nicht committen.',
		'# Erzeugt von scripts/seed-dev.ts. Format: Schlüssel<TAB>Wert. Vorschau: http://127.0.0.1:8300',
		'# chef@bauwelt.test richtet die Zwei-Faktor-Anmeldung bei der ersten Anmeldung ein.',
		'# admin@crm.test: Code aus dem Geheimnis „totp:admin@crm.test“ (otpauth-URI für die Authenticator-App).'
	];
	const zeilen = [...daten].map(([k, v]) => `${k}\t${v}`);
	writeFileSync(datei, [...kopf, ...zeilen, ''].join('\n'), { mode: 0o600 });
	chmodSync(datei, 0o600); // bestehende Datei behält sonst ihren alten Modus
}

const neuesPasswort = () => randomBytes(15).toString('base64url'); // 20 Zeichen

type Tx = postgres.TransactionSql;

/** Benutzer anlegen bzw. Passwort nachziehen, wenn es nicht (mehr) in der Datei steht. Liefert die ID. */
async function sichereBenutzer(
	tx: Tx,
	daten: Map<string, string>,
	b: { email: string; name: string; betriebId: string | null; rolleId: string | null }
): Promise<{ id: string; neu: boolean }> {
	const [vorhanden] = await tx<{ id: string; passwort_hash: string }[]>`
		select id, passwort_hash from app.benutzer where email = ${b.email}`;
	const notiert = daten.get(b.email);
	if (vorhanden && notiert && (await pruefePasswort(vorhanden.passwort_hash, notiert))) {
		return { id: vorhanden.id, neu: false };
	}
	// Neu, oder notiertes Passwort fehlt bzw. passt nicht mehr (z. B. in der Oberfläche geändert): Datei gilt.
	const passwort = notiert ?? neuesPasswort();
	const hash = await hashePasswort(passwort);
	daten.set(b.email, passwort);
	if (vorhanden) {
		await tx`update app.benutzer set passwort_hash = ${hash} where id = ${vorhanden.id}`;
		return { id: vorhanden.id, neu: false };
	}
	const [z] = await tx<{ id: string }[]>`
		insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
		values (${b.betriebId}, ${b.email}, ${b.name}, ${hash}, ${b.rolleId})
		returning id`;
	return { id: z.id, neu: true };
}

export type SeedErgebnis = { neueBenutzer: number; neueKunden: number; neueVorlagen: number } & Planung & Angebote1c;

type Angebote1c = { neueKatalogpositionen: number; neueAngebote: number };

type Planung = { neueAuftraege: number; neueTodos: number; neueEinsaetze: number };

/** Beispielaufträge (Reihenfolge = Nummer A-<Jahr>-0001 …), je Status einer. Kunde über den Nachnamen bzw. die Firma. */
const AUFTRAEGE: { titel: string; kunde: string; status: string; beschreibung?: string }[] = [
	{ titel: 'Badsanierung', kunde: 'Größer', status: 'in_arbeit', beschreibung: 'Wanne raus, bodengleiche Dusche, neue Fliesen.' },
	{ titel: 'Fliesen Küche', kunde: 'Weißenböck', status: 'beauftragt', beschreibung: 'Fliesenspiegel und Boden, ca. 18 m².' },
	{ titel: 'Ladenumbau Trockenbau', kunde: 'Bäckerei Krümel GmbH', status: 'angebot' },
	{ titel: 'Gewächshaus Fundament', kunde: 'Gärtnerei Grünfeld', status: 'anfrage' },
	{ titel: 'Malerarbeiten Treppenhaus', kunde: 'Schröder', status: 'abgenommen' },
	{ titel: 'Dachrinne erneuern', kunde: 'Größer', status: 'abgerechnet' }
];

/**
 * Einsätze relativ zu „heute“ (Berlin): `tag` 'heute' | 'morgen' | Wochentag 0–6 dieser Woche | 7–13 nächster Woche.
 * Erkannt werden sie an Mitarbeiter + Notiz; bei einem späteren Lauf wandern sie auf die neuen Tage (keine Duplikate).
 */
const EINSAETZE: { wer: string; auftrag: number; tag: 'heute' | 'morgen' | number; von: number; bis: number; notiz: string }[] = [
	{ wer: 'monteur@bauwelt.test', auftrag: 0, tag: 'heute', von: 7.5, bis: 12, notiz: 'Beispiel: Wanne ausbauen' },
	{ wer: 'monteur@bauwelt.test', auftrag: 1, tag: 'heute', von: 13, bis: 16, notiz: 'Beispiel: Aufmaß Küche' },
	{ wer: 'monteur@bauwelt.test', auftrag: 0, tag: 0, von: 7, bis: 15, notiz: 'Beispiel: Abbruch Bad' },
	// Doppelbelegung am Mittwoch dieser Woche (überlappt 10–12 Uhr)
	{ wer: 'monteur@bauwelt.test', auftrag: 0, tag: 2, von: 8, bis: 12, notiz: 'Beispiel: Estrich prüfen' },
	{ wer: 'monteur@bauwelt.test', auftrag: 2, tag: 2, von: 10, bis: 14, notiz: 'Beispiel: Ständerwerk Laden' },
	{ wer: 'monteur@bauwelt.test', auftrag: 1, tag: 8, von: 8, bis: 16, notiz: 'Beispiel: Fliesen Küche legen' },
	{ wer: 'chef@bauwelt.test', auftrag: 2, tag: 3, von: 9, bis: 11, notiz: 'Beispiel: Besichtigung Laden' },
	// Urlaub des Chefs Freitag bis Montag – der Einsatz am Montag der nächsten Woche wird gewarnt
	{ wer: 'chef@bauwelt.test', auftrag: 3, tag: 7, von: 8, bis: 10, notiz: 'Beispiel: Fundament besprechen' },
	{ wer: 'buero@bauwelt.test', auftrag: 2, tag: 9, von: 10, bis: 12, notiz: 'Beispiel: Angebot vor Ort erklären' }
];

/** Für jeden weiteren Monteur des Betriebs (z. B. Test-Zugänge can.monteur, jamil.monteur): heute und morgen. */
const MONTEUR_HEUTE = [
	{ auftrag: 0, tag: 'heute' as const, von: 8, bis: 12, notiz: 'Beispiel: Fliesen verlegen' },
	{ auftrag: 1, tag: 'morgen' as const, von: 7, bis: 15, notiz: 'Beispiel: Küche vorbereiten' }
];

const TODOS: { titel: string; auftrag: number | null; wer: string | null; faellig: number | null; erledigt?: boolean }[] = [
	{ titel: 'Silikon und Fugenmasse besorgen', auftrag: 0, wer: 'monteur@bauwelt.test', faellig: 1 },
	{ titel: 'Fliesen beim Händler abholen', auftrag: 1, wer: 'monteur@bauwelt.test', faellig: -1 },
	{ titel: 'Angebot nachfassen', auftrag: 2, wer: 'buero@bauwelt.test', faellig: 2 },
	{ titel: 'Termin für Besichtigung vereinbaren', auftrag: 3, wer: 'buero@bauwelt.test', faellig: null },
	{ titel: 'Schlussrechnung prüfen', auftrag: 4, wer: 'chef@bauwelt.test', faellig: -3, erledigt: true },
	{ titel: 'Werkzeugliste für den Transporter', auftrag: null, wer: 'chef@bauwelt.test', faellig: 5 }
];

const URLAUB = { wer: 'chef@bauwelt.test', von: 4, bis: 7, notiz: 'Beispiel: Kurzurlaub' };

/**
 * Beispielplanung der Stufe 1b (idempotent, im Betriebskontext der laufenden Transaktion). Wird auch von
 * scripts/testzugaenge.ts aufgerufen, nachdem die persönlichen Test-Zugänge angelegt sind.
 */
export async function sichereBeispielplanung(tx: Tx, betriebId: string): Promise<Planung> {
	const heute = berlinTag(new Date());
	const woche = wocheVon(heute);
	const tagVon = (t: 'heute' | 'morgen' | number) =>
		t === 'heute' ? heute : t === 'morgen' ? tagPlus(heute, 1) : tagPlus(woche[0], t);
	const zeit = (tag: string, stunde: number) =>
		berlinZeitpunkt(tag, Math.floor(stunde), Math.round((stunde % 1) * 60));

	const benutzer = new Map(
		(await tx<{ id: string; email: string }[]>`
			select id, email::text as email from app.benutzer where betrieb_id = ${betriebId}`).map((b) => [b.email, b.id])
	);
	// Aufträge (Nummern vergibt der Trigger in Anlage-Reihenfolge)
	const auftragIds: string[] = [];
	let neueAuftraege = 0;
	for (const a of AUFTRAEGE) {
		const [da] = await tx<{ id: string }[]>`
			select id from app.auftraege where betrieb_id = ${betriebId} and titel = ${a.titel} order by angelegt limit 1`;
		if (da) {
			auftragIds.push(da.id);
			continue;
		}
		const [kunde] = await tx<{ id: string }[]>`
			select id from app.kunden where betrieb_id = ${betriebId} and (nachname = ${a.kunde} or firma = ${a.kunde})
			order by angelegt limit 1`;
		if (!kunde) throw new Error(`Seed: Kunde „${a.kunde}“ fehlt`);
		const [neu] = await tx<{ id: string }[]>`
			insert into app.auftraege (betrieb_id, titel, kunde_id, status, beschreibung)
			values (${betriebId}, ${a.titel}, ${kunde.id}, ${a.status}, ${a.beschreibung ?? null}) returning id`;
		auftragIds.push(neu.id);
		neueAuftraege++;
	}

	// Einsätze: fest geplante plus „heute/morgen“ für jeden weiteren Monteur
	const weitereMonteure = await tx<{ email: string }[]>`
		select b.email::text as email from app.benutzer b join app.rollen r on r.id = b.rolle_id
		where b.betrieb_id = ${betriebId} and r.vorlage = 'monteur' and b.aktiv and b.email <> 'monteur@bauwelt.test'
		order by b.email`;
	const plan = [...EINSAETZE, ...weitereMonteure.flatMap((m) => MONTEUR_HEUTE.map((e) => ({ ...e, wer: m.email })))];
	let neueEinsaetze = 0;
	for (const e of plan) {
		const benutzerId = benutzer.get(e.wer);
		if (!benutzerId) continue;
		const tag = tagVon(e.tag);
		const beginn = zeit(tag, e.von);
		const ende = zeit(tag, e.bis);
		const [da] = await tx<{ id: string; beginn: Date; ende: Date }[]>`
			select id, beginn, ende from app.einsaetze
			where betrieb_id = ${betriebId} and benutzer_id = ${benutzerId} and notiz = ${e.notiz} limit 1`;
		if (!da) {
			await tx`
				insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, notiz)
				values (${betriebId}, ${auftragIds[e.auftrag]}, ${benutzerId}, ${beginn}, ${ende}, ${e.notiz})`;
			neueEinsaetze++;
		} else if (da.beginn.getTime() !== beginn.getTime() || da.ende.getTime() !== ende.getTime()) {
			await tx`update app.einsaetze set beginn = ${beginn}, ende = ${ende} where id = ${da.id}`;
		}
	}

	// Urlaub (wandert mit wie die Einsätze)
	const urlauber = benutzer.get(URLAUB.wer);
	if (urlauber) {
		const von = tagPlus(woche[0], URLAUB.von);
		const bis = tagPlus(woche[0], URLAUB.bis);
		const [da] = await tx<{ id: string }[]>`
			select id from app.abwesenheiten where betrieb_id = ${betriebId} and benutzer_id = ${urlauber} and notiz = ${URLAUB.notiz}`;
		if (!da) {
			await tx`
				insert into app.abwesenheiten (betrieb_id, benutzer_id, art, von, bis, notiz)
				values (${betriebId}, ${urlauber}, 'urlaub', ${von}, ${bis}, ${URLAUB.notiz})`;
		} else {
			await tx`update app.abwesenheiten set von = ${von}, bis = ${bis} where id = ${da.id} and (von <> ${von}::date or bis <> ${bis}::date)`;
		}
	}

	// To-dos (erkannt an Titel; Fälligkeit relativ zu heute beim Anlegen)
	let neueTodos = 0;
	for (const t of TODOS) {
		const [da] = await tx`select 1 from app.todos where betrieb_id = ${betriebId} and titel = ${t.titel}`;
		if (da) continue;
		await tx`
			insert into app.todos (betrieb_id, auftrag_id, titel, zustaendig_id, faellig, erledigt_am)
			values (${betriebId}, ${t.auftrag === null ? null : auftragIds[t.auftrag]}, ${t.titel},
				${t.wer ? (benutzer.get(t.wer) ?? null) : null}, ${t.faellig === null ? null : tagPlus(heute, t.faellig)},
				${t.erledigt ? new Date() : null})`;
		neueTodos++;
	}
	return { neueAuftraege, neueTodos, neueEinsaetze };
}

/**
 * Briefkopf von Bauwelt – nur Angaben, die öffentlich im Impressum der Bauwelt-Website stehen
 * (https://cansi798.github.io/Bauwelt/impressum/); Steuernummer, USt-IdNr. und Bankverbindung bleiben leer.
 */
const BRIEFKOPF = {
	firmenname: 'Bauwelt Handwerk GmbH',
	strasse: 'Schweriner Straße 16',
	plz: '22844',
	ort: 'Norderstedt',
	telefon: '0151 42888841',
	email: 'b.ahmedi@bauwelt-handwerk.de',
	web: 'www.bauwelt-handwerk.de',
	fusszeile: 'Geschäftsführer: Burim Ahmedi · Amtsgericht Kiel HRB 27109 KI'
};
const LOGO_DATEI = fileURLToPath(new URL('./seed-dateien/bauwelt-logo.png', import.meta.url));

/** Beispielpreise (Lohn, Material in Euro je Einheit) für die Startvorlagen Bad/Sanitär und Fliesen. */
const BEISPIELPREISE: Record<string, [number, number]> = {
	'Demontage Altbad': [1200, 150],
	'Bodengleiche Dusche einbauen': [650, 480],
	'WC wandhängend inkl. Vorwandelement montieren': [280, 390],
	'Waschtisch inkl. Armatur montieren': [160, 240],
	'Badewanne einbauen inkl. Wannenträger': [320, 410],
	'Duschabtrennung aus Glas montieren': [180, 690],
	'Unterputz-Armatur Dusche einbauen': [190, 320],
	'Trinkwasserleitung verlegen (Kalt-/Warmwasser)': [28, 14],
	'Abwasserleitung HT-Rohr verlegen': [26, 11],
	'Handtuchheizkörper montieren': [140, 260],
	'Eckventile und Anschlüsse erneuern': [35, 18],
	'Dichtheitsprüfung und Inbetriebnahme': [180, 0],
	'Arbeitsstunde Sanitär': [68, 0],
	'Altbelag Fliesen entfernen': [24, 0],
	'Untergrund vorbereiten und grundieren': [9, 3.5],
	'Ausgleichsmasse bis 10 mm': [14, 9],
	'Abdichtung im Verbund': [22, 14],
	'Dichtband in Ecken und Anschlüssen': [6, 4.5],
	'Bodenfliesen verlegen bis 60×60': [38, 7.5],
	'Großformatfliesen verlegen ab 60×120': [58, 9],
	'Wandfliesen verlegen bis 30×60': [42, 7.5],
	'Mosaik verlegen': [75, 12],
	'Sockelfliesen verlegen': [14, 2],
	'Kantenprofil setzen': [9, 8],
	'Silikonfugen erneuern': [8, 1.5],
	'Arbeitsstunde Fliesenleger': [62, 0]
};

/** Zwei Beispielangebote: Positionen aus dem Katalog (Bezeichnung) oder frei (mit Preis in Euro). */
const ANGEBOTE: {
	auftrag: string;
	status: 'entwurf' | 'versendet';
	positionen: { katalog?: string; bezeichnung?: string; einheit?: string; preis?: number; menge: number }[];
}[] = [
	{
		auftrag: 'Ladenumbau Trockenbau',
		status: 'versendet',
		positionen: [
			{ bezeichnung: 'Ständerwand einfach beplankt', einheit: 'm²', preis: 48, menge: 24 },
			{ bezeichnung: 'Decke abhängen', einheit: 'm²', preis: 52, menge: 18 },
			{ bezeichnung: 'Spachteln Q2', einheit: 'm²', preis: 9.5, menge: 42 },
			{ bezeichnung: 'Anfahrt und Baustelleneinrichtung', einheit: 'psch', preis: 85, menge: 1 }
		]
	},
	{
		auftrag: 'Fliesen Küche',
		status: 'entwurf',
		positionen: [
			{ katalog: 'Untergrund vorbereiten und grundieren', menge: 18 },
			{ katalog: 'Bodenfliesen verlegen bis 60×60', menge: 18 },
			{ katalog: 'Wandfliesen verlegen bis 30×60', menge: 4.5 },
			{ katalog: 'Sockelfliesen verlegen', menge: 17 },
			{ katalog: 'Silikonfugen erneuern', menge: 6 }
		]
	}
];

/**
 * Stufe 1c (idempotent, im Betriebskontext der laufenden Transaktion): Briefkopf mit Logo (nur wenn noch keiner
 * bzw. noch kein Logo da ist), Startvorlagen Bad/Sanitär und Fliesen mit Beispielpreisen (nur Positionen, die noch
 * Preis 0 haben und nicht als Beispielpreis markiert sind), zwei Angebote (nur für Aufträge ohne Angebot).
 */
export async function sichereKatalogUndAngebote(tx: Tx, betriebId: string): Promise<Angebote1c> {	await tx`
		insert into app.betrieb_profil ${tx({ betrieb_id: betriebId, ...BRIEFKOPF })}
		on conflict (betrieb_id) do nothing`;
	if (existsSync(LOGO_DATEI)) {
		await tx`
			update app.betrieb_profil set logo = ${readFileSync(LOGO_DATEI)}, logo_typ = 'image/png', logo_geaendert = now()
			where betrieb_id = ${betriebId} and logo is null`;
	}
	const neu = await tx`
		insert into app.katalog_positionen (betrieb_id, gewerk, bezeichnung, beschreibung, einheit, vorlage_id)
		select ${betriebId}, v.gewerk, v.bezeichnung, v.beschreibung, v.einheit, v.id
		from app.katalog_vorlagen v where v.gewerk in ('bad_sanitaer', 'fliesen')
		order by v.gewerk, v.sortierung
		on conflict (betrieb_id, vorlage_id) do nothing
		returning id`;
	for (const [bezeichnung, [lohn, material]] of Object.entries(BEISPIELPREISE)) {
		await tx`
			update app.katalog_positionen
			set lohn_cent = ${Math.round(lohn * 100)}, material_cent = ${Math.round(material * 100)},
				beschreibung = concat_ws(' ', beschreibung, '(Beispielpreis)')
			where betrieb_id = ${betriebId} and vorlage_id is not null and bezeichnung = ${bezeichnung}
				and lohn_cent = 0 and material_cent = 0 and coalesce(beschreibung, '') not like '%Beispielpreis%'`;
	}
	let neueAngebote = 0;
	for (const a of ANGEBOTE) {
		const [auftrag] = await tx<{ id: string }[]>`
			select id from app.auftraege where betrieb_id = ${betriebId} and titel = ${a.auftrag} order by angelegt limit 1`;
		if (!auftrag) continue;
		const [da] = await tx`select 1 from app.angebote where betrieb_id = ${betriebId} and auftrag_id = ${auftrag.id}`;
		if (da) continue;
		const [angebot] = await tx<{ id: string }[]>`
			insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis, einleitung, schluss)
			values (${betriebId}, ${auftrag.id}, (now() at time zone 'Europe/Berlin')::date + ${GUELTIG_TAGE}::int,
				${STANDARD_EINLEITUNG}, ${STANDARD_SCHLUSS})
			returning id`;
		let pos = 0;
		for (const p of a.positionen) {
			pos++;
			if (p.katalog) {
				await tx`
					insert into app.angebot_positionen
						(betrieb_id, angebot_id, pos, katalog_position_id, bezeichnung, beschreibung, menge, einheit, einzelpreis_cent)
					select ${betriebId}, ${angebot.id}, ${pos}, k.id, k.bezeichnung, k.beschreibung, ${p.menge}, k.einheit,
						k.lohn_cent + k.material_cent
					from app.katalog_positionen k where k.betrieb_id = ${betriebId} and k.bezeichnung = ${p.katalog}
					order by k.angelegt limit 1`;
			} else {
				await tx`
					insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
					values (${betriebId}, ${angebot.id}, ${pos}, ${p.bezeichnung!}, ${p.menge}, ${p.einheit!}, ${Math.round(p.preis! * 100)})`;
			}
		}
		if (a.status === 'versendet') await tx`update app.angebote set status = 'versendet' where id = ${angebot.id}`;
		neueAngebote++;
	}
	return { neueKatalogpositionen: neu.length, neueAngebote };
}

export async function sichereVorlagen(tx: Tx, betriebId: string): Promise<number> {
	const VORLAGEN_BEISPIELE = [
		{
			name: 'Wartung Heizung',
			beschreibung: 'Jährliche Wartung der Heizungsanlage',
			todos: [
				{ titel: 'Filter wechseln', beschreibung: 'Luft- und Wasserfilter prüfen und ggf. tauschen' },
				{ titel: 'Brenner reinigen', beschreibung: 'Brenner ausbauen und reinigen' },
				{ titel: 'Abgas messen', beschreibung: 'Abgaswerte messen und protokollieren' },
				{ titel: 'Sicherheitsventile prüfen', beschreibung: 'Überdruckventil und Not-Aus prüfen' }
			]
		},
		{
			name: 'Bad-Sanitär',
			beschreibung: 'Standard-Arbeiten für Badsanierung',
			todos: [
				{ titel: 'Altbad ausbauen', beschreibung: 'Sanitärobjekte und Fliesen entfernen' },
				{ titel: 'Leitungen verlegen', beschreibung: 'Zu- und Abwasserleitungen installieren' },
				{ titel: 'Fliesen verlegen', beschreibung: 'Wand und Boden fliesen' },
				{ titel: 'Sanitärobjekte montieren', beschreibung: 'WC, Waschtisch, Dusche installieren' }
			]
		},
		{
			name: 'Umzug',
			beschreibung: 'To-dos für Umzugsaufträge',
			todos: [
				{ titel: 'Kartons besorgen', beschreibung: 'Ausreichend Umzugskartons bereitstellen' },
				{ titel: 'Möbel demontieren', beschreibung: 'Große Möbel zerlegen' },
				{ titel: 'Transport organisieren', beschreibung: 'Umzugswagen oder Firma beauftragen' },
				{ titel: 'Aufbau am Zielort', beschreibung: 'Möbel wieder zusammensetzen' }
			]
		}
	];

	let neue = 0;
	for (const v of VORLAGEN_BEISPIELE) {
		const [vorhanden] = await tx`
			select 1 from app.auftrag_vorlagen where betrieb_id = ${betriebId} and name = ${v.name}`;
		if (vorhanden) continue;

		const [vorlage] = await tx`
			insert into app.auftrag_vorlagen (betrieb_id, name, beschreibung)
			values (${betriebId}, ${v.name}, ${v.beschreibung})
			returning id`;
		for (let i = 0; i < v.todos.length; i++) {
			const t = v.todos[i];
			await tx`
				insert into app.auftrag_vorlagen_todos (betrieb_id, vorlage_id, titel, beschreibung, sortierung)
				values (${betriebId}, ${vorlage.id}, ${t.titel}, ${t.beschreibung}, ${i + 1})`;
		}
		neue++;
	}
	return neue;
}

export async function seedDev(url: string, opts: { datei?: string } = {}): Promise<SeedErgebnis> {
	const datei = opts.datei ?? STANDARD_DATEI;
	const daten = leseZugangsdaten(datei);
	const sql = postgres(url, { max: 1, onnotice: () => {} });
	let ergebnis: SeedErgebnis;
	try {
		ergebnis = await sql.begin(async (tx) => {
			const [tarif] = await tx<{ id: string }[]>`select id from app.tarife where schluessel = 'test'`;
			if (!tarif) throw new Error('Tarif „test“ fehlt – bitte zuerst `npm run migrate` ausführen.');

			// Betrieb
			let [betrieb] = await tx<{ id: string }[]>`
				select id from app.betriebe where name = ${BETRIEB} order by angelegt limit 1`;
			if (!betrieb) {
				[betrieb] = await tx<{ id: string }[]>`
					insert into app.betriebe (name, tarif_id, abo_status) values (${BETRIEB}, ${tarif.id}, 'test')
					returning id`;
			}

			// Rollen aus den Vorlagen
			const rollen = new Map<Vorlage, string>();
			for (const vorlage of Object.keys(VORLAGEN) as Vorlage[]) {
				let [rolle] = await tx<{ id: string }[]>`
					select id from app.rollen where betrieb_id = ${betrieb.id} and vorlage = ${vorlage}
					order by name limit 1`;
				if (!rolle) {
					[rolle] = await tx<{ id: string }[]>`
						insert into app.rollen (betrieb_id, name, rechte, vorlage)
						values (${betrieb.id}, ${VORLAGEN_NAMEN[vorlage]}, ${[...VORLAGEN[vorlage]]}, ${vorlage})
						returning id`;
				}
				rollen.set(vorlage, rolle.id);
			}

			// Benutzer des Betriebs
			let neueBenutzer = 0;
			let chefId = '';
			for (const b of BENUTZER) {
				const r = await sichereBenutzer(tx, daten, {
					email: b.email,
					name: b.name,
					betriebId: betrieb.id,
					rolleId: rollen.get(b.vorlage)!
				});
				if (r.neu) neueBenutzer++;
				if (b.vorlage === 'chef') chefId = r.id;
			}

			// Plattform-Admin (ohne Betrieb) mit fest eingerichteter Zwei-Faktor-Anmeldung
			const admin = await sichereBenutzer(tx, daten, { ...ADMIN, betriebId: null, rolleId: null });
			if (admin.neu) neueBenutzer++;
			await tx`insert into app.plattform_admins (benutzer_id) values (${admin.id}) on conflict do nothing`;
			const totpSchluessel = `totp:${ADMIN.email}`;
			const [totp] = await tx<{ totp_aktiv: boolean; totp_geheim: string | null }[]>`
				select totp_aktiv, totp_geheim from app.benutzer where id = ${admin.id}`;
			if (!totp.totp_aktiv || totp.totp_geheim !== daten.get(totpSchluessel)) {
				const geheimnis = new OTPAuth.Secret({ size: 20 }).base32;
				await tx`
					update app.benutzer
					set totp_geheim = ${geheimnis}, totp_aktiv = true, totp_letzter_schritt = null,
						totp_fehlversuche = 0, totp_gesperrt_bis = null, totp_sperr_stufe = 0
					where id = ${admin.id}`;
				daten.set(totpSchluessel, geheimnis);
			}
			daten.set(`totp-uri:${ADMIN.email}`, totpUri(daten.get(totpSchluessel)!, ADMIN.email));

			// Beispielkunden (Protokoll-Einträge im Namen des Chefs)
			await tx`select set_config('app.betrieb_id', ${betrieb.id}, true), set_config('app.benutzer_id', ${chefId}, true)`;
			let neueKunden = 0;
			for (const k of KUNDEN) {
				const [da] = await tx`
					select 1 from app.kunden
					where betrieb_id = ${betrieb.id} and art = ${k.art}
						and coalesce(firma, '') = ${k.firma ?? ''} and coalesce(nachname, '') = ${k.nachname ?? ''}
						and coalesce(vorname, '') = ${k.vorname ?? ''}`;
				if (da) continue;
				await tx`
					insert into app.kunden (betrieb_id, art, firma, anrede, vorname, nachname, email, telefon, strasse, plz, ort, notiz)
					values (${betrieb.id}, ${k.art}, ${k.firma ?? null}, ${k.anrede ?? null}, ${k.vorname ?? null},
						${k.nachname ?? null}, ${k.email ?? null}, ${k.telefon ?? null}, ${k.strasse ?? null},
						${k.plz ?? null}, ${k.ort ?? null}, ${k.notiz ?? null})`;
				neueKunden++;
			}
			const planung = await sichereBeispielplanung(tx, betrieb.id);
			const angebote = await sichereKatalogUndAngebote(tx, betrieb.id);
			const neueVorlagen = await sichereVorlagen(tx, betrieb.id);
			return { neueBenutzer, neueKunden, ...planung, ...angebote, neueVorlagen };
		});
	} finally {
		await sql.end();
	}
	// Erst nach erfolgreicher Transaktion schreiben: Datei und Datenbank passen immer zusammen.
	schreibeZugangsdaten(datei, daten);
	console.log(
		`Entwicklungsdaten bereit: Betrieb „${BETRIEB}“, ${BENUTZER.length + 1} Benutzer ` +
			`(${ergebnis.neueBenutzer} neu), ${KUNDEN.length} Beispielkunden (${ergebnis.neueKunden} neu), ` +
			`${AUFTRAEGE.length} Beispielaufträge (${ergebnis.neueAuftraege} neu), ` +
			`${ergebnis.neueEinsaetze} neue Einsätze, ${ergebnis.neueTodos} neue To-dos, ` +
			`${ergebnis.neueKatalogpositionen} neue Katalogpositionen, ${ergebnis.neueAngebote} neue Angebote, ` +
			`${ergebnis.neueVorlagen} neue Vorlagen. ` +
			`Zugangsdaten: ${datei}`
	);
	return ergebnis;
}

/** Name der Datenbank in der Entwicklungs-Sandbox (Container crm-db). */
const SANDBOX_DB = 'crm';

/**
 * Schutz vor dem Lauf außerhalb der Sandbox: Liefert eine Meldung, warum nicht geseedet werden darf – oder `null`.
 * Verboten bei `NODE_ENV=production` (immer) und für jede Datenbank außer `crm`, es sei denn, sie wird mit
 * `--erlaube-db=<name>` ausdrücklich genannt.
 */
export function pruefeSandbox(env: Record<string, string | undefined>, argumente: readonly string[]): string | null {
	if (env.NODE_ENV === 'production') {
		return 'Abbruch: NODE_ENV=production – Entwicklungsdaten werden nie in eine Produktionsumgebung geschrieben.';
	}
	const db = env.PGDATABASE ?? '';
	const erlaubt = argumente.find((a) => a.startsWith('--erlaube-db='))?.slice('--erlaube-db='.length);
	if (db !== SANDBOX_DB && db !== erlaubt) {
		return (
			`Abbruch: Datenbank „${db}“ ist nicht die Entwicklungsdatenbank „${SANDBOX_DB}“. ` +
			`Wenn das wirklich gewollt ist: --erlaube-db=${db || '<name>'} angeben.`
		);
	}
	return null;
}

// Aufruf als Skript: `npm run seed:dev` (andere Datenbank: `npm run seed:dev -- --erlaube-db=<name>`)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	ladeEnv();
	const grund = pruefeSandbox(process.env, process.argv.slice(2));
	if (grund) {
		console.error(grund);
		process.exit(1);
	}
	seedDev(urlAusUmgebung()).catch((fehler) => {
		console.error(fehler instanceof Error ? fehler.message : fehler);
		process.exit(1);
	});
}
