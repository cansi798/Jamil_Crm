import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { holeAngebot } from './angebote';
import { holeProfil } from './betriebsprofil';
import { euro } from '../geld';
import { berlinTag, tagDeutsch, tagPlus } from '../zeit';
import {
	faelligeStufe,
	BEISPIEL_WERTE,
	fuelle,
	NACHFASS_ARTEN,
	STANDARD_STUFEN,
	STANDARD_VORLAGEN,
	ZUWEISUNGEN,
	type MailBeispiel,
	type NachfassArt,
	type Zuweisung
} from '../nachfassen';
import { baueMail, holeSignatur, listeMailVorlagen, type MailVorlage } from './mail-vorlagen';

// Vorlagen und Signatur liegen in der Bibliothek (Jamil msg 2789) – hier für bisherige Aufrufer weitergereicht
export {
	holeSignatur,
	listeMailVorlagen,
	loescheMailVorlage,
	speichereMailVorlage,
	speichereSignatur,
	VORLAGE_FELDER,
	MAX_VORLAGEN,
	type MailVorlage
} from './mail-vorlagen';

/**
 * Automatisches Nachfassen (Wünsche Jamil, msgs 2585, 2633, 2636; Migration 050) – ohne Mail-Anbindung (Jamil 2589).
 *
 * Einstellungen (Stufen, Mail-Vorlagen, Signatur): nur mit „Einstellungen“ (Chef/Admin) – geprüft von den Aufrufern.
 * Der Lauf (`pruefeNachfassen`) läuft für den ganzen Betrieb, sobald jemand die App benutzt (höchstens alle 10 Minuten
 * je Betrieb, siehe `pruefeNachfassenGedrosselt`): Für jedes versendete Angebot wird die fällige Stufe genau einmal
 * angelegt – Lauf mit fertigem Mailtext, dazu eine Aufgabe. Angenommen/abgelehnt → keine neuen Stufen, offene
 * Nachfass-Aufgaben werden erledigt. Versenden kann später eine Anbindung (`MailVersand`); bis dahin „Kopieren“/mailto.
 */

/** Versand-Schnittstelle für später (Jamil 2589: Anbindung offen). Heute gibt es nur „nicht verbunden“. */
export interface MailVersand {
	readonly verbunden: boolean;
	senden(mail: { an: string; betreff: string; html: string; text: string; anhaenge?: { name: string; typ: string; bytes: Uint8Array }[] }): Promise<void>;
}
export const KEIN_VERSAND: MailVersand = {
	verbunden: false,
	async senden() {
		throw new ApiFehler(409, 'Der Mailversand ist noch nicht angebunden – bitte „In Mailprogramm öffnen“ nutzen.');
	}
};
export let mailVersand: MailVersand = KEIN_VERSAND;
/** Anbindung setzen (später echte Anbindung; in Tests eine Attrappe). */
export function setzeMailVersand(v: MailVersand | null): void {
	mailVersand = v ?? KEIN_VERSAND;
}

export type NachfassStufe = {
	id: string;
	art: NachfassArt;
	pos: number;
	tage: number;
	todo: boolean;
	mail: boolean;
	todoTitel: string | null;
	mailVorlageId: string | null;
	zuweisung: Zuweisung;
	benutzerId: string | null;
	rolleId: string | null;
	faelligVersatz: number;
	mahnstufe: number | null;
	aktiv: boolean;
};
export type NachfassLauf = {
	id: string;
	angebotId: string;
	stufeNr: number;
	tage: number;
	todoId: string | null;
	todoErledigt: boolean;
	zustaendigName: string | null;
	mailBetreff: string | null;
	mailHtml: string | null;
	mailText: string | null;
	mailAn: string | null;
	gesendetAm: string | null;
	angelegt: string;
};

export const STUFEN_FELDER = ['art', 'tage', 'todo', 'mail', 'todoTitel', 'mailVorlageId', 'zuweisung', 'benutzerId', 'rolleId', 'faelligVersatz', 'mahnstufe', 'aktiv'] as const;
export const MAX_STUFEN = 20;

