-- Kalkulation wirkt in Katalog und Angeboten (Wunsch Jamil, msg 2476 – „was geht ohne Zeiterfassung“):
--   – Katalog: Arbeitszeit in Minuten je Einheit → Lohn = Minuten × Stundensatz (Vorschlag) und Prüfung, welche
--     Positionen unter dem kostendeckenden Satz liegen.
--   – Angebotspositionen: Arbeitszeit (Minuten je Einheit) und Materialanteil (Cent je Einheit) – beides aus dem
--     Katalog übernommen, Arbeitszeit änderbar – für Ampel und erwarteten Gewinn je Angebot.
-- Ohne Angabe (NULL): bei Einheit „h“ gilt 60 Minuten je Einheit, sonst ist die Arbeitszeit unbekannt.

alter table app.katalog_positionen add column arbeit_minuten numeric(8, 2) check (arbeit_minuten between 0 and 100000);
grant insert (arbeit_minuten) on app.katalog_positionen to crm_app;
grant update (arbeit_minuten) on app.katalog_positionen to crm_app;

alter table app.angebot_positionen
	add column arbeit_minuten numeric(8, 2) check (arbeit_minuten between 0 and 100000),
	add column material_cent bigint check (material_cent between 0 and 1000000000);
grant insert (arbeit_minuten, material_cent) on app.angebot_positionen to crm_app;
grant update (arbeit_minuten, material_cent) on app.angebot_positionen to crm_app;
