-- Wunsch Jamil (19.10.2026), Phase 3: Aufträge ohne Kunden oder mit Einmal-Kunden.
--
-- Ein Auftrag hat entweder einen Kunden aus der Kundendatenbank (kunde_id), einen Einmal-Kunden (nur am Auftrag
-- gespeichert: einmal_name + optional Kontakt/Adresse – nicht in app.kunden) oder gar keinen Kunden. Ein Objekt gibt es
-- nur mit Kunde. Der zusammengesetzte Fremdschlüssel (kunde_id, betrieb_id) prüft bei kunde_id = NULL nichts (MATCH
-- SIMPLE) – genau so gewollt.

alter table app.auftraege alter column kunde_id drop not null;

alter table app.auftraege
	add column einmal_name text,
	add column einmal_telefon text,
	add column einmal_email text,
	add column einmal_strasse text,
	add column einmal_plz text,
	add column einmal_ort text;

alter table app.auftraege
	add constraint auftraege_einmal_laengen check (
		char_length(btrim(einmal_name)) between 1 and 200 and char_length(einmal_telefon) <= 50
		and char_length(einmal_email) <= 200 and char_length(einmal_strasse) <= 200 and char_length(einmal_plz) <= 20
		and char_length(einmal_ort) <= 200
	),
	-- Einmal-Kunde nur ohne Kunden; Kontaktangaben nur mit Namen
	add constraint auftraege_einmal_oder_kunde check (kunde_id is null or einmal_name is null),
	add constraint auftraege_einmal_nur_mit_name check (
		einmal_name is not null
		or (einmal_telefon is null and einmal_email is null and einmal_strasse is null and einmal_plz is null and einmal_ort is null)
	),
	add constraint auftraege_objekt_nur_mit_kunde check (objekt_id is null or kunde_id is not null);

grant insert (einmal_name, einmal_telefon, einmal_email, einmal_strasse, einmal_plz, einmal_ort) on app.auftraege to crm_app;
grant update (einmal_name, einmal_telefon, einmal_email, einmal_strasse, einmal_plz, einmal_ort) on app.auftraege to crm_app;
