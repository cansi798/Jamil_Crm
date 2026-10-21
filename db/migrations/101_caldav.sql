-- Aufgaben aufs Handy (CalDAV, Wunsch Jamil msgs 2964/2980): Erinnerungen-App (iPhone), DAVx⁵ + Tasks.org/jtx
-- (Android), Thunderbird/Outlook gleichen die eigenen Aufgaben in beide Richtungen ab.
--
-- 1. `app.app_passwoerter`: je Benutzer eigene App-Passwörter („Handy verbinden“). Gespeichert wird nur der
--    Argon2id-Hash; crm_app darf ihn weder lesen noch ändern (wie beim Anmelde-Passwort). Geprüft wird nur über
--    SECURITY-DEFINER-Funktionen für crm_auth (Anmeldung per HTTP Basic).
-- 2. `app.caldav_einstellungen`: je Benutzer, ob es zusätzlich zu „Meine Aufgaben“ eine Liste je Auftrag gibt.
-- 3. `app.caldav_objekte`: UID und Dateiname, die das Handy für eine neue Aufgabe gewählt hat (sonst gilt die ID).
-- 4. `app.caldav_sync`: Stände für den Abgleich („sync-collection“): je Stand die Liste Name → ETag. Der Unterschied
--    zweier Stände ergibt neue, geänderte und weggefallene Aufgaben – auch wenn eine Aufgabe nur aus der Sicht fällt.
-- 5. `app.todos.prioritaet` (iCalendar 1 = hoch … 9 = niedrig, NULL = keine) und `angelegt_von` (wer die Aufgabe
--    angelegt hat – eigene Aufgaben ohne Auftrag erscheinen in „Meine Aufgaben“).

