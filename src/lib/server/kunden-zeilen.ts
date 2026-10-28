/**
 * Mehr Infos direkt in der Zeile der Kundenliste (Jamil, Talk msg 3522): letztes Angebot (offen/angenommen/abgelehnt/abgelaufen mit
 * Datum), Kundenportal (aktiv? Passwort? wie oft geöffnet, zuletzt wann) und als Ergänzungen offene Aufträge, nächster Termin und
 * „Bestandskunde“. EINE Abfrage für alle Zeilen einer Seite (kein N+1), immer im Kontext des eigenen Betriebs (RLS + Filter).
 *
 * Datenschutz: Für die Portal-Öffnungen gibt es keine neue Erfassung – gezählt wird, was es schon gibt: je Portal-Link ein Zähler
 * und der Zeitpunkt des letzten Aufrufs (`portal_links.zugriffe`, `letzter_zugriff`), keine IP-Adressen, kein Bewegungsprofil.
 */
import { mitBetrieb, type Kontext } from './db';
import type { KundenZeilenRechte, KundenZeilenInfo } from '../kunden-zeilen';

export async function kundenZeilenInfo(k: Kontext, ids: string[], r: KundenZeilenRechte): Promise<Map<string, KundenZeilenInfo>> {
	const ergebnis = new Map<string, KundenZeilenInfo>();
	if (ids.length === 0 || !(r.auftraege || r.angebote || r.portal)) return ergebnis;
	const zeilen = await mitBetrieb(k, (tx) => tx`
		select kd.id,
			${r.auftraege ? tx`
				(select count(*)::int from app.auftraege a where a.kunde_id = kd.id and a.betrieb_id = kd.betrieb_id and a.status <> 'abgerechnet') as offen,
				exists (select 1 from app.auftraege a where a.kunde_id = kd.id and a.betrieb_id = kd.betrieb_id and a.status = 'abgerechnet') as bestand,
				(select min(e.beginn) from app.einsaetze e join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
					where a.kunde_id = kd.id and a.betrieb_id = kd.betrieb_id and e.ende >= now()) as termin,` : tx``}
			${r.angebote ? tx`
				(select json_build_object('status', an.status, 'tag',
						to_char((case when an.status = 'versendet' then coalesce(an.versendet_am, an.geaendert) else an.geaendert end) at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
						'abgelaufen', an.status = 'versendet' and an.gueltig_bis < (now() at time zone 'Europe/Berlin')::date)
					from app.angebote an
					left join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
					where an.betrieb_id = kd.betrieb_id and coalesce(an.kunde_id, a.kunde_id) = kd.id
						and an.status in ('versendet', 'angenommen', 'abgelehnt')
						and not exists (select 1 from app.angebote n where n.vorgaenger_id = an.id and n.betrieb_id = an.betrieb_id)
					order by coalesce(an.versendet_am, an.geaendert) desc, an.id desc limit 1) as angebot,` : tx``}
			${r.portal ? tx`
				exists (select 1 from app.portal_links l where l.kunde_id = kd.id and l.betrieb_id = kd.betrieb_id
					and l.widerrufen_am is null and (l.laeuft_ab is null or l.laeuft_ab > now())) as portal_gueltig,
				exists (select 1 from app.portal_links l where l.kunde_id = kd.id and l.betrieb_id = kd.betrieb_id) as portal_je,
				(exists (select 1 from app.portal_passwoerter pw where pw.kunde_id = kd.id and pw.betrieb_id = kd.betrieb_id)
					or nullif(btrim(coalesce(kd.plz, '')), '') is not null) as portal_passwort,
				(select coalesce(sum(l.zugriffe), 0)::int from app.portal_links l where l.kunde_id = kd.id and l.betrieb_id = kd.betrieb_id) as portal_zugriffe,
				(select max(l.letzter_zugriff) from app.portal_links l where l.kunde_id = kd.id and l.betrieb_id = kd.betrieb_id) as portal_zuletzt,` : tx``}
			1 as ende
		from app.kunden kd
		where kd.betrieb_id = ${k.betriebId} and kd.id = any(${ids}::uuid[])`);
	for (const z of zeilen) {
		ergebnis.set(z.id, {
			auftraege: r.auftraege ? { offen: z.offen, bestandskunde: z.bestand === true, naechsterTermin: z.termin ? new Date(z.termin).toISOString() : null } : null,
			angebot: r.angebote && z.angebot ? { status: z.angebot.status, tag: z.angebot.tag, abgelaufen: z.angebot.abgelaufen === true } : null,
			angebotSichtbar: r.angebote,
			portal: r.portal
				? {
						gueltig: z.portal_gueltig === true,
						jeEinLink: z.portal_je === true,
						passwort: z.portal_passwort === true,
						zugriffe: z.portal_zugriffe,
						zuletzt: z.portal_zuletzt ? new Date(z.portal_zuletzt).toISOString() : null
					}
				: null
		});
	}
	return ergebnis;
}
