-- Kundenportal mit Passwort und wieder öffnebarem Link (Wunsch Jamil, Talk msgs 3035–3037).
--
-- 1. `portal_links.token_geheim`: das Token zusätzlich VERSCHLÜSSELT (AES-256-GCM mit CRM_PORTAL_GEHEIMNIS), nur damit
--    berechtigte Mitarbeiter den aktiven Link wieder öffnen/kopieren können. Gesucht wird weiter nur über token_hash.
--    Alte Links (vor diesem Update) haben nur den Hash – für sie muss einmal ein neuer Link erzeugt werden.
-- 2. `portal_passwoerter`: eigenes Portal-Passwort je Kunde (Argon2id-Hash). Ohne Eintrag gilt die PLZ des Kunden.
-- 3. Zugriffsprotokoll: Anmeldungen und Fehlversuche im Portal (ohne Passwort, nur Zeit und IP-Hash).

alter table app.portal_links
	add column token_geheim bytea check (token_geheim is null or octet_length(token_geheim) between 29 and 200);
grant insert (token_geheim) on app.portal_links to crm_app;

-- Verschlüsseltes Token nicht ins Änderungsprotokoll
drop trigger portal_links_protokoll on app.portal_links;
create trigger portal_links_protokoll after insert or update or delete on app.portal_links
	for each row execute function app.protokolliere('token_hash', 'token_geheim', 'letzter_zugriff', 'zugriffe');

create table app.portal_passwoerter (
	-- eigene ID fürs Änderungsprotokoll (datensatz_id)
	id uuid not null default gen_random_uuid() unique,
	kunde_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	passwort_hash text not null check (char_length(passwort_hash) between 20 and 300),
	geaendert timestamptz not null default now(),
	geaendert_von uuid,
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id) on delete cascade
);

revoke all on app.portal_passwoerter from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.portal_passwoerter to crm_app;
grant insert (kunde_id, betrieb_id, passwort_hash, geaendert_von) on app.portal_passwoerter to crm_app;
grant update (passwort_hash, geaendert, geaendert_von) on app.portal_passwoerter to crm_app;

alter table app.portal_passwoerter enable row level security;
alter table app.portal_passwoerter force row level security;
create policy portal_passwoerter_mandant on app.portal_passwoerter
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Verlauf: wann/wer das Passwort gesetzt hat – nie der Hash
create trigger portal_passwoerter_protokoll after insert or update or delete on app.portal_passwoerter
	for each row execute function app.protokolliere('passwort_hash');

alter table app.portal_ereignisse drop constraint portal_ereignisse_art_check;
alter table app.portal_ereignisse add constraint portal_ereignisse_art_check
	check (art in ('aufruf', 'dokument', 'angenommen', 'abgelehnt', 'anmeldung', 'anmeldung_fehler'));
