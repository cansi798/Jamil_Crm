-- Ablauf je Auftragsquelle (Jamil, Talk msg 3703; Konzept docs/konzept-anfragequellen.md, Etappe 2): je Quelle kann jeder
-- Schritt der Statuskette „gilt“ oder „überspringen“. Die Schritte sind die offenen Untergruppen
-- (src/lib/auftrag-board.ts, ABLAUF_SCHRITTE). Gespeichert werden nur die ÜBERSPRUNGENEN; leer = alles gilt = genau das
-- bisherige Verhalten. Bestehende Quellen und Aufträge ändern sich durch diese Migration nicht.
-- Änderungen landen über den vorhandenen Trigger auftrag_quellen_protokoll im Änderungsprotokoll; RLS wie gehabt.

alter table app.auftrag_quellen add column uebersprungen text[] not null default '{}'
	check (uebersprungen <@ array['neu', 'ohne_angebot', 'planung', 'arbeiten', 'qualitaet', 'abnahme']::text[]);
grant update (uebersprungen) on app.auftrag_quellen to crm_app;

-- Neue Aufträge einer Quelle, die „Anfrage“ überspringt, beginnen im ersten geltenden Status (Anwendung setzt ihn)
grant insert (status) on app.auftraege to crm_app;