const nichtGefunden = (was: string) => new ApiFehler(404, `${was} nicht gefunden.`);
const id = (w: unknown, was: string) => {
	if (typeof w !== 'string' || !UUID.test(w.trim())) throw nichtGefunden(was);
	return w.trim().toLowerCase();
};
const optId = (w: unknown, name: string) => {
	if (w === undefined || w === null || w === '') return null;
	if (typeof w !== 'string' || !UUID.test(w.trim())) throw new ApiFehler(400, `${name}: ungültige Auswahl.`);
	return w.trim().toLowerCase();
};
const ganz = (w: unknown, name: string, min: number, max: number, standard?: number) => {
	if ((w === undefined || w === null || w === '') && standard !== undefined) return standard;
	const n = typeof w === 'number' ? w : typeof w === 'string' && /^\s*\d+\s*$/.test(w) ? Number(w) : NaN;
	if (!Number.isInteger(n) || n < min || n > max) throw new ApiFehler(400, `${name}: Bitte eine Zahl von ${min} bis ${max}.`);
	return n;
};
const bool = (w: unknown) => w === true || w === 'true' || w === 'on' || w === '1';

// ——— Einstellungen: Mail-Vorlagen, Signatur, Stufen ———

const STUFE_SPALTEN = `id, art, pos, tage, todo, mail, todo_titel, mail_vorlage_id, zuweisung, benutzer_id, rolle_id, faellig_versatz, mahnstufe, aktiv`;
const zuStufe = (z: Record<string, any>): NachfassStufe => ({
	id: z.id,
	art: z.art,
	pos: z.pos,
	tage: z.tage,
	todo: z.todo,
	mail: z.mail,
	todoTitel: z.todo_titel ?? null,
	mailVorlageId: z.mail_vorlage_id ?? null,
	zuweisung: z.zuweisung,
	benutzerId: z.benutzer_id ?? null,
	rolleId: z.rolle_id ?? null,
	faelligVersatz: z.faellig_versatz,
	mahnstufe: z.mahnstufe ?? null,
	aktiv: z.aktiv
});

export async function listeStufen(k: Kontext, art?: NachfassArt): Promise<NachfassStufe[]> {
	return mitBetrieb(k, async (tx) =>
		(
			await tx`
				select ${tx.unsafe(STUFE_SPALTEN)} from app.nachfass_stufen
				where betrieb_id = ${k.betriebId} ${art ? tx`and art = ${art}` : tx``}
				order by art, tage, pos, id`
		).map(zuStufe)
	);
}

function pruefeStufe(e: Record<string, unknown>) {
	if (!(NACHFASS_ARTEN as readonly unknown[]).includes(e.art)) throw new ApiFehler(400, 'Art: Angebot oder Rechnung wählen.');
	if (!(ZUWEISUNGEN as readonly unknown[]).includes(e.zuweisung ?? 'zustaendig')) throw new ApiFehler(400, 'Zuständig: Bitte eine Auswahl treffen.');
	const todo = bool(e.todo);
	const mail = bool(e.mail);
	if (!todo && !mail) throw new ApiFehler(400, 'Bitte „Aufgabe anlegen“, „Mail vorbereiten“ oder beides wählen.');
	const mailVorlageId = optId(e.mailVorlageId, 'Mail-Vorlage');
	if (mail && !mailVorlageId) throw new ApiFehler(400, 'Mail vorbereiten: Bitte eine Mail-Vorlage wählen.');
	const zuweisung = (e.zuweisung || 'zustaendig') as Zuweisung;
	const benutzerId = zuweisung === 'fest' ? optId(e.benutzerId, 'Mitarbeiter') : null;
	const rolleId = zuweisung === 'rolle' ? optId(e.rolleId, 'Rolle') : null;
	if (zuweisung === 'fest' && !benutzerId) throw new ApiFehler(400, 'Zuständig: Bitte einen Mitarbeiter wählen.');
	if (zuweisung === 'rolle' && !rolleId) throw new ApiFehler(400, 'Zuständig: Bitte eine Rolle wählen.');
	return {
		art: e.art as NachfassArt,
		tage: ganz(e.tage, 'Nach Tagen', 0, 365),
		todo,
		mail,
		todoTitel: textFeld(e.todoTitel, 'Aufgaben-Titel', 300),
		mailVorlageId,
		zuweisung,
		benutzerId,
		rolleId,
		faelligVersatz: ganz(e.faelligVersatz, 'Fällig nach', 0, 60, 0),
		mahnstufe: e.art === 'rechnung' && e.mahnstufe !== undefined && e.mahnstufe !== '' ? ganz(e.mahnstufe, 'Mahnstufe', 0, 3) : null,
		aktiv: e.aktiv === undefined || e.aktiv === '' ? true : bool(e.aktiv)
	};
}

