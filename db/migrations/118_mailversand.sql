-- Mailversand per SMTP (Plan „Lexware als Belegsystem“, Abschnitt 5 / Task T1; Jamil Talk #6093: Postfach kommt noch →
-- vorbereitet, aber AUS bis der Betrieb es einrichtet).
--
-- 1. app.mail_konfig: Postfach je Betrieb. Das Passwort liegt AES-256-GCM-verschlüsselt (CRM_GEHEIMNIS_SCHLUESSEL, nur
--    in der Umgebung) in `passwort`. crm_app darf es schreiben, aber NICHT lesen – gelesen wird es nur über
--    app.mail_zugang() (SECURITY DEFINER, nur crm_auth), direkt vor dem Senden.
-- 2. app.mail_ausgang: Versandprotokoll (Geschäftsbriefe, 6 Jahre aufbewahren). Anhänge nur als Name, Größe und SHA-256.

create table app.mail_konfig (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	id uuid not null default gen_random_uuid() unique,
	aktiv boolean not null default false,
	host text check (char_length(host) <= 253),
	port integer check (port between 1 and 65535),
	sicherheit text not null default 'starttls' check (sicherheit in ('starttls', 'ssl', 'keine')),
	benutzer text check (char_length(benutzer) <= 254),
	passwort bytea check (octet_length(passwort) <= 2000),
	passwort_hinweis text check (char_length(passwort_hinweis) <= 10),
	absender_name text check (char_length(absender_name) <= 200),
	absender_adresse public.citext check (char_length(absender_adresse::text) <= 254),
	antwort_an public.citext check (char_length(antwort_an::text) <= 254),
	bcc public.citext check (char_length(bcc::text) <= 254),
	geaendert timestamptz not null default now(),
	geaendert_von uuid,
	-- Einschalten nur mit vollständigem Postfach
	constraint mail_konfig_vollstaendig check (not aktiv or (host is not null and port is not null and absender_adresse is not null))
);

revoke all on app.mail_konfig from public, crm_app, crm_admin, crm_auth;
grant select (betrieb_id, id, aktiv, host, port, sicherheit, benutzer, passwort_hinweis, absender_name, absender_adresse,
	antwort_an, bcc, geaendert, geaendert_von) on app.mail_konfig to crm_app;
grant insert (betrieb_id, aktiv, host, port, sicherheit, benutzer, passwort, passwort_hinweis, absender_name, absender_adresse,
	antwort_an, bcc, geaendert_von) on app.mail_konfig to crm_app;
grant update (aktiv, host, port, sicherheit, benutzer, passwort, passwort_hinweis, absender_name, absender_adresse, antwort_an,
	bcc, geaendert_von) on app.mail_konfig to crm_app;
alter table app.mail_konfig enable row level security;
alter table app.mail_konfig force row level security;
create policy mail_konfig_mandant on app.mail_konfig for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create trigger mail_konfig_geaendert before update on app.mail_konfig
	for each row execute function app.setze_geaendert();
-- Wer hat das Postfach geändert? (ohne das Passwort-Chiffrat)
create trigger mail_konfig_protokoll after insert or update or delete on app.mail_konfig
	for each row execute function app.protokolliere('geaendert', 'passwort');

create table app.mail_ausgang (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	art text not null check (art in ('angebot', 'ab', 'rechnung', 'erinnerung', 'mahnung', 'nachfassen', 'protokoll', 'buchung', 'test', 'sonstiges')),
	an text not null check (char_length(an) between 3 and 1000),
	cc text check (char_length(cc) <= 1000),
	bcc text check (char_length(bcc) <= 1000),
	betreff text not null check (char_length(betreff) <= 300),
	bezug_typ text check (bezug_typ in ('angebot', 'auftrag', 'auftragsbestaetigung', 'kunde', 'buchung', 'protokoll', 'lexware_beleg')),
	bezug_id uuid,
	lexware_id uuid,
	status text not null default 'wartet' check (status in ('wartet', 'gesendet', 'fehler', 'kein_versand')),
	message_id text check (char_length(message_id) <= 300),
	versuche integer not null default 0 check (versuche between 0 and 100),
	fehler text check (char_length(fehler) <= 1000),
	anhaenge jsonb not null default '[]' check (jsonb_typeof(anhaenge) = 'array'),
	von_benutzer uuid,
	angelegt timestamptz not null default now(),
	gesendet_am timestamptz,
	unique (id, betrieb_id)
);
create index mail_ausgang_betrieb_idx on app.mail_ausgang (betrieb_id, angelegt desc);
create index mail_ausgang_bezug_idx on app.mail_ausgang (betrieb_id, bezug_typ, bezug_id);

revoke all on app.mail_ausgang from public, crm_app, crm_admin, crm_auth;
grant select on app.mail_ausgang to crm_app;
grant insert (betrieb_id, art, an, cc, bcc, betreff, bezug_typ, bezug_id, lexware_id, status, anhaenge, von_benutzer) on app.mail_ausgang to crm_app;
grant update (status, message_id, versuche, fehler, gesendet_am) on app.mail_ausgang to crm_app;
alter table app.mail_ausgang enable row level security;
alter table app.mail_ausgang force row level security;
create policy mail_ausgang_mandant on app.mail_ausgang for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Postfach inkl. Passwort-Chiffrat zum Senden (nur der Server, als crm_auth; entschlüsselt wird in der Anwendung).
create function app.mail_zugang(p_betrieb uuid)
returns table (aktiv boolean, host text, port integer, sicherheit text, benutzer text, passwort bytea, absender_name text,
	absender_adresse text, antwort_an text, bcc text)
language sql stable security definer set search_path = app, pg_temp as $$
	select m.aktiv, m.host, m.port, m.sicherheit, m.benutzer, m.passwort, m.absender_name, m.absender_adresse::text,
		m.antwort_an::text, m.bcc::text
	from app.mail_konfig m join app.betriebe b on b.id = m.betrieb_id
	where m.betrieb_id = p_betrieb and b.abo_status <> 'gesperrt';
$$;
revoke all on function app.mail_zugang(uuid) from public, crm_app, crm_admin;
grant execute on function app.mail_zugang(uuid) to crm_auth;
