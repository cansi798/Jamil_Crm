import { mitBetrieb, systemAbfrage, type Kontext } from '../db';
import { ladePdfDaten } from '../angebote';
import { holeLogo, holeProfil } from '../betriebsprofil';
import { angebotPdf } from '../pdf/angebot-pdf';
import { nextcloud, type NextcloudKonfig } from './konfig';
import { anbindungsBetrieb } from './konten';
import { NextcloudFehler } from './http';
import { ical, pruefsumme, sichererName, vcard } from './formate';
import { dateiPfad, loesche, schreibeDatei, schreibeEintrag, sichereAdressbuch, sichereKalender } from './dav';

/**
 * Abgleich CRM → Nextcloud (nur in diese Richtung). Wiederholbar und ohne Duplikate: Jeder Eintrag hat eine feste
 * UID bzw. einen festen Pfad; was schon drüben ist, steht mit Prüfsumme in app.nextcloud_abgleich. Geändert →
 * überschreiben, umgezogen (anderer Pfad/andere Person) → alt löschen, neu schreiben, im CRM gelöscht → drüben löschen.
 * Alte Termine außerhalb des Zeitfensters bleiben stehen (nur echte Löschungen werden übertragen).
 *
 * - Termine: Einsätze/eigene Termine jeder verknüpften Person in „CRM – Einsätze“ (Kalender des Technik-Kontos,
 *   lesend mit der Person geteilt).
 * - Kontakte: alle Kunden im Adressbuch „CRM Kunden“ (lesend mit NEXTCLOUD_KONTAKTE_GRUPPE geteilt).
 * - Dateien: Fotos und abgeschlossene Protokoll-PDFs der Aufträge sowie versendete/angenommene Angebote als PDF in
 *   <Ordner>/Kunden/<Kunde>/<Auftragsnummer>/.
 */

export const TERMIN_TAGE_ZURUECK = 30;
export const TERMIN_TAGE_VOR = 365;
/** Höchstens so viele Datei-Uploads je Durchlauf (Last begrenzen; der Rest folgt im nächsten). */
export const MAX_DATEIEN_JE_LAUF = 50;

export type Zahlen = { geschrieben: number; geloescht: number; unveraendert: number; fehler: number };
export type LaufErgebnis = {
	zeit: string;
	ok: boolean;
	meldung: string | null;
	termine?: Zahlen;
	kontakte?: Zahlen;
	dateien?: Zahlen;
};

let letzterLauf: LaufErgebnis | null = null;
export const letzterAbgleich = () => letzterLauf;

const neu = (): Zahlen => ({ geschrieben: 0, geloescht: 0, unveraendert: 0, fehler: 0 });

type Verfolgt = { objekt_id: string; benutzer_id: string | null; ziel: string; pruefsumme: string };

async function verfolgte(k: Kontext, art: string): Promise<Map<string, Verfolgt>> {
	const z = await mitBetrieb(k, (tx) => tx`
		select objekt_id, benutzer_id, ziel, pruefsumme from app.nextcloud_abgleich where betrieb_id = ${k.betriebId} and art = ${art}`);
	return new Map(z.map((r) => [r.objekt_id as string, r as unknown as Verfolgt]));
}

async function merke(k: Kontext, art: string, objektId: string, benutzerId: string | null, ziel: string, summe: string) {
	await mitBetrieb(k, (tx) => tx`
		insert into app.nextcloud_abgleich (betrieb_id, art, objekt_id, benutzer_id, ziel, pruefsumme)
		values (${k.betriebId}, ${art}, ${objektId}, ${benutzerId}, ${ziel}, ${summe})
		on conflict (betrieb_id, art, objekt_id) do update
			set benutzer_id = excluded.benutzer_id, ziel = excluded.ziel, pruefsumme = excluded.pruefsumme, aktualisiert = now()`);
}

async function vergiss(k: Kontext, art: string, objektId: string) {
	await mitBetrieb(k, (tx) => tx`delete from app.nextcloud_abgleich where betrieb_id = ${k.betriebId} and art = ${art} and objekt_id = ${objektId}`);
}