async function pruefeBezuege(tx: TransactionSql, k: Kontext, w: ReturnType<typeof pruefeStufe>) {
	if (w.mailVorlageId) {
		const [v] = await tx`select 1 from app.mail_vorlagen where id = ${w.mailVorlageId} and betrieb_id = ${k.betriebId}`;
		if (!v) throw new ApiFehler(400, 'Mail-Vorlage nicht gefunden.');
	}
	if (w.benutzerId) {
		const [b] = await tx`select 1 from app.benutzer where id = ${w.benutzerId} and betrieb_id = ${k.betriebId}`;
		if (!b) throw new ApiFehler(400, 'Mitarbeiter nicht gefunden.');
	}
	if (w.rolleId) {
		const [r] = await tx`select 1 from app.rollen where id = ${w.rolleId} and betrieb_id = ${k.betriebId}`;
		if (!r) throw new ApiFehler(400, 'Rolle nicht gefunden.');
	}
}

export async function speichereStufe(k: Kontext, stufeId: unknown, e: Record<string, unknown>): Promise<NachfassStufe> {
	const w = pruefeStufe(e);
	return mitBetrieb(k, async (tx) => {
		await pruefeBezuege(tx, k, w);
		if (stufeId === null || stufeId === undefined || stufeId === '') {
			const [{ n }] = await tx`select count(*)::int as n from app.nachfass_stufen where betrieb_id = ${k.betriebId} and art = ${w.art}`;
			if (n >= MAX_STUFEN) throw new ApiFehler(400, `Höchstens ${MAX_STUFEN} Stufen je Art.`);
			const [z] = await tx`
				insert into app.nachfass_stufen (betrieb_id, art, pos, tage, todo, mail, todo_titel, mail_vorlage_id, zuweisung, benutzer_id,
					rolle_id, faellig_versatz, mahnstufe, aktiv)
				values (${k.betriebId}, ${w.art}, ${n}, ${w.tage}, ${w.todo}, ${w.mail}, ${w.todoTitel}, ${w.mailVorlageId}, ${w.zuweisung},
					${w.benutzerId}, ${w.rolleId}, ${w.faelligVersatz}, ${w.mahnstufe}, ${w.aktiv})
				returning ${tx.unsafe(STUFE_SPALTEN)}`;
			return zuStufe(z);
		}
		const [z] = await tx`
			update app.nachfass_stufen set tage = ${w.tage}, todo = ${w.todo}, mail = ${w.mail}, todo_titel = ${w.todoTitel},
				mail_vorlage_id = ${w.mailVorlageId}, zuweisung = ${w.zuweisung}, benutzer_id = ${w.benutzerId}, rolle_id = ${w.rolleId},
				faellig_versatz = ${w.faelligVersatz}, mahnstufe = ${w.mahnstufe}, aktiv = ${w.aktiv}
			where id = ${id(stufeId, 'Stufe')} and betrieb_id = ${k.betriebId} and art = ${w.art}
			returning ${tx.unsafe(STUFE_SPALTEN)}`;
		if (!z) throw nichtGefunden('Stufe');
		return zuStufe(z);
	});
}

export async function loescheStufe(k: Kontext, stufeId: unknown): Promise<void> {
	const sid = id(stufeId, 'Stufe');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.nachfass_stufen where id = ${sid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden('Stufe');
	});
}

