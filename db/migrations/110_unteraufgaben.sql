-- Unteraufgaben (Jamil, Talk msg 3530): Eine Aufgabe kann kleine Unteraufgaben haben – Titel, erledigt-Haken, optional eine
-- Person, feste Reihenfolge. Sie gehören zur Aufgabe (werden mit ihr gelöscht) und erscheinen nicht im Kundenportal.

create table app.todo_unteraufgaben (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	todo_id uuid not null,
	titel text not null check (char_length(btrim(titel)) between 1 and 200),
	pos integer not null default 0,
	erledigt_am timestamptz,
	benutzer_id uuid,
	angelegt timestamptz not null default clock_timestamp(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (todo_id, betrieb_id) references app.todos (id, betrieb_id) on delete cascade,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (benutzer_id)
);
create index todo_unteraufgaben_todo_idx on app.todo_unteraufgaben (todo_id, betrieb_id, pos);

revoke all on app.todo_unteraufgaben from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.todo_unteraufgaben to crm_app;
grant insert (betrieb_id, todo_id, titel, pos, erledigt_am, benutzer_id) on app.todo_unteraufgaben to crm_app;
grant update (titel, pos, erledigt_am, benutzer_id) on app.todo_unteraufgaben to crm_app;

alter table app.todo_unteraufgaben enable row level security;
alter table app.todo_unteraufgaben force row level security;
create policy todo_unteraufgaben_mandant on app.todo_unteraufgaben
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger todo_unteraufgaben_geaendert before update on app.todo_unteraufgaben for each row execute function app.setze_geaendert();
create trigger todo_unteraufgaben_protokoll after insert or update or delete on app.todo_unteraufgaben
	for each row execute function app.protokolliere('geaendert');
