-- Benachrichtigungen (Jamil, Talk msg 3734): Wer von etwas betroffen ist, bekommt eine Nachricht in der Glocke und – wo
-- eingeschaltet – per Push. Betroffen heißt (nur, was es in den Daten gibt):
--   * Aufgabe: als Mitarbeiter eingetragen (app.todo_mitarbeiter; der Zuständige steht immer mit drin)
--   * Termin: eingeteilt (neu oder umgehängt), eigener Termin verschoben/geändert, ausgetragen oder gelöscht
--   * Auftrag: als Zuständiger eingetragen, Statuswechsel an einem Auftrag, für den man zuständig ist
-- Kunden haben keine Zuständigen, Notizen keine @-Erwähnungen – dafür gibt es (noch) nichts.
--
-- Regeln:
--   * Nie den Auslöser selbst (app.benutzer_id der Transaktion).
--   * Öffentliche Abläufe (Online-Buchung, Kundenportal: app.quelle = 'online-buchung' bzw. 'kundenportal') benachrichtigen
--     schon selbst über app.erinnerungen – hier nichts doppelt.
--   * Bündeln: ungelesene Nachricht mit demselben Schlüssel (z. B. derselbe Termin bzw. dieselbe Terminserie) aus den
--     letzten 15 Minuten wird aktualisiert statt neu angelegt (anzahl zählt mit, Push nur einmal).
--   * Je Person und Kategorie (aufgabe, termin, auftrag) abschaltbar: Glocke aus = keine Nachricht, Push aus = nur Glocke
--     (app.benachrichtigung_einstellungen; fehlt die Zeile, ist beides an).
-- Push verschickt der Hintergrund-Dienst (jede Minute) – Spalte push_ergebnis. Kein E-Mail-Versand.
-- Die Nachrichten sind abgeleitete Daten (kein Änderungsprotokoll); die auslösenden Änderungen stehen ohnehin dort.

