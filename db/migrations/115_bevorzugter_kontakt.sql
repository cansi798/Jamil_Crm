-- Bevorzugter Kommunikationsweg am Kunden (Wunsch Jamil, Talk msgs 4289/4291, 02.11.2026):
-- „Bevorzugter Kommunikationsweg: E-Mail, Chat, Telefon – diese Auswahl ist möglich.“
--
-- * Freiwillig: NULL = keine Angabe (alle bestehenden Kunden bleiben so, nichts wird geraten).
-- * Text mit CHECK statt Enum – wie art/status in den übrigen Tabellen; neue Wege später per Migration erweiterbar.
-- * Spaltenrecht für crm_app wie bei den übrigen Kundenfeldern (Migration 007): ändern darf nur, wer den Kunden ändern
--   darf (Recht „kunden.bearbeiten“ prüft die App), und nur im eigenen Betrieb (RLS kunden_mandant gilt unverändert).
-- * Änderungsprotokoll: der Trigger kunden_protokoll (app.protokolliere) schreibt ganze Zeilen – die neue Spalte steht
--   automatisch im Vorher/Nachher; nichts weiter nötig.
alter table app.kunden add column bevorzugter_kontakt text
	constraint kunden_bevorzugter_kontakt check (bevorzugter_kontakt in ('email', 'chat', 'telefon'));

grant update (bevorzugter_kontakt) on app.kunden to crm_app;