/** Einen Eintrag schreiben, falls neu/geändert; alten Pfad entfernen, wenn er sich geändert hat. */
async function uebertrage(
	nc: NextcloudKonfig,
	k: Kontext,
	art: string,
	alt: Verfolgt | undefined,
	soll: { objektId: string; benutzerId: string | null; ziel: string; summe: string },
	schreiben: () => Promise<string>,
	z: Zahlen
): Promise<void> {
	if (alt && alt.pruefsumme === soll.summe && alt.ziel === soll.ziel) {
		z.unveraendert++;
		return;
	}
	try {
		if (alt && alt.ziel !== soll.ziel) await loesche(nc, alt.ziel);
		const ziel = await schreiben();
		await merke(k, art, soll.objektId, soll.benutzerId, ziel, soll.summe);
		z.geschrieben++;
	} catch (e) {
		z.fehler++;
		console.error(`Nextcloud-Abgleich (${art}):`, (e as Error).message);
	}
}

/** Verfolgte Einträge, deren Objekt es im CRM nicht mehr gibt (bzw. die nicht mehr dorthin gehören), entfernen. */
async function raeumeAuf(nc: NextcloudKonfig, k: Kontext, art: string, alte: Verfolgt[], z: Zahlen): Promise<void> {
	for (const a of alte) {
		try {
			await loesche(nc, a.ziel);
			await vergiss(k, art, a.objekt_id);
			z.geloescht++;
		} catch (e) {
			z.fehler++;
			console.error(`Nextcloud-Abgleich (${art}, löschen):`, (e as Error).message);
		}
	}
}

const kundeName = (r: Record<string, any>) =>
	r.firma || [r.vorname, r.nachname].filter(Boolean).join(' ') || r.einmal_name || 'Ohne Kunde';

// ——— Termine ———