/** „Standard übernehmen“: zwei Mail-Vorlagen und drei Angebots-Stufen (nur wenn es noch keine Angebots-Stufen gibt). */
export async function uebernimmStandard(k: Kontext): Promise<void> {
	await mitBetrieb(k, async (tx) => {
		const [da] = await tx`select 1 from app.nachfass_stufen where betrieb_id = ${k.betriebId} and art = 'angebot' limit 1`;
		if (da) throw new ApiFehler(409, 'Es gibt schon Stufen für Angebote.');
		const vorlagen = new Map<string, string>();
		for (const v of STANDARD_VORLAGEN) {
			// gleichnamige Vorlage (z. B. schon als Standard der Bibliothek angelegt) wiederverwenden
			const [da] = await tx`select id from app.mail_vorlagen where betrieb_id = ${k.betriebId} and zweck = 'nachfassen_angebot' and name = ${v.name} order by angelegt limit 1`;
			const [z] = da
				? [da]
				: await tx`
					insert into app.mail_vorlagen (betrieb_id, name, betreff, html, zweck) values (${k.betriebId}, ${v.name}, ${v.betreff}, ${v.html}, 'nachfassen_angebot') returning id`;
			vorlagen.set(v.schluessel, z.id);
		}
		// „Rolle“: die Chef-Rolle des Betriebs (Vorlage chef), sonst Zuständiger
		const [chef] = await tx`
			select id from app.rollen where betrieb_id = ${k.betriebId} and (vorlage = 'chef' or lower(btrim(name)) = 'chef')
			order by vorlage = 'chef' desc, name limit 1`;
		let pos = 0;
		for (const s of STANDARD_STUFEN) {
			const zuweisung = s.zuweisung === 'rolle' && !chef ? 'zustaendig' : s.zuweisung;
			await tx`
				insert into app.nachfass_stufen (betrieb_id, art, pos, tage, todo, mail, todo_titel, mail_vorlage_id, zuweisung, rolle_id)
				values (${k.betriebId}, 'angebot', ${pos++}, ${s.tage}, ${s.todo}, ${s.mail}, ${s.todoTitel},
					${s.vorlage ? vorlagen.get(s.vorlage)! : null}, ${zuweisung}, ${zuweisung === 'rolle' ? chef.id : null})`;
		}
	});
}

// ——— Lauf ———

function briefAnrede(z: Record<string, any>): string {
	if (z.kunde_art === 'firma') return 'Sehr geehrte Damen und Herren';
	const nach = z.kunde_nachname ?? '';
	if (z.kunde_anrede === 'Herr' && nach) return `Sehr geehrter Herr ${nach}`;
	if (z.kunde_anrede === 'Frau' && nach) return `Sehr geehrte Frau ${nach}`;
	const name = z.kunde_id ? [z.kunde_vorname, nach].filter(Boolean).join(' ') : (z.einmal_name ?? '');
	return name ? `Guten Tag ${name}` : 'Guten Tag';
}

