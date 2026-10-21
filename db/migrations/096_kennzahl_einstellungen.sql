-- Kennzahlen je Betrieb einstellen (Wunsch Jamil, Talk msg 2946): je Kennzahl an/aus und „Erfassen ab“ (Daten davor
-- zählen nicht). Gespeichert werden nur Abweichungen vom Standard (an, ohne Datum); Liste der Kennzahlen:
-- src/lib/kennzahlen.ts (KONFIG_KENNZAHLEN). Neues Recht `kennzahlen.verwalten` – Standard nur der Chef.
create table app.kennzahl_einstellungen (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	kennzahl text not null check (kennzahl ~ '^[a-z][a-z_]{1,59}$'),
	aktiv boolean not null default true,
	ab date,
	geaendert timestamptz not null default now(),
	primary key (betrieb_id, kennzahl)
);
create trigger kennzahl_einstellungen_geaendert before update on app.kennzahl_einstellungen for each row execute function app.setze_geaendert();

revoke all on app.kennzahl_einstellungen from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.kennzahl_einstellungen to crm_app;
grant insert (betrieb_id, kennzahl, aktiv, ab), update (aktiv, ab) on app.kennzahl_einstellungen to crm_app;

alter table app.kennzahl_einstellungen enable row level security;
alter table app.kennzahl_einstellungen force row level security;
create policy kennzahl_einstellungen_mandant on app.kennzahl_einstellungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

update app.rollen set rechte = array_append(rechte, 'kennzahlen.verwalten')
where (vorlage = 'chef' or 'einstellungen' = any (rechte)) and not ('kennzahlen.verwalten' = any (rechte));