-- ——— 1. App-Passwörter ———
create table app.app_passwoerter (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	bezeichnung text not null check (char_length(btrim(bezeichnung)) between 1 and 80),
	hash text not null check (hash like '$argon2id$%'),
	angelegt timestamptz not null default now(),
	zuletzt_benutzt timestamptz,
	widerrufen_am timestamptz,
	unique (id, betrieb_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index app_passwoerter_benutzer_idx on app.app_passwoerter (benutzer_id, betrieb_id);

revoke all on app.app_passwoerter from public, crm_app, crm_admin, crm_auth;
-- Kein Lesen des Hashs für crm_app
grant select (id, betrieb_id, benutzer_id, bezeichnung, angelegt, zuletzt_benutzt, widerrufen_am) on app.app_passwoerter to crm_app;
grant insert (betrieb_id, benutzer_id, bezeichnung, hash) on app.app_passwoerter to crm_app;
grant update (widerrufen_am) on app.app_passwoerter to crm_app;

alter table app.app_passwoerter enable row level security;
alter table app.app_passwoerter force row level security;
-- Jeder sieht und verwaltet nur die eigenen App-Passwörter
create policy app_passwoerter_eigene on app.app_passwoerter
	for all to crm_app
	using (
		betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id::text = current_setting('app.benutzer_id', true)
	)
	with check (
		betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id::text = current_setting('app.benutzer_id', true)
	);

-- Kandidaten zur E-Mail: nicht widerrufene App-Passwörter aktiver Benutzer eines nicht gesperrten Betriebs (keine
-- Plattform-Admins). Nur diese Funktion gibt den Hash heraus; den Vergleich macht die Anwendung (Argon2).
create function app.app_passwort_kandidaten(p_email public.citext)
returns table (id uuid, hash text)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select p.id, p.hash
	from app.benutzer b
	join app.betriebe bt on bt.id = b.betrieb_id
	join app.app_passwoerter p on p.benutzer_id = b.id and p.betrieb_id = b.betrieb_id
	where b.email operator(public.=) p_email
		and b.aktiv
		and bt.abo_status <> 'gesperrt'
		and p.widerrufen_am is null
		and not exists (select 1 from app.plattform_admins pa where pa.benutzer_id = b.id)
	order by p.angelegt desc
	limit 20;
$$;

-- Nutzerdaten zu einem (schon geprüften) App-Passwort – wie sitzung_pruefen; leer, wenn das Passwort inzwischen
-- widerrufen, der Benutzer deaktiviert oder der Betrieb gesperrt ist. Merkt „zuletzt benutzt“ (höchstens jede Minute).
create function app.app_passwort_nutzer(p_id uuid)
returns table (benutzer_id uuid, betrieb_id uuid, email text, name text, rolle_rechte text[], betrieb_status text)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
#variable_conflict use_column
declare
	v_benutzer uuid;
begin
	select p.benutzer_id into v_benutzer
	from app.app_passwoerter p
	join app.benutzer b on b.id = p.benutzer_id and b.betrieb_id = p.betrieb_id
	join app.betriebe bt on bt.id = b.betrieb_id
	where p.id = p_id and p.widerrufen_am is null and b.aktiv and bt.abo_status <> 'gesperrt'
		and not exists (select 1 from app.plattform_admins pa where pa.benutzer_id = b.id);
	if v_benutzer is null then
		return;
	end if;
	update app.app_passwoerter p set zuletzt_benutzt = now()
	where p.id = p_id and (p.zuletzt_benutzt is null or p.zuletzt_benutzt < now() - interval '1 minute');
	return query
		select b.id, b.betrieb_id, b.email::text, b.name, coalesce(r.rechte, '{}'::text[]), bt.abo_status
		from app.benutzer b
		left join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		join app.betriebe bt on bt.id = b.betrieb_id
		where b.id = v_benutzer;
end;
$$;

revoke execute on function app.app_passwort_kandidaten(public.citext) from public, crm_app, crm_admin;
revoke execute on function app.app_passwort_nutzer(uuid) from public, crm_app, crm_admin;
grant execute on function app.app_passwort_kandidaten(public.citext) to crm_auth;
grant execute on function app.app_passwort_nutzer(uuid) to crm_auth;

-- ——— 2. Einstellungen je Benutzer ———
create table app.caldav_einstellungen (
	benutzer_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	listen_je_auftrag boolean not null default false,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
revoke all on app.caldav_einstellungen from public, crm_app, crm_admin, crm_auth;
grant select, insert, update (listen_je_auftrag) on app.caldav_einstellungen to crm_app;
alter table app.caldav_einstellungen enable row level security;
alter table app.caldav_einstellungen force row level security;
create policy caldav_einstellungen_eigene on app.caldav_einstellungen
	for all to crm_app
	using (
		betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id::text = current_setting('app.benutzer_id', true)
	)
	with check (
		betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id::text = current_setting('app.benutzer_id', true)
	);

-- ——— 3. Vom Handy gewählte UID/Dateinamen ———
create table app.caldav_objekte (
	todo_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	uid text not null check (char_length(uid) between 1 and 255),
	name text not null check (name ~ '^[A-Za-z0-9._@~+=-]{1,200}\.ics$'),
	unique (betrieb_id, uid),
	unique (betrieb_id, name),
	foreign key (todo_id, betrieb_id) references app.todos (id, betrieb_id) on delete cascade
);
revoke all on app.caldav_objekte from public, crm_app, crm_admin, crm_auth;
grant select, insert, delete on app.caldav_objekte to crm_app;
alter table app.caldav_objekte enable row level security;
alter table app.caldav_objekte force row level security;
create policy caldav_objekte_mandant on app.caldav_objekte
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- ——— 4. Abgleich-Stände ———
create table app.caldav_sync (
	token uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	sammlung text not null check (char_length(sammlung) between 1 and 80),
	eintraege jsonb not null,
	pruefsumme text not null,
	angelegt timestamptz not null default clock_timestamp(),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index caldav_sync_sammlung_idx on app.caldav_sync (benutzer_id, sammlung, angelegt desc);
revoke all on app.caldav_sync from public, crm_app, crm_admin, crm_auth;
grant select, insert, delete on app.caldav_sync to crm_app;
alter table app.caldav_sync enable row level security;
alter table app.caldav_sync force row level security;
create policy caldav_sync_eigene on app.caldav_sync
	for all to crm_app
	using (
		betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id::text = current_setting('app.benutzer_id', true)
	)
	with check (
		betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id::text = current_setting('app.benutzer_id', true)
	);

-- ——— 5. Priorität und „angelegt von“ ———
-- Benutzer aus dem Kontext, nur wenn es eine UUID ist (öffentliche Abläufe setzen keinen Benutzer)
create function app.kontext_benutzer() returns uuid
language sql
stable
set search_path = app, pg_temp
as $$
	select case when s ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then s::uuid end
	from (select current_setting('app.benutzer_id', true) as s) x;
$$;

alter table app.todos
	add column prioritaet smallint check (prioritaet between 1 and 9),
	add column angelegt_von uuid default app.kontext_benutzer();
grant insert (prioritaet), update (prioritaet) on app.todos to crm_app;