async function termine(nc: NextcloudKonfig, k: Kontext, verknuepft: { benutzer_id: string; nc_benutzer: string; name: string }[]) {
	const z = neu();
	const alle = await verfolgte(k, 'termin');
	const verknuepftIds = new Set(verknuepft.map((v) => v.benutzer_id));
	for (const v of verknuepft) {
		let sammlung: string;
		try {
			sammlung = await sichereKalender(nc, v.nc_benutzer, `CRM – Einsätze (${v.name})`.slice(0, 100));
		} catch (e) {
			z.fehler++;
			console.error('Nextcloud-Abgleich (Kalender):', (e as Error).message);
			continue;
		}
		const zeilen = await mitBetrieb(k, (tx) => tx`
			select e.id, e.beginn, e.ende, e.notiz, e.art, e.geaendert, coalesce(a.titel, e.titel, 'Termin') as titel, a.nummer,
				k.firma, k.vorname, k.nachname, a.einmal_name,
				coalesce(o.strasse, k.strasse, a.einmal_strasse) as strasse, coalesce(o.plz, k.plz, a.einmal_plz) as plz,
				coalesce(o.ort, k.ort, a.einmal_ort) as ort, a.id as auftrag_id
			from app.einsaetze e
			left join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
			left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
			left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id
			where e.betrieb_id = ${k.betriebId} and e.benutzer_id = ${v.benutzer_id}
				and e.ende >= now() - make_interval(days => ${TERMIN_TAGE_ZURUECK})
				and e.beginn <= now() + make_interval(days => ${TERMIN_TAGE_VOR})`);
		for (const r of zeilen) {
			const uid = `crm-einsatz-${r.id}`;
			const kunde = r.auftrag_id ? kundeName(r) : null;
			const inhalt = ical({
				uid,
				titel: [r.titel, kunde && kunde !== 'Ohne Kunde' ? kunde : null].filter(Boolean).join(' – '),
				beginn: new Date(r.beginn),
				ende: new Date(r.ende),
				ort: [r.strasse, [r.plz, r.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
				beschreibung: [r.nummer ? `Auftrag ${r.nummer}` : null, r.notiz].filter(Boolean).join('\n') || null,
				link: r.auftrag_id && process.env.ORIGIN ? `${process.env.ORIGIN}/auftraege/${r.auftrag_id}` : null,
				geaendert: new Date(r.geaendert)
			});
			// Prüfsumme ohne DTSTAMP-Schwankung: Inhalt hängt nur von den Daten ab (geaendert ist Teil der Daten)
			const summe = pruefsumme(inhalt);
			await uebertrage(nc, k, 'termin', alle.get(r.id), { objektId: r.id, benutzerId: v.benutzer_id, ziel: `${sammlung}${uid}.ics`, summe },
				() => schreibeEintrag(nc, sammlung, `${uid}.ics`, inhalt, 'text/calendar'), z);
			alle.delete(r.id);
		}
	}
	// Übrig: außerhalb des Fensters (bleibt), gelöscht, andere Person oder Verknüpfung gelöst (→ entfernen)
	const rest = [...alle.values()];
	const noch = rest.length
		? await mitBetrieb(k, (tx) => tx`select id, benutzer_id from app.einsaetze where betrieb_id = ${k.betriebId} and id = any(${rest.map((r) => r.objekt_id)}::uuid[])`)
		: [];
	const besitzer = new Map(noch.map((r) => [r.id as string, r.benutzer_id as string]));
	await raeumeAuf(nc, k, 'termin', rest.filter((r) => {
		const b = besitzer.get(r.objekt_id);
		return !b || b !== r.benutzer_id || !verknuepftIds.has(b);
	}), z);
	return z;
}

// ——— Kontakte ———

async function kontakte(nc: NextcloudKonfig, k: Kontext) {
	const z = neu();
	const sammlung = await sichereAdressbuch(nc, nc.kontakte?.gruppe ?? null);
	const alle = await verfolgte(k, 'kontakt');
	const zeilen = await mitBetrieb(k, (tx) => tx`
		select id, firma, anrede, vorname, nachname, email::text as email, telefon, strasse, plz, ort, geaendert
		from app.kunden where betrieb_id = ${k.betriebId}`);
	for (const r of zeilen) {
		const uid = `crm-kunde-${r.id}`;
		const inhalt = vcard({ uid, ...r, notiz: null, geaendert: new Date(r.geaendert) } as Parameters<typeof vcard>[0]);
		await uebertrage(nc, k, 'kontakt', alle.get(r.id), { objektId: r.id, benutzerId: null, ziel: `${sammlung}${uid}.vcf`, summe: pruefsumme(inhalt) },
			() => schreibeEintrag(nc, sammlung, `${uid}.vcf`, inhalt, 'text/vcard'), z);
		alle.delete(r.id);
	}
	await raeumeAuf(nc, k, 'kontakt', [...alle.values()], z);
	return z;
}

// ——— Dateien und Angebote ———

async function dateien(nc: NextcloudKonfig, k: Kontext) {
	const z = neu();
	const ordner = nc.dateien!.ordner.split('/');
	const alleDateien = await verfolgte(k, 'datei');
	const alleAngebote = await verfolgte(k, 'angebot');
	let uploads = 0;

	// Fotos der Aufträge und abgeschlossene Protokoll-PDFs (abgelegt in app.dateien)
	const zeilen = await mitBetrieb(k, (tx) => tx`
		select d.id, d.name, d.typ, d.groesse, d.geaendert, a.nummer, k.firma, k.vorname, k.nachname, a.einmal_name
		from app.dateien d
		join app.auftraege a on a.id = d.auftrag_id and a.betrieb_id = d.betrieb_id
		left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
		where d.betrieb_id = ${k.betriebId}
			and (d.typ like 'image/%'
				or exists (select 1 from app.protokolle p where p.pdf_datei_id = d.id and p.betrieb_id = d.betrieb_id and p.status = 'abgeschlossen'))
		order by d.angelegt`);
	const belegt = new Set<string>();
	for (const r of zeilen) {
		const alt = alleDateien.get(r.id);
		alleDateien.delete(r.id);
		let name = sichererName(r.name, 'Datei');
		const teile = [...ordner, 'Kunden', sichererName(kundeName(r)), sichererName(r.nummer)];
		if (belegt.has([...teile, name].join('/'))) {
			const punkt = name.lastIndexOf('.');
			name = punkt > 0 ? `${name.slice(0, punkt)} (${r.id.slice(0, 8)})${name.slice(punkt)}` : `${name} (${r.id.slice(0, 8)})`;
		}
		belegt.add([...teile, name].join('/'));
		const ziel = [...teile, name];
		const summe = pruefsumme(`${new Date(r.geaendert).toISOString()}|${r.groesse}|${ziel.join('/')}`);
		if (alt && alt.pruefsumme === summe) {
			z.unveraendert++;
			continue;
		}
		if (uploads >= MAX_DATEIEN_JE_LAUF) continue;
		uploads++;
		await uebertrage(nc, k, 'datei', alt, { objektId: r.id, benutzerId: null, ziel: dateiPfad(nc, ziel), summe }, async () => {
			const [d] = await mitBetrieb(k, (tx) => tx`select inhalt from app.dateien where id = ${r.id} and betrieb_id = ${k.betriebId}`);
			if (!d) throw new NextcloudFehler('Datei inzwischen gelöscht', 404);
			return schreibeDatei(nc, ziel, new Uint8Array(d.inhalt), r.typ);
		}, z);
	}
	await raeumeAuf(nc, k, 'datei', [...alleDateien.values()], z);

	// Angebote als PDF (versendet/angenommen – ab dann ändern sie sich nicht mehr)
	const angebote = await mitBetrieb(k, (tx) => tx`
		select an.id, an.nummer, an.status, an.geaendert, a.nummer as auftrag_nummer,
			coalesce(k1.firma, k2.firma) as firma, coalesce(k1.vorname, k2.vorname) as vorname,
			coalesce(k1.nachname, k2.nachname) as nachname, a.einmal_name
		from app.angebote an
		left join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
		left join app.kunden k1 on k1.id = a.kunde_id and k1.betrieb_id = a.betrieb_id
		left join app.kunden k2 on k2.id = an.kunde_id and k2.betrieb_id = an.betrieb_id
		where an.betrieb_id = ${k.betriebId} and an.status in ('versendet', 'angenommen')`);
	const alleAngeboteIds = new Set((await mitBetrieb(k, (tx) => tx`select id from app.angebote where betrieb_id = ${k.betriebId}`)).map((r) => r.id as string));
	for (const r of angebote) {
		const alt = alleAngebote.get(r.id);
		alleAngebote.delete(r.id);
		const ziel = [...ordner, 'Kunden', sichererName(kundeName(r)), sichererName(r.auftrag_nummer ?? 'Ohne Auftrag'),
			`Angebot_${sichererName(r.nummer)}.pdf`];
		const summe = pruefsumme(`${new Date(r.geaendert).toISOString()}|${r.status}|${ziel.join('/')}`);
		if (alt && alt.pruefsumme === summe) {
			z.unveraendert++;
			continue;
		}
		if (uploads >= MAX_DATEIEN_JE_LAUF) continue;
		uploads++;
		await uebertrage(nc, k, 'angebot', alt, { objektId: r.id, benutzerId: null, ziel: dateiPfad(nc, ziel), summe }, async () => {
			const daten = await ladePdfDaten(k, r.id);
			const [profil, logo] = await Promise.all([holeProfil(k), holeLogo(k)]);
			return schreibeDatei(nc, ziel, await angebotPdf({ profil, logo, ...daten }), 'application/pdf');
		}, z);
	}
	// Angebote: nur entfernen, wenn im CRM gelöscht (abgelehnte/zurückgezogene bleiben als Beleg liegen)
	await raeumeAuf(nc, k, 'angebot', [...alleAngebote.values()].filter((a) => !alleAngeboteIds.has(a.objekt_id)), z);
	return z;
}

// ——— Durchlauf ———

/** Ein kompletter Abgleich (alle eingeschalteten Teile). Fehler eines Teils halten die anderen nicht auf. */
export async function gleicheAb(nc: NextcloudKonfig | null = nextcloud()): Promise<LaufErgebnis> {
	const ergebnis: LaufErgebnis = { zeit: new Date().toISOString(), ok: true, meldung: null };
	try {
		if (!nc || !nc.technik || !(nc.kalender || nc.kontakte || nc.dateien)) {
			ergebnis.meldung = 'Abgleich ist ausgeschaltet.';
			return ergebnis;
		}
		const betrieb = await anbindungsBetrieb(nc);
		if (!betrieb) {
			ergebnis.ok = false;
			ergebnis.meldung = 'Kein Betrieb festgelegt (NEXTCLOUD_BETRIEB) und mehr als ein Betrieb vorhanden.';
			return ergebnis;
		}
		const [d] = await systemAbfrage((sql) => sql`select app.nextcloud_dienst_kontext(${betrieb}::uuid) as id`);
		if (!d?.id) {
			ergebnis.ok = false;
			ergebnis.meldung = 'Im Betrieb gibt es keinen aktiven Benutzer mit dem Recht „Einstellungen“.';
			return ergebnis;
		}
		const k: Kontext = { betriebId: betrieb, benutzerId: d.id };
		const verknuepft = (await systemAbfrage((sql) => sql`select * from app.nextcloud_verknuepfte(${betrieb}::uuid)`)) as unknown as {
			benutzer_id: string;
			nc_benutzer: string;
			name: string;
		}[];
		const teil = async (name: string, f: () => Promise<Zahlen>) => {
			try {
				return await f();
			} catch (e) {
				ergebnis.ok = false;
				ergebnis.meldung = `${name}: ${(e as Error).message}`;
				console.error(`Nextcloud-Abgleich (${name}):`, (e as Error).message);
				return undefined;
			}
		};
		if (nc.kalender) ergebnis.termine = await teil('Kalender', () => termine(nc, k, verknuepft));
		if (nc.kontakte) ergebnis.kontakte = await teil('Kontakte', () => kontakte(nc, k));
		if (nc.dateien) ergebnis.dateien = await teil('Dateien', () => dateien(nc, k));
		for (const z of [ergebnis.termine, ergebnis.kontakte, ergebnis.dateien]) if (z && z.fehler > 0) ergebnis.ok = false;
		return ergebnis;
	} finally {
		letzterLauf = ergebnis;
	}
}

let dienst: ReturnType<typeof setInterval> | null = null;
let laeuft = false;

/** Hintergrund-Abgleich starten (nur wenn eingeschaltet). Erster Lauf nach 30 Sekunden. */
export function starteNextcloudDienst(): void {
	const nc = nextcloud();
	if (dienst || !nc || !(nc.kalender || nc.kontakte || nc.dateien)) return;
	const lauf = async () => {
		if (laeuft) return;
		laeuft = true;
		try {
			await gleicheAb(nc);
		} catch (e) {
			console.error('Nextcloud-Abgleich:', (e as Error).message);
		} finally {
			laeuft = false;
		}
	};
	setTimeout(lauf, 30_000).unref?.();
	dienst = setInterval(lauf, nc.intervallMinuten * 60_000);
	dienst.unref?.();
}

export function stoppeNextcloudDienst(): void {
	if (dienst) clearInterval(dienst);
	dienst = null;
}

/** Sofort abgleichen (Knopf in den Einstellungen); läuft schon einer, wird nichts doppelt gestartet. */
export async function jetztAbgleichen(): Promise<LaufErgebnis | null> {
	if (laeuft) return null;
	laeuft = true;
	try {
		return await gleicheAb();
	} finally {
		laeuft = false;
	}
}

