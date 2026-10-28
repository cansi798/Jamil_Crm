-- Kundenportal: Antworten von Jamil auf die offenen Punkte vom 27.10. (Talk msg 3521)
--
-- B) Karte „Leistungen für Bestandskunden“: ab welchem Auftragsstatus sie erscheint – oder immer.
--    portal_einstellungen.bestand_ab: 'immer' oder ein Auftragsstatus; Standard 'abgerechnet' = bisheriges Verhalten.
-- C) Die Karte ist je Kunde ein-/ausschaltbar: kunden_portal.bestand (NULL = wie die Firma, bestand_aktiv).
-- D) „Namen der Mitarbeiter zeigen: nein“ blendet auf Wunsch auch den Projektbegleiter (Ansprechpartner) aus:
--    portal_einstellungen.ap_ausblenden (Standard aus = bisheriges Verhalten), je Kunde kunden_portal.ap_ausblenden
--    (NULL = wie die Firma).
-- Keine Datenänderung nötig: die Standardwerte entsprechen dem bisherigen Verhalten.

alter table app.portal_einstellungen
	add column if not exists bestand_ab text not null default 'abgerechnet'
		check (bestand_ab in ('immer', 'anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet')),
	add column if not exists ap_ausblenden boolean not null default false;
grant insert (bestand_ab, ap_ausblenden) on app.portal_einstellungen to crm_app;
grant update (bestand_ab, ap_ausblenden) on app.portal_einstellungen to crm_app;

alter table app.kunden_portal
	add column if not exists bestand boolean,
	add column if not exists ap_ausblenden boolean;
grant insert (bestand, ap_ausblenden) on app.kunden_portal to crm_app;
grant update (bestand, ap_ausblenden) on app.kunden_portal to crm_app;
