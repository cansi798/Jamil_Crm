-- AGB als PDF im Kundenportal (Wunsch Jamil, Talk msg 3030): je Betrieb ein AGB-PDF (wie das Logo in der Datenbank,
-- keine Datei auf Platte). Die Fassung ist über den SHA-256-Hash und den Zeitpunkt des Hochladens bestimmt; bei der
-- Annahme eines Angebots wird genau diese Fassung im Nachweis (angebot_entscheidungen) festgehalten.

alter table app.portal_einstellungen
	add column if not exists agb_pdf bytea,
	add column if not exists agb_pdf_hash text check (agb_pdf_hash ~ '^[0-9a-f]{64}$'),
	add column if not exists agb_pdf_hochgeladen timestamptz,
	add constraint portal_agb_pdf check ((agb_pdf is null) = (agb_pdf_hash is null) and octet_length(agb_pdf) <= 5242880);
grant insert (agb_pdf, agb_pdf_hash, agb_pdf_hochgeladen) on app.portal_einstellungen to crm_app;
grant update (agb_pdf, agb_pdf_hash, agb_pdf_hochgeladen) on app.portal_einstellungen to crm_app;

-- PDF-Bytes nie ins Änderungsprotokoll (Hash und Zeitpunkt zeigen den Wechsel)
drop trigger portal_einstellungen_protokoll on app.portal_einstellungen;
create trigger portal_einstellungen_protokoll after insert or update or delete on app.portal_einstellungen
	for each row execute function app.protokolliere('geaendert', 'agb_pdf');

-- Nachweis der Annahme: welche AGB-Fassung (Hash + Stand) der Kunde bestätigt hat
alter table app.angebot_entscheidungen
	add column if not exists agb_pdf_hash text check (agb_pdf_hash ~ '^[0-9a-f]{64}$'),
	add column if not exists agb_pdf_stand timestamptz;
grant insert (agb_pdf_hash, agb_pdf_stand) on app.angebot_entscheidungen to crm_app;
