-- Dokumente und Notizen direkt im Auftrag, je Eintrag „Im Kundenportal sichtbar“ (Wunsch Jamil, Talk msg 3070).
--
-- 1. Dateien merken sich, wer sie hochgeladen hat (Anzeige „von …“, Löschen der eigenen Einträge).
-- 2. Notizen lassen sich wie Dateien/Angebote über portal_dokumente fürs Kundenportal freigeben (Art „notiz“).
--    Standard bleibt: nichts ist im Portal, bis es ausdrücklich freigegeben wird.

alter table app.dateien
	add column von_benutzer_id uuid,
	add constraint dateien_von_fk foreign key (von_benutzer_id, betrieb_id)
		references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id);
grant insert (von_benutzer_id) on app.dateien to crm_app;

alter table app.portal_dokumente drop constraint portal_dokumente_art_check;
alter table app.portal_dokumente add constraint portal_dokumente_art_check
	check (art in ('angebot', 'protokoll', 'datei', 'notiz'));

-- Freigabe verschwindet mit der Notiz bzw. Datei (sonst bliebe ein verwaister Eintrag)
create function app.portal_freigabe_aufraeumen() returns trigger language plpgsql as $$
begin
	delete from app.portal_dokumente
	where betrieb_id = old.betrieb_id and ref_id = old.id
		and art = case tg_table_name when 'notizen' then 'notiz' else 'datei' end;
	return old;
end $$;
create trigger notizen_portal_aufraeumen after delete on app.notizen
	for each row execute function app.portal_freigabe_aufraeumen();
create trigger dateien_portal_aufraeumen after delete on app.dateien
	for each row execute function app.portal_freigabe_aufraeumen();
