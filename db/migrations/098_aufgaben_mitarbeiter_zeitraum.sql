-- Aufgaben: mehrere Mitarbeiter und Zeitraum je Aufgabe (Wunsch Jamil, Talk msgs 2977/2978).
--
-- 1. `app.todo_mitarbeiter`: alle Mitarbeiter einer Aufgabe (beliebige Mitarbeiter des Betriebs). `todos.zustaendig_id`
--    bleibt die erste Person der Liste – so arbeiten Erinnerungen, Abhaken, Board und Sichtbarkeit weiter wie bisher.
--    Ein Trigger trägt `zustaendig_id` immer auch in die Liste ein (alle bisherigen Wege, die nur `zustaendig_id`
--    setzen, z. B. Nachfassen oder Online-Buchung, bleiben damit stimmig).
-- 2. Zeitraum: `von_tag`/`von_zeit` (Beginn). Das bisherige „Fällig“ (`faellig`/`faellig_zeit`) ist das Ende bzw. der
--    eine Tag. Ohne `von_tag` ist die Aufgabe ein einzelner Tag wie bisher.

alter table app.todos
	add column von_tag date,
	add column von_zeit time,
	add constraint todos_zeitraum check (von_tag is null or (faellig is not null and von_tag <= faellig)),
	add constraint todos_von_zeit check (von_zeit is null or von_tag is not null);
grant insert (von_tag, von_zeit), update (von_tag, von_zeit) on app.todos to crm_app;

create table app.todo_mitarbeiter (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	todo_id uuid not null,
	benutzer_id uuid not null,
	angelegt timestamptz not null default clock_timestamp(),
	primary key (todo_id, benutzer_id),
	foreign key (todo_id, betrieb_id) references app.todos (id, betrieb_id) on delete cascade,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index todo_mitarbeiter_benutzer_idx on app.todo_mitarbeiter (benutzer_id, betrieb_id);

revoke all on app.todo_mitarbeiter from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.todo_mitarbeiter to crm_app;
grant insert (betrieb_id, todo_id, benutzer_id) on app.todo_mitarbeiter to crm_app;

alter table app.todo_mitarbeiter enable row level security;
alter table app.todo_mitarbeiter force row level security;
create policy todo_mitarbeiter_mandant on app.todo_mitarbeiter
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Zuständiger (erste Person) steht immer auch in der Liste
create function app.todo_zustaendig_in_liste() returns trigger language plpgsql as $$
begin
	if new.zustaendig_id is not null then
		insert into app.todo_mitarbeiter (betrieb_id, todo_id, benutzer_id)
		values (new.betrieb_id, new.id, new.zustaendig_id)
		on conflict do nothing;
	end if;
	return null;
end $$;

create trigger todos_zustaendig_liste after insert or update of zustaendig_id on app.todos
	for each row execute function app.todo_zustaendig_in_liste();

-- Bestehende Zuständige übernehmen
insert into app.todo_mitarbeiter (betrieb_id, todo_id, benutzer_id, angelegt)
select betrieb_id, id, zustaendig_id, angelegt from app.todos where zustaendig_id is not null
on conflict do nothing;
