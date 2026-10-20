-- Erinnerungen (Wunsch Jamil msg 2679): Für To-dos und Termine (Einsätze) bis zu zwei Erinnerungen je Person –
-- relativ („1 Stunde vorher“, „1 Tag vorher“) oder zu einem festen Zeitpunkt („morgen um 8“). Zugestellt werden sie
-- in der App (Glocke) und per Web-Push (PWA, VAPID); E-Mail folgt mit der Mail-Anbindung.
-- Neues Recht „erinnerungen.nutzen“: bestehende Rollen bekommen es (Chef, Büro, Monteur – alle), in „Rollen“ änderbar.

-- To-do: optionale Uhrzeit zur Fälligkeit (ohne Uhrzeit gilt für Erinnerungen 8:00 Uhr)
alter table app.todos add column faellig_zeit time;
grant insert (faellig_zeit) on app.todos to crm_app;
grant update (faellig_zeit) on app.todos to crm_app;

-- Zeitpunkt der Fälligkeit eines To-dos (Berliner Zeit)
create function app.todo_faellig_um(p_tag date, p_zeit time)
returns timestamptz
language sql
immutable
set search_path = app, pg_temp
as $$
	select case when p_tag is null then null
		else ((p_tag + coalesce(p_zeit, time '08:00'))::timestamp at time zone 'Europe/Berlin') end;
$$;

create table app.erinnerungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	todo_id uuid,
	einsatz_id uuid,
	-- relativ: Minuten vor der Fälligkeit bzw. dem Terminbeginn (Zeitpunkt wird bei Änderung nachgezogen);
	-- null = fester Zeitpunkt
	minuten_vorher integer check (minuten_vorher between 0 and 43200),
	zeitpunkt timestamptz not null,
	titel text not null check (char_length(titel) between 1 and 300),
	text text check (char_length(text) <= 500),
	link text not null check (link ~ '^/[A-Za-z0-9/_?=&#.-]*$' and char_length(link) <= 300),
	gesendet_am timestamptz,
	ergebnis text check (ergebnis in ('gesendet', 'uebersprungen')),
	gelesen_am timestamptz,
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	check ((todo_id is null) <> (einsatz_id is null)),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade,
	foreign key (todo_id, betrieb_id) references app.todos (id, betrieb_id) on delete cascade,
	foreign key (einsatz_id, betrieb_id) references app.einsaetze (id, betrieb_id) on delete cascade
);
create index erinnerungen_faellig_idx on app.erinnerungen (zeitpunkt) where gesendet_am is null;
create index erinnerungen_benutzer_idx on app.erinnerungen (benutzer_id, betrieb_id, gesendet_am desc);
create index erinnerungen_todo_idx on app.erinnerungen (todo_id, betrieb_id) where todo_id is not null;
create index erinnerungen_einsatz_idx on app.erinnerungen (einsatz_id, betrieb_id) where einsatz_id is not null;

revoke all on app.erinnerungen from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.erinnerungen to crm_app;
grant insert (betrieb_id, benutzer_id, todo_id, einsatz_id, minuten_vorher, zeitpunkt, titel, text, link) on app.erinnerungen to crm_app;
grant update (zeitpunkt, titel, text, link, gesendet_am, ergebnis, gelesen_am) on app.erinnerungen to crm_app;
alter table app.erinnerungen enable row level security;
alter table app.erinnerungen force row level security;
create policy erinnerungen_mandant on app.erinnerungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Relative Erinnerungen ziehen mit, wenn sich Fälligkeit (To-do) bzw. Beginn (Termin) ändert
create function app.erinnerungen_nachziehen()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
	if tg_table_name = 'todos' then
		if new.faellig is not null then
			update app.erinnerungen r
			set zeitpunkt = app.todo_faellig_um(new.faellig, new.faellig_zeit) - make_interval(mins => r.minuten_vorher)
			where r.todo_id = new.id and r.betrieb_id = new.betrieb_id and r.minuten_vorher is not null and r.gesendet_am is null;
		end if;
	else
		update app.erinnerungen r
		set zeitpunkt = new.beginn - make_interval(mins => r.minuten_vorher)
		where r.einsatz_id = new.id and r.betrieb_id = new.betrieb_id and r.minuten_vorher is not null and r.gesendet_am is null;
	end if;
	return new;
