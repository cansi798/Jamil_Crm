-- Rollen und Schema `app`.
-- Rollen sind clusterweit (gemeinsam für die Datenbanken crm und crm_test) und werden idempotent angelegt.
-- Passwörter stehen nicht hier, sondern werden vom Migrations-Runner (scripts/migrate.ts) gesetzt.

do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'crm_app') then
		create role crm_app login nosuperuser nobypassrls nocreatedb nocreaterole;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'crm_admin') then
		create role crm_admin login nosuperuser nobypassrls nocreatedb nocreaterole;
	end if;
	-- crm_auth: ruft ausschließlich die Anmelde-/Sitzungsfunktionen (app.anmeldung_finden usw.) auf, hat keine Tabellenrechte.
	if not exists (select 1 from pg_roles where rolname = 'crm_auth') then
		create role crm_auth login nosuperuser nobypassrls nocreatedb nocreaterole;
	end if;
end
$$;

-- Falls die Rollen früher anders angelegt wurden: Einschränkungen erzwingen.
alter role crm_app login nosuperuser nobypassrls nocreatedb nocreaterole;
alter role crm_admin login nosuperuser nobypassrls nocreatedb nocreaterole;
alter role crm_auth login nosuperuser nobypassrls nocreatedb nocreaterole;

-- Verbindungsrecht auf die gerade migrierte Datenbank (crm oder crm_test).
do $$
begin
	execute format('grant connect on database %I to crm_app, crm_admin, crm_auth', current_database());
end
$$;

create schema if not exists app authorization crm;
grant usage on schema app to crm_app, crm_admin, crm_auth;