/** Werte für die Platzhalter eines Angebots. */
async function werteFuer(k: Kontext, angebotId: string, versendetTag: string, heute: string, z: Record<string, any>) {
	const a = await holeAngebot(k, angebotId);
	const p = await holeProfil(k);
	const tage = Math.round((Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${versendetTag}T00:00:00Z`)) / 86_400_000);
	const web = p.web ? (/^https?:\/\//i.test(p.web) ? p.web : `https://${p.web}`) : '';
	return {
		werte: {
			'kunde.name': a.kundeName,
			'kunde.anrede': briefAnrede(z),
			'kunde.email': z.kunde_email ?? z.einmal_email ?? '',
			'angebot.nummer': a.nummer,
			'angebot.datum': tagDeutsch(a.datum),
			'angebot.gueltig_bis': tagDeutsch(a.gueltigBis),
			'auftrag.titel': a.auftragTitel ?? '',
			betrag: euro(a.bruttoCent),
			faellig_am: tagDeutsch(a.gueltigBis),
			tage: String(tage),
			link: web,
			'firma.name': p.firmenname ?? '',
			'firma.telefon': p.telefon ?? ''
		} as Record<string, string>,
		an: (z.kunde_email ?? z.einmal_email ?? null) as string | null,
		auftragId: a.auftragId
	};
}

/**
 * Beispieldaten für die Vorschau der Mail-Vorlagen (Wunsch Jamil msg 2670): feste Beispielwerte (mit Name und Telefon
 * des Betriebs) und die letzten Angebote des Betriebs zum Auswählen. Ohne „Preise sehen“ bleibt der Betrag ein Beispiel.
 */
export async function vorschauBeispiele(k: Kontext, mitPreisen: boolean, heute = berlinTag(new Date())): Promise<MailBeispiel[]> {
	const p = await holeProfil(k);
	const firma = {
		...(p.firmenname ? { 'firma.name': p.firmenname } : {}),
		...(p.telefon ? { 'firma.telefon': p.telefon } : {})
	};
	const liste: MailBeispiel[] = [{ id: 'beispiel', name: 'Beispieldaten (Familie Müller)', werte: { ...BEISPIEL_WERTE, ...firma } }];
	const zeilen = await mitBetrieb(k, (tx) => tx`
		select an.id, an.nummer, to_char(coalesce(an.versendet_am, an.angelegt) at time zone 'Europe/Berlin', 'YYYY-MM-DD') as versendet_tag,
			coalesce(an.kunde_id, a.kunde_id) as kunde_id, k.art as kunde_art, k.anrede as kunde_anrede, k.vorname as kunde_vorname,
			k.nachname as kunde_nachname, k.email as kunde_email, a.einmal_name, a.einmal_email
		from app.angebote an
		left join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
		left join app.kunden k on k.id = coalesce(an.kunde_id, a.kunde_id) and k.betrieb_id = an.betrieb_id
		where an.betrieb_id = ${k.betriebId}
		order by an.angelegt desc
		limit 15`);
	for (const z of zeilen) {
		const { werte } = await werteFuer(k, z.id, z.versendet_tag, heute, z);
		if (!mitPreisen) werte.betrag = BEISPIEL_WERTE.betrag;
		liste.push({ id: z.id, name: `${werte['angebot.nummer']} · ${werte['kunde.name'] || 'ohne Kunde'}`, werte });
	}
	return liste;
}

/** Zuständigen für die Aufgabe bestimmen (null, wenn niemand passt). */
async function zustaendigFuer(tx: TransactionSql, k: Kontext, s: NachfassStufe, auftragId: string | null): Promise<string | null> {
	if (s.zuweisung === 'fest' && s.benutzerId) {
		const [b] = await tx`select id from app.benutzer where id = ${s.benutzerId} and betrieb_id = ${k.betriebId} and aktiv`;
		return b?.id ?? null;
	}
	if (s.zuweisung === 'rolle' && s.rolleId) {
		const [b] = await tx`
			select id from app.benutzer where rolle_id = ${s.rolleId} and betrieb_id = ${k.betriebId} and aktiv
			order by public.unaccent(lower(name)), id limit 1`;
		return b?.id ?? null;
	}
	if (!auftragId) return null;
	const [b] = await tx`
		select b.id from app.auftrag_zustaendige z join app.benutzer b on b.id = z.benutzer_id and b.betrieb_id = z.betrieb_id
		where z.auftrag_id = ${auftragId} and z.betrieb_id = ${k.betriebId} and b.aktiv
		order by public.unaccent(lower(b.name)), b.id limit 1`;
	return b?.id ?? null;
}

/**
 * Nachfassen für den Betrieb prüfen und fällige Stufen anlegen. Liefert die Zahl neuer Läufe. Erledigt außerdem offene
 * Nachfass-Aufgaben angenommener/abgelehnter Angebote. `heute` nur für Tests.
 */
export async function pruefeNachfassen(k: Kontext, heute = berlinTag(new Date())): Promise<number> {
	const stufen = (await listeStufen(k, 'angebot')).filter((s) => s.aktiv);
	const [kandidaten, signatur, vorlagen] = await Promise.all([
		mitBetrieb(k, async (tx) => {
			// Stopp: angenommen/abgelehnt → offene Nachfass-Aufgaben erledigt
			await tx`
				update app.todos t set erledigt_am = now()
				from app.nachfass_laeufe l join app.angebote an on an.id = l.angebot_id and an.betrieb_id = l.betrieb_id
				where t.nachfass_id = l.id and t.betrieb_id = ${k.betriebId} and t.erledigt_am is null
					and an.status in ('angenommen', 'abgelehnt')`;
			if (stufen.length === 0) return [];
			return tx`
				select an.id, to_char(an.versendet_am at time zone 'Europe/Berlin', 'YYYY-MM-DD') as versendet_tag,
					coalesce(an.kunde_id, a.kunde_id) as kunde_id, k.art as kunde_art, k.anrede as kunde_anrede, k.vorname as kunde_vorname,
					k.nachname as kunde_nachname, k.email as kunde_email, a.einmal_name, a.einmal_email,
					coalesce((select array_agg(l.stufe_id::text) from app.nachfass_laeufe l where l.angebot_id = an.id and l.betrieb_id = an.betrieb_id), '{}') as gelaufen
				from app.angebote an
				left join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
				left join app.kunden k on k.id = coalesce(an.kunde_id, a.kunde_id) and k.betrieb_id = an.betrieb_id
				where an.betrieb_id = ${k.betriebId} and an.status = 'versendet' and not an.nachfassen_pausiert
					and an.versendet_am is not null and not coalesce(k.kein_nachfassen, false)
				order by an.versendet_am`;
		}),
		holeSignatur(k),
		stufen.some((s) => s.mail) ? listeMailVorlagen(k) : Promise.resolve([] as MailVorlage[])
	]);
	let neu = 0;
	for (const z of kandidaten) {
		const s = faelligeStufe(z.versendet_tag, heute, stufen, z.gelaufen as string[]);
		if (!s) continue;
		const { werte, an, auftragId } = await werteFuer(k, z.id, z.versendet_tag, heute, z);
		const vorlage = s.mail ? vorlagen.find((v) => v.id === s.mailVorlageId) : undefined;
		const mail = vorlage ? baueMail(vorlage, werte, signatur) : null;
		const html = mail?.html ?? null;
		const text = mail?.text ?? null;
		const betreff = mail?.betreff ?? null;
		const nr = stufen.findIndex((x) => x.id === s.id) + 1;
		const titel = fuelle(
			s.todo && s.todoTitel
				? s.todoTitel
				: s.mail && !s.todo
					? 'Nachfass-Mail senden: Angebot {{angebot.nummer}} ({{kunde.name}})'
					: 'Nachfassen: Angebot {{angebot.nummer}} ({{kunde.name}})',
			werte,
			false
		).slice(0, 200);
		neu += await mitBetrieb(k, async (tx) => {
			const [lauf] = await tx`
				insert into app.nachfass_laeufe (betrieb_id, angebot_id, stufe_id, stufe_nr, tage, mail_betreff, mail_html, mail_text, mail_an)
				values (${k.betriebId}, ${z.id}, ${s.id}, ${nr}, ${s.tage}, ${betreff}, ${html}, ${text}, ${an})
				on conflict (angebot_id, stufe_id) do nothing
				returning id`;
			if (!lauf) return 0; // gleichzeitig schon angelegt
			const zustaendig = await zustaendigFuer(tx, k, s, auftragId);
			const beschreibung = [
				`Nachfassen Stufe ${nr} (${s.tage} Tage nach Versand).`,
				s.mail ? 'Der Mailtext liegt fertig im Angebot unter „Nachfassen“ (Kopieren oder Mailprogramm).' : null
			]
				.filter(Boolean)
				.join(' ');
			const [t] = await tx`
				insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig, nachfass_id)
				values (${k.betriebId}, ${auftragId}, ${titel}, ${beschreibung}, ${zustaendig}, ${tagPlus(heute, s.faelligVersatz)}, ${lauf.id})
				returning id`;
			await tx`update app.nachfass_laeufe set todo_id = ${t.id} where id = ${lauf.id} and betrieb_id = ${k.betriebId}`;
			return 1;
		});
	}
	return neu;
}

const zuletzt = new Map<string, number>();
const ABSTAND_MS = 10 * 60_000;

/** Höchstens alle 10 Minuten je Betrieb; Fehler werden geloggt und brechen die Seite nie ab. */
export async function pruefeNachfassenGedrosselt(k: Kontext): Promise<void> {
	const jetzt = Date.now();
	if ((zuletzt.get(k.betriebId) ?? 0) > jetzt - ABSTAND_MS) return;
	zuletzt.set(k.betriebId, jetzt);
	try {
		await pruefeNachfassen(k);
	} catch (e) {
		console.error('Nachfassen fehlgeschlagen:', e);
	}
}
/** Nur Tests: Drossel zurücksetzen. */
export const setzeDrosselZurueck = () => zuletzt.clear();
/** Nach geänderten Einstellungen: beim nächsten Seitenaufruf gleich wieder prüfen. */
export const loeseDrossel = (betriebId: string) => zuletzt.delete(betriebId);

// ——— Angebot: Läufe ansehen, pausieren, als gesendet markieren ———

export async function nachfassenZumAngebot(k: Kontext, angebotId: string): Promise<{ pausiert: boolean; kundeAus: boolean; laeufe: NachfassLauf[] }> {
	const aid = id(angebotId, 'Angebot');
	return mitBetrieb(k, async (tx) => {
		const [a] = await tx`
			select an.nachfassen_pausiert, coalesce(k.kein_nachfassen, false) as kunde_aus
			from app.angebote an left join app.auftraege au on au.id = an.auftrag_id and au.betrieb_id = an.betrieb_id
			left join app.kunden k on k.id = coalesce(an.kunde_id, au.kunde_id) and k.betrieb_id = an.betrieb_id
			where an.id = ${aid} and an.betrieb_id = ${k.betriebId}`;
		if (!a) throw nichtGefunden('Angebot');
		const z = await tx`
			select l.id, l.angebot_id, l.stufe_nr, l.tage, l.todo_id, t.erledigt_am is not null as todo_erledigt, b.name as zustaendig_name,
				l.mail_betreff, l.mail_html, l.mail_text, l.mail_an, l.gesendet_am, l.angelegt
			from app.nachfass_laeufe l
			left join app.todos t on t.id = l.todo_id and t.betrieb_id = l.betrieb_id
			left join app.benutzer b on b.id = t.zustaendig_id and b.betrieb_id = t.betrieb_id
			where l.angebot_id = ${aid} and l.betrieb_id = ${k.betriebId} order by l.angelegt, l.id`;
		return {
			pausiert: a.nachfassen_pausiert,
			kundeAus: a.kunde_aus,
			laeufe: z.map((r) => ({
				id: r.id,
				angebotId: r.angebot_id,
				stufeNr: r.stufe_nr,
				tage: r.tage,
				todoId: r.todo_id,
				todoErledigt: !!r.todo_erledigt,
				zustaendigName: r.zustaendig_name ?? null,
				mailBetreff: r.mail_betreff,
				mailHtml: r.mail_html,
				mailText: r.mail_text,
				mailAn: r.mail_an,
				gesendetAm: r.gesendet_am ? new Date(r.gesendet_am).toISOString() : null,
				angelegt: new Date(r.angelegt).toISOString()
			}))
		};
	});
}

export async function setzeNachfassenPausiert(k: Kontext, angebotId: unknown, pausiert: boolean): Promise<void> {
	const aid = id(angebotId, 'Angebot');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`update app.angebote set nachfassen_pausiert = ${pausiert} where id = ${aid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden('Angebot');
	});
}

export async function setzeKundeKeinNachfassen(k: Kontext, kundeId: unknown, aus: boolean): Promise<void> {
	const kid = id(kundeId, 'Kunde');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`update app.kunden set kein_nachfassen = ${aus} where id = ${kid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden('Kunde');
	});
}

/** Mail von Hand als gesendet markieren (z. B. nach „In Mailprogramm öffnen“); das zugehörige Aufgabe wird erledigt. */
export async function markiereGesendet(k: Kontext, angebotId: unknown, laufId: unknown): Promise<void> {
	const aid = id(angebotId, 'Angebot');
	const lid = id(laufId, 'Nachfass-Lauf');
	await mitBetrieb(k, async (tx) => {
		const [l] = await tx`
			update app.nachfass_laeufe set gesendet_am = coalesce(gesendet_am, now())
			where id = ${lid} and angebot_id = ${aid} and betrieb_id = ${k.betriebId}
			returning todo_id`;
		if (!l) throw nichtGefunden('Nachfass-Lauf');
		if (l.todo_id) await tx`update app.todos set erledigt_am = coalesce(erledigt_am, now()) where id = ${l.todo_id} and betrieb_id = ${k.betriebId}`;
	});
}

/** Rollen zur Auswahl „Zuständig: Rolle“. */
export async function rollenAuswahl(k: Kontext): Promise<{ id: string; name: string }[]> {
	return mitBetrieb(k, async (tx) =>
		(await tx`select id, name from app.rollen where betrieb_id = ${k.betriebId} order by public.unaccent(lower(name)), id`).map((r) => ({ id: r.id, name: r.name }))
	);
}

/** „Kein automatisches Nachfassen“ beim Kunden? (fremd/unbekannt → false) */
export async function kundeKeinNachfassen(k: Kontext, kundeId: string): Promise<boolean> {
	if (!UUID.test(kundeId)) return false;
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`select kein_nachfassen from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId}`;
		return !!z?.kein_nachfassen;
	});
}