end;
$$;
create trigger todos_erinnerungen after update of faellig, faellig_zeit on app.todos
	for each row execute function app.erinnerungen_nachziehen();
create trigger einsaetze_erinnerungen after update of beginn on app.einsaetze
	for each row execute function app.erinnerungen_nachziehen();

-- Web-Push-Abos je Gerät (Konto → Benachrichtigungen)
create table app.push_abos (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
	p256dh text not null check (char_length(p256dh) between 10 and 200),
	auth text not null check (char_length(auth) between 8 and 100),
	geraet text check (char_length(geraet) <= 200),
	fehler smallint not null default 0,
	angelegt timestamptz not null default now(),
	zuletzt_genutzt timestamptz,
	unique (betrieb_id, endpoint),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index push_abos_benutzer_idx on app.push_abos (benutzer_id, betrieb_id);
revoke all on app.push_abos from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.push_abos to crm_app;
grant insert (betrieb_id, benutzer_id, endpoint, p256dh, auth, geraet) on app.push_abos to crm_app;
grant update (benutzer_id, p256dh, auth, geraet, fehler, zuletzt_genutzt) on app.push_abos to crm_app;
alter table app.push_abos enable row level security;
alter table app.push_abos force row level security;
create policy push_abos_mandant on app.push_abos for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Systemwerte (z. B. VAPID-Schlüssel, falls nicht in der .env gesetzt) – nur über die Funktionen unten
create table app.system_werte (
	schluessel text primary key check (char_length(schluessel) <= 100),
	wert text not null check (char_length(wert) <= 2000),
	geaendert timestamptz not null default now()
);
revoke all on app.system_werte from public, crm_app, crm_admin, crm_auth;

-- Scheduler: fällige, noch nicht gesendete Erinnerungen aller Betriebe (nur IDs; Inhalt liest der Server danach im
-- Betrieb mit RLS). Läuft als Eigentümer, nur für crm_auth (systemAbfrage).
create function app.erinnerungen_faellig(p_limit integer)
returns table (id uuid, betrieb_id uuid, benutzer_id uuid)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select r.id, r.betrieb_id, r.benutzer_id from app.erinnerungen r
	where r.gesendet_am is null and r.zeitpunkt <= now()
	order by r.zeitpunkt
	limit least(greatest(p_limit, 1), 500);
$$;
revoke all on function app.erinnerungen_faellig(integer) from public;
grant execute on function app.erinnerungen_faellig(integer) to crm_auth;

create function app.system_wert(p_schluessel text)
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$ select wert from app.system_werte where schluessel = p_schluessel; $$;
revoke all on function app.system_wert(text) from public;
grant execute on function app.system_wert(text) to crm_auth;

-- Setzt einen Wert nur, wenn er noch fehlt (zwei Server-Prozesse erzeugen so nie verschiedene Schlüssel); liefert den gültigen
create function app.system_wert_falls_neu(p_schluessel text, p_wert text)
returns text
language sql
security definer
set search_path = app, pg_temp
as $$
	insert into app.system_werte (schluessel, wert) values (p_schluessel, p_wert) on conflict (schluessel) do nothing;
	select wert from app.system_werte where schluessel = p_schluessel;
$$;
revoke all on function app.system_wert_falls_neu(text, text) from public;
grant execute on function app.system_wert_falls_neu(text, text) to crm_auth;

-- Recht für bestehende Rollen
update app.rollen set rechte = array_append(rechte, 'erinnerungen.nutzen') where not ('erinnerungen.nutzen' = any (rechte));
