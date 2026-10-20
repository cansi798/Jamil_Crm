import { mitBetrieb, OEFFENTLICH, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { ladePdfDaten } from './angebote';
import { holeLogo, holeProfil } from './betriebsprofil';
import { angebotPdf } from './pdf/angebot-pdf';
import { mailVersand } from './nachfassen';
import { UUID } from './kunden';
import { berlinTag } from '../zeit';
import type { AngebotAngenommen } from './ereignisse';

/**
 * Auftragsbestätigung (Jamil msg 2778): Sobald ein Angebot „angenommen“ ist – egal ob im Kundenportal, von Hand im
 * Büro oder per Sprache –, entsteht automatisch ein PDF aus den Angebotsdaten mit Titel „Auftragsbestätigung“ und
 * eigener Nummer (AB-JJJJ-NNNN), gespeichert am Auftrag und sofort im Kundenportal sichtbar. Versand über die
 * Mail-Schnittstelle (`mailVersand`); solange keine angebunden ist, steht sie „bereit zum Versand“ – mit Aufgabe und
 * Glocke für den Zuständigen und den Knöpfen „PDF herunterladen“ / „In Mailprogramm öffnen“.
 * Schalter „Auftragsbestätigung automatisch“: je Betrieb (Kundenportal-Einstellungen), je Auftrag überschreibbar.
 */

export type Auftragsbestaetigung = {
	id: string;
	angebotId: string;
	auftragId: string | null;
	nummer: string;
	versandStatus: 'bereit' | 'gesendet';
	mailAn: string | null;
	mailBetreff: string | null;
	mailText: string | null;
	versendetAm: string | null;
	angelegt: string;
};

const zu = (z: Record<string, any>): Auftragsbestaetigung => ({
	id: z.id,
	angebotId: z.angebot_id,
	auftragId: z.auftrag_id,
	nummer: z.nummer,
	versandStatus: z.versand_status,
	mailAn: z.mail_an,
	mailBetreff: z.mail_betreff,
	mailText: z.mail_text,
	versendetAm: z.versendet_am ? new Date(z.versendet_am).toISOString() : null,
	angelegt: new Date(z.angelegt).toISOString()
});

/** Ist die automatische Auftragsbestätigung für diesen Auftrag an? (Auftrag → Betrieb → Standard an) */
export async function abAutomatisch(tx: TransactionSql, k: Kontext, auftragId: string | null): Promise<boolean> {
	const [z] = await tx`
		select coalesce(
			(select a.ab_automatisch from app.auftraege a where a.id = ${auftragId} and a.betrieb_id = ${k.betriebId}),
			(select e.ab_automatisch from app.portal_einstellungen e where e.betrieb_id = ${k.betriebId}),
			true) as an`;
	return z.an === true;
}

async function naechsteNummer(tx: TransactionSql, k: Kontext): Promise<string> {
	await tx`select pg_advisory_xact_lock(hashtextextended(${'ab-nummer:' + k.betriebId}, 0))`;
	const jahr = berlinTag(new Date()).slice(0, 4);
	const [z] = await tx`
		select coalesce(max(substring(nummer from '^AB-\\d{4}-(\\d+)$')::int), 0) + 1 as nr
		from app.auftragsbestaetigungen where betrieb_id = ${k.betriebId} and nummer like ${`AB-${jahr}-%`}`;
	return `AB-${jahr}-${String(z.nr).padStart(4, '0')}`;
}

/** Wer bekommt Aufgabe und Glocke? Der Auslöser (wenn angemeldet), sonst der erste Zuständige, sonst wer Angebote bearbeitet. */
export async function zustaendig(tx: TransactionSql, k: Kontext, benutzerId: string | null, auftragId: string | null): Promise<string | null> {
	if (benutzerId) return benutzerId;
	if (auftragId) {
		const [z] = await tx`
			select b.id from app.auftrag_zustaendige z join app.benutzer b on b.id = z.benutzer_id and b.betrieb_id = z.betrieb_id
			where z.auftrag_id = ${auftragId} and z.betrieb_id = ${k.betriebId} and b.aktiv order by b.name, b.id limit 1`;
		if (z) return z.id;
	}
	const [b] = await tx`
		select b.id from app.benutzer b join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		where b.betrieb_id = ${k.betriebId} and b.aktiv and 'angebote.bearbeiten' = any (r.rechte) and 'preise.sehen' = any (r.rechte)
		order by ('einstellungen' = any (r.rechte)) desc, b.name, b.id limit 1`;
	return b?.id ?? null;
}

/**
 * Abonnent für `angebotAngenommen`: erzeugt genau eine Auftragsbestätigung je Angebot (zweite Annahme → nichts),
 * außer der Schalter ist aus. Liefert einen Hinweis für die Oberfläche.
 */
export async function beiAngebotAngenommen(e: AngebotAngenommen): Promise<string | void> {
	const k: Kontext = { betriebId: e.betriebId, benutzerId: e.benutzerId ?? OEFFENTLICH };
	const vorab = await mitBetrieb(k, async (tx) => {
		const [da] = await tx`select nummer from app.auftragsbestaetigungen where betrieb_id = ${k.betriebId} and angebot_id = ${e.angebotId}`;
		if (da) return { weiter: false as const };
		return { weiter: await abAutomatisch(tx, k, e.auftragId) };
	});
	if (!vorab.weiter) return;
	const [daten, profil, logo] = await Promise.all([ladePdfDaten(k, e.angebotId), holeProfil(k), holeLogo(k)]);
	return mitBetrieb(k, async (tx) => {
		const nummer = await naechsteNummer(tx, k);
		const heute = berlinTag(new Date());
		const firma = profil.firmenname ?? 'Ihr Handwerksbetrieb';
		const pdf = await angebotPdf({
			profil,
			logo,
			angebot: daten.angebot,
			kunde: daten.kunde,
			objekt: daten.objekt,
			als: {
				titel: 'Auftragsbestätigung',
				nummer,
				datum: heute,
				angenommenAm: heute,
				einleitung: `vielen Dank für Ihren Auftrag. Hiermit bestätigen wir die Annahme unseres Angebots ${daten.angebot.nummer} mit den folgenden Leistungen.`,
				schluss: 'Wir melden uns zur Terminabstimmung. Bei Fragen erreichen Sie uns jederzeit.'
			}
		});
		const [kd] = await tx`
			select coalesce(k.email::text, a.einmal_email::text) as email, a.titel
			from app.angebote an
			left join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
			left join app.kunden k on k.id = coalesce(an.kunde_id, a.kunde_id) and k.betrieb_id = an.betrieb_id
			where an.id = ${e.angebotId} and an.betrieb_id = ${k.betriebId}`;
		const betreff = `Auftragsbestätigung ${nummer}${kd?.titel ? ` – ${kd.titel}` : ''}`.slice(0, 300);
		const text = [
			`Guten Tag ${daten.kunde.name ?? ''},`.replace(/\s+,/, ','),
			'',
			`vielen Dank für Ihren Auftrag. Anbei erhalten Sie unsere Auftragsbestätigung ${nummer} zu unserem Angebot ${daten.angebot.nummer}.`,
			'',
			'Mit freundlichen Grüßen',
			firma
		].join('\n');
		const [ab] = await tx`
			insert into app.auftragsbestaetigungen (betrieb_id, angebot_id, auftrag_id, nummer, pdf, mail_an, mail_betreff, mail_text, ausloeser)
			values (${k.betriebId}, ${e.angebotId}, ${e.auftragId}, ${nummer}, ${Buffer.from(pdf)}, ${kd?.email ?? null}, ${betreff}, ${text}, ${e.quelle})
			returning id`;
		if (mailVersand.verbunden && kd?.email) {
			await mailVersand.senden({ an: kd.email, betreff, html: text.replace(/\n/g, '<br>'), text, anhaenge: [{ name: `${nummer}.pdf`, typ: 'application/pdf', bytes: pdf }] });
			await tx`update app.auftragsbestaetigungen set versand_status = 'gesendet', versendet_am = now() where id = ${ab.id} and betrieb_id = ${k.betriebId}`;
			return `Auftragsbestätigung ${nummer} erstellt und an ${kd.email} gesendet.`;
		}
		// Noch kein Mailversand: Aufgabe + Glocke für den Zuständigen
		const wer = await zustaendig(tx, k, e.benutzerId, e.auftragId);
		const [t] = await tx`
			insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig)
			values (${k.betriebId}, ${e.auftragId}, ${`Auftragsbestätigung ${nummer} an den Kunden senden`}, ${'Bereit zum Versand: im Auftrag „PDF herunterladen“ oder „In Mailprogramm öffnen“ (PDF anhängen), danach „Als gesendet markieren“.'}, ${wer}, ${heute})
			returning id`;
		await tx`update app.auftragsbestaetigungen set todo_id = ${t.id} where id = ${ab.id} and betrieb_id = ${k.betriebId}`;
		if (wer) {
			const link = e.auftragId ? `/auftraege/${e.auftragId}#auftragsbestaetigung` : `/angebote/${e.angebotId}`;
			const [er] = await tx`
				insert into app.erinnerungen (betrieb_id, benutzer_id, todo_id, zeitpunkt, titel, text, link)
				values (${k.betriebId}, ${wer}, ${t.id}, now(), ${`Angebot ${daten.angebot.nummer} angenommen`}, ${`Auftragsbestätigung ${nummer} ist bereit zum Versand.`}, ${link})
				returning id`;
			await tx`update app.erinnerungen set gesendet_am = now(), ergebnis = 'gesendet' where id = ${er.id} and betrieb_id = ${k.betriebId}`;
		}
		return `Auftragsbestätigung ${nummer} erstellt – bereit zum Versand.`;
	});
}

export async function listeAuftragsbestaetigungen(k: Kontext, auftragId: string): Promise<Auftragsbestaetigung[]> {
	const z = await mitBetrieb(k, (tx) => tx`
		select id, angebot_id, auftrag_id, nummer, versand_status, mail_an, mail_betreff, mail_text, versendet_am, angelegt
		from app.auftragsbestaetigungen where betrieb_id = ${k.betriebId} and auftrag_id = ${auftragId} order by angelegt`);
	return z.map(zu);
}

export async function abPdf(k: Kontext, id: unknown): Promise<{ nummer: string; pdf: Uint8Array; auftragId: string | null }> {
	if (typeof id !== 'string' || !UUID.test(id)) throw new ApiFehler(404, 'Auftragsbestätigung nicht gefunden.');
	const [z] = await mitBetrieb(k, (tx) => tx`select nummer, pdf, auftrag_id from app.auftragsbestaetigungen where id = ${id} and betrieb_id = ${k.betriebId}`);
	if (!z) throw new ApiFehler(404, 'Auftragsbestätigung nicht gefunden.');
	return { nummer: z.nummer, pdf: new Uint8Array(z.pdf), auftragId: z.auftrag_id };
}

/** Von Hand „gesendet“ (nach dem Mailprogramm); die Aufgabe wird erledigt. */
export async function markiereAbGesendet(k: Kontext, id: unknown): Promise<void> {
	if (typeof id !== 'string' || !UUID.test(id)) throw new ApiFehler(404, 'Auftragsbestätigung nicht gefunden.');
	await mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			update app.auftragsbestaetigungen set versand_status = 'gesendet', versendet_am = now()
			where id = ${id} and betrieb_id = ${k.betriebId} and versand_status = 'bereit' returning todo_id`;
		if (!z) throw new ApiFehler(404, 'Auftragsbestätigung nicht gefunden oder schon gesendet.');
		if (z.todo_id) await tx`update app.todos set erledigt_am = now() where id = ${z.todo_id} and betrieb_id = ${k.betriebId} and erledigt_am is null`;
	});
}

/** Schalter „Auftragsbestätigung automatisch“: Wert am Auftrag (null = wie im Betrieb) und Wert des Betriebs. */
export async function abEinstellung(k: Kontext, auftragId: string): Promise<{ auftrag: boolean | null; betrieb: boolean }> {
	const [z] = await mitBetrieb(k, (tx) => tx`
		select a.ab_automatisch as auftrag, coalesce(e.ab_automatisch, true) as betrieb
		from app.auftraege a left join app.portal_einstellungen e on e.betrieb_id = a.betrieb_id
		where a.id = ${auftragId} and a.betrieb_id = ${k.betriebId}`);
	return { auftrag: z?.auftrag ?? null, betrieb: z?.betrieb ?? true };
}
