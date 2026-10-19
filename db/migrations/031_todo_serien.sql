-- Wiederkehrende To-dos (Wunsch Jamil, msg 2501): eine Serie (Regel) + normale To-dos als Instanzen.
--
-- Wird eine Instanz abgehakt, legt die Anwendung in derselben Transaktion die nächste an (gleicher Auftrag,
-- Zuständiger, Titel, Beschreibung, Stufen; Fälligkeit nach der Regel) – kein Zeitplan-Job nötig. Die Serie endet mit
-- dem Enddatum oder wenn man sie beendet (aktiv = false); bestehende Instanzen bleiben.

create table app.todo_serien (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	regel text not null check (regel in ('taeglich', 'woechentlich', 'monatlich', 'jaehrlich')),
	intervall smallint not null default 1 check (intervall between 1 and 365),
	-- Bezugstag der Serie (erster Termin) – monatlich/jährlich rechnen immer von ihm aus
	start_tag date not null,
	ende date check (ende is null or ende >= start_tag),
	aktiv boolean not null default true,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id)
);
create index todo_serien_betrieb_idx on app.todo_serien (betrieb_id);

alter table app.todos add column serie_id uuid;
alter table app.todos add constraint todos_serie_fk foreign key (serie_id, betrieb_id)
	references app.todo_serien (id, betrieb_id) on delete set null (serie_id);
create index todos_serie_idx on app.todos (serie_id, betrieb_id);
grant insert (serie_id) on app.todos to crm_app;

create trigger todo_serien_geaendert before update on app.todo_serien
	for each row execute function app.setze_geaendert();

revoke all on app.todo_serien from public, crm_app, crm_admin, crm_auth;
grant select on app.todo_serien to crm_app;
grant insert (betrieb_id, regel, intervall, start_tag, ende) on app.todo_serien to crm_app;
grant update (aktiv) on app.todo_serien to crm_app;

alter table app.todo_serien enable row level security;
alter table app.todo_serien force row level security;
create policy todo_serien_mandant on app.todo_serien
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger todo_serien_protokoll
	after insert or update or delete on app.todo_serien
	for each row execute function app.protokolliere('geaendert');