create table app.benachrichtigungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	kategorie text not null check (kategorie in ('aufgabe', 'termin', 'auftrag')),
	schluessel text not null check (char_length(schluessel) between 1 and 200),
	titel text not null check (char_length(titel) between 1 and 300),
	text text check (char_length(text) <= 500),
	link text not null check (link ~ '^/[A-Za-z0-9/_?=&#.-]*$' and char_length(link) <= 300),
	anzahl integer not null default 1 check (anzahl between 1 and 10000),
	ausloeser_id uuid,
	angelegt timestamptz not null default now(),
	aktualisiert timestamptz not null default now(),
	gelesen_am timestamptz,
	push_am timestamptz,
	push_ergebnis text check (push_ergebnis in ('gesendet', 'aus', 'keins')),
	unique (id, betrieb_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade,
	foreign key (ausloeser_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (ausloeser_id)
);
create index benachrichtigungen_benutzer_idx on app.benachrichtigungen (benutzer_id, betrieb_id, aktualisiert desc);
create index benachrichtigungen_buendel_idx on app.benachrichtigungen (benutzer_id, betrieb_id, schluessel) where gelesen_am is null;
create index benachrichtigungen_push_idx on app.benachrichtigungen (angelegt) where push_ergebnis is null;

revoke all on app.benachrichtigungen from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.benachrichtigungen to crm_app;
grant update (gelesen_am, push_am, push_ergebnis) on app.benachrichtigungen to crm_app;
alter table app.benachrichtigungen enable row level security;
alter table app.benachrichtigungen force row level security;
create policy benachrichtigungen_mandant on app.benachrichtigungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create table app.benachrichtigung_einstellungen (
	id uuid not null default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	kategorie text not null check (kategorie in ('aufgabe', 'termin', 'auftrag')),
	glocke boolean not null default true,
	push boolean not null default true,
	geaendert timestamptz not null default now(),
	primary key (benutzer_id, kategorie),
	unique (id, betrieb_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
revoke all on app.benachrichtigung_einstellungen from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.benachrichtigung_einstellungen to crm_app;
grant insert (betrieb_id, benutzer_id, kategorie, glocke, push), update (glocke, push) on app.benachrichtigung_einstellungen to crm_app;
alter table app.benachrichtigung_einstellungen enable row level security;
alter table app.benachrichtigung_einstellungen force row level security;
create policy benachrichtigung_einstellungen_mandant on app.benachrichtigung_einstellungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create trigger benachrichtigung_einstellungen_geaendert before update on app.benachrichtigung_einstellungen
	for each row execute function app.setze_geaendert();
create trigger benachrichtigung_einstellungen_protokoll after insert or update or delete on app.benachrichtigung_einstellungen
	for each row execute function app.protokolliere('geaendert');

-- Eine Nachricht anlegen bzw. bündeln. SECURITY DEFINER: die Anwendung selbst darf keine Nachrichten schreiben;
-- Betrieb und Empfänger kommen aus den Triggern (Zeilen, die die RLS des Betriebs schon passiert haben).
create function app.benachrichtige(p_betrieb uuid, p_benutzer uuid, p_kategorie text, p_schluessel text, p_titel text,
	p_text text, p_link text) returns void language plpgsql security definer set search_path = app, pg_temp as $$
declare
	v_akteur text := nullif(current_setting('app.benutzer_id', true), '');
	v_akteur_id uuid;
	v_glocke boolean := true;
	v_push boolean := true;
	v_id uuid;
begin
	if p_benutzer is null or p_betrieb is null then return; end if;
	-- öffentliche Abläufe (ohne angemeldeten Benutzer, Quelle online-buchung/kundenportal) melden selbst
	if v_akteur = 'oeffentlich' or coalesce(current_setting('app.quelle', true), '') in ('online-buchung', 'kundenportal') then return; end if;
	if v_akteur is not null and v_akteur = p_benutzer::text then return; end if;
	if v_akteur ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
		select id into v_akteur_id from app.benutzer where id = v_akteur::uuid and betrieb_id = p_betrieb;
	end if;
	if not exists (select 1 from app.benutzer where id = p_benutzer and betrieb_id = p_betrieb and aktiv) then return; end if;
	select e.glocke, e.push into v_glocke, v_push from app.benachrichtigung_einstellungen e
	where e.benutzer_id = p_benutzer and e.betrieb_id = p_betrieb and e.kategorie = p_kategorie;
	if not coalesce(v_glocke, true) then return; end if;
	select id into v_id from app.benachrichtigungen
	where betrieb_id = p_betrieb and benutzer_id = p_benutzer and schluessel = p_schluessel and gelesen_am is null
		and aktualisiert > now() - interval '15 minutes'
	order by aktualisiert desc limit 1 for update;
	if v_id is not null then
		update app.benachrichtigungen set titel = left(p_titel, 300), text = left(p_text, 500), link = p_link,
			anzahl = least(anzahl + 1, 10000), aktualisiert = now(), ausloeser_id = v_akteur_id
		where id = v_id;
	else
		insert into app.benachrichtigungen (betrieb_id, benutzer_id, kategorie, schluessel, titel, text, link, ausloeser_id, push_ergebnis)
		values (p_betrieb, p_benutzer, p_kategorie, p_schluessel, left(p_titel, 300), left(p_text, 500), p_link, v_akteur_id,
			case when coalesce(v_push, true) then null else 'aus' end);
	end if;
end $$;
revoke all on function app.benachrichtige(uuid, uuid, text, text, text, text, text) from public;
grant execute on function app.benachrichtige(uuid, uuid, text, text, text, text, text) to crm_app;

-- „von <Name>“ für den Text (leer ohne angemeldeten Auslöser)
create function app.benachrichtigung_von(p_betrieb uuid) returns text language sql stable security definer
set search_path = app, pg_temp as $$
	-- CASE statt AND: der uuid-Cast darf nur laufen, wenn wirklich eine Kennung gesetzt ist
	select 'von ' || b.name from app.benutzer b
	where b.betrieb_id = p_betrieb and b.id = case
		when coalesce(current_setting('app.benutzer_id', true), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		then current_setting('app.benutzer_id', true)::uuid end;
$$;
revoke all on function app.benachrichtigung_von(uuid) from public;
grant execute on function app.benachrichtigung_von(uuid) to crm_app;

create function app.benachrichtigung_zeit(p timestamptz) returns text language sql immutable as $$
	select to_char(p at time zone 'Europe/Berlin', 'DD.MM.YYYY, HH24:MI') || ' Uhr';
$$;

-- ——— Aufgaben: als Mitarbeiter eingetragen ———
create function app.benachrichtige_aufgabe() returns trigger language plpgsql set search_path = app, pg_temp as $$
declare t record;
begin
	select x.titel, x.auftrag_id, x.faellig, x.erledigt_am, a.nummer, a.titel as auftrag_titel into t
	from app.todos x left join app.auftraege a on a.id = x.auftrag_id and a.betrieb_id = x.betrieb_id
	where x.id = new.todo_id and x.betrieb_id = new.betrieb_id;
	if t is null or t.erledigt_am is not null then return null; end if;
	perform app.benachrichtige(new.betrieb_id, new.benutzer_id, 'aufgabe', 'aufgabe:' || new.todo_id,
		'Neue Aufgabe für dich: ' || t.titel,
		concat_ws(' · ', app.benachrichtigung_von(new.betrieb_id),
			case when t.faellig is not null then 'fällig ' || to_char(t.faellig, 'DD.MM.YYYY') end,
			case when t.nummer is not null then t.nummer || ' ' || t.auftrag_titel end),
		case when t.auftrag_id is not null then '/auftraege/' || t.auftrag_id else '/todos' end);
	return null;
end $$;
create trigger todo_mitarbeiter_benachrichtigen after insert on app.todo_mitarbeiter
	for each row execute function app.benachrichtige_aufgabe();

-- ——— Termine ———
create function app.benachrichtige_termin() returns trigger language plpgsql set search_path = app, pg_temp as $$
declare
	z app.einsaetze;
	v_was text;
	v_titel text;
	v_link text;
	v_schluessel text;
begin
	if tg_op = 'DELETE' then z := old; else z := new; end if;
	select coalesce(a.nummer || ' ' || a.titel, z.titel, 'Termin') into v_titel
	from (select 1) d left join app.auftraege a on a.id = z.auftrag_id and a.betrieb_id = z.betrieb_id;
	v_link := case when z.auftrag_id is not null then '/auftraege/' || z.auftrag_id
		else '/plantafel?ansicht=tag&tag=' || to_char(z.beginn at time zone 'Europe/Berlin', 'YYYY-MM-DD') end;
	v_schluessel := 'termin:' || coalesce(z.gruppe_id, z.id);
	if tg_op = 'INSERT' then
		perform app.benachrichtige(new.betrieb_id, new.benutzer_id, 'termin', v_schluessel, 'Neuer Termin für dich: ' || v_titel,
			concat_ws(' · ', app.benachrichtigung_zeit(new.beginn), app.benachrichtigung_von(new.betrieb_id)), v_link);
	elsif tg_op = 'DELETE' then
		perform app.benachrichtige(old.betrieb_id, old.benutzer_id, 'termin', v_schluessel, 'Termin abgesagt: ' || v_titel,
			concat_ws(' · ', app.benachrichtigung_zeit(old.beginn), app.benachrichtigung_von(old.betrieb_id)),
			'/plantafel?ansicht=tag&tag=' || to_char(old.beginn at time zone 'Europe/Berlin', 'YYYY-MM-DD'));
	elsif new.benutzer_id is distinct from old.benutzer_id then
		perform app.benachrichtige(new.betrieb_id, new.benutzer_id, 'termin', v_schluessel, 'Neuer Termin für dich: ' || v_titel,
			concat_ws(' · ', app.benachrichtigung_zeit(new.beginn), app.benachrichtigung_von(new.betrieb_id)), v_link);
		perform app.benachrichtige(old.betrieb_id, old.benutzer_id, 'termin', v_schluessel, 'Du bist aus einem Termin ausgetragen: ' || v_titel,
			concat_ws(' · ', app.benachrichtigung_zeit(old.beginn), app.benachrichtigung_von(old.betrieb_id)), v_link);
	elsif new.beginn is distinct from old.beginn or new.ende is distinct from old.ende then
		v_was := 'Termin verschoben: ';
		perform app.benachrichtige(new.betrieb_id, new.benutzer_id, 'termin', v_schluessel, v_was || v_titel,
			concat_ws(' · ', 'jetzt ' || app.benachrichtigung_zeit(new.beginn), app.benachrichtigung_von(new.betrieb_id)), v_link);
	elsif new.auftrag_id is distinct from old.auftrag_id or new.titel is distinct from old.titel or new.art is distinct from old.art
		or new.notiz is distinct from old.notiz then
		perform app.benachrichtige(new.betrieb_id, new.benutzer_id, 'termin', v_schluessel, 'Termin geändert: ' || v_titel,
			concat_ws(' · ', app.benachrichtigung_zeit(new.beginn), app.benachrichtigung_von(new.betrieb_id)), v_link);
	end if;
	return null;
end $$;
create trigger einsaetze_benachrichtigen after insert or update or delete on app.einsaetze
	for each row execute function app.benachrichtige_termin();

-- ——— Aufträge: zuständig eingetragen, Statuswechsel ———
create function app.benachrichtige_auftrag_zustaendig() returns trigger language plpgsql set search_path = app, pg_temp as $$
declare a record;
begin
	select x.nummer, x.titel into a from app.auftraege x where x.id = new.auftrag_id and x.betrieb_id = new.betrieb_id;
	if a is null then return null; end if;
	perform app.benachrichtige(new.betrieb_id, new.benutzer_id, 'auftrag', 'auftrag:' || new.auftrag_id,
		'Auftrag für dich: ' || a.nummer || ' ' || a.titel, app.benachrichtigung_von(new.betrieb_id), '/auftraege/' || new.auftrag_id);
	return null;
end $$;
create trigger auftrag_zustaendige_benachrichtigen after insert on app.auftrag_zustaendige
	for each row execute function app.benachrichtige_auftrag_zustaendig();

create function app.benachrichtige_auftrag_status() returns trigger language plpgsql set search_path = app, pg_temp as $$
declare z record; v_name text;
begin
	if new.status is not distinct from old.status then return null; end if;
	v_name := case new.status when 'anfrage' then 'Anfrage' when 'angebot' then 'Angebot' when 'beauftragt' then 'Beauftragt'
		when 'in_arbeit' then 'In Arbeit' when 'abgenommen' then 'Abgenommen' when 'abgerechnet' then 'Abgerechnet' else new.status end;
	for z in select benutzer_id from app.auftrag_zustaendige where auftrag_id = new.id and betrieb_id = new.betrieb_id loop
		perform app.benachrichtige(new.betrieb_id, z.benutzer_id, 'auftrag', 'auftrag:' || new.id,
			'Auftrag ' || new.nummer || ' ist jetzt „' || v_name || '“',
			concat_ws(' · ', new.titel, app.benachrichtigung_von(new.betrieb_id)), '/auftraege/' || new.id);
	end loop;
	return null;
end $$;
create trigger auftraege_status_benachrichtigen after update of status on app.auftraege
	for each row execute function app.benachrichtige_auftrag_status();

-- Gelöschte Aufgabe bzw. gelöschter Auftrag: deren Nachrichten verschwinden mit (der Link würde ins Leere führen).
-- Gelöschte Termine dagegen melden „Termin abgesagt“ (siehe oben).
create function app.benachrichtigungen_aufraeumen() returns trigger language plpgsql set search_path = app, pg_temp as $$
begin
	delete from app.benachrichtigungen
	where betrieb_id = old.betrieb_id and schluessel = (case when tg_table_name = 'todos' then 'aufgabe:' else 'auftrag:' end) || old.id;
	return old;
end $$;
create trigger todos_benachrichtigungen_aufraeumen after delete on app.todos
	for each row execute function app.benachrichtigungen_aufraeumen();
create trigger auftraege_benachrichtigungen_aufraeumen after delete on app.auftraege
	for each row execute function app.benachrichtigungen_aufraeumen();

-- Hintergrund-Dienst: Nachrichten, deren Push noch aussteht (alle Betriebe, nur Kennungen)
create function app.benachrichtigungen_push_offen(p_limit integer)
returns table (id uuid, betrieb_id uuid, benutzer_id uuid)
language sql stable security definer set search_path = app, pg_temp as $$
	select n.id, n.betrieb_id, n.benutzer_id from app.benachrichtigungen n
	where n.push_ergebnis is null
	order by n.angelegt
	limit least(greatest(p_limit, 1), 500);
$$;
revoke all on function app.benachrichtigungen_push_offen(integer) from public;
grant execute on function app.benachrichtigungen_push_offen(integer) to crm_auth;
