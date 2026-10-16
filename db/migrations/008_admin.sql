-- Plattform-Admin (Basis) – Task 12, dazu Carry T3 (Plattform-Admins nur ohne Betrieb) und Carry T10 (Zeilen wechseln
-- nie den Betrieb).
--
-- Der Admin-Bereich arbeitet als Rolle crm_admin. Diese Rolle hat KEINE Tabellenrechte (weder auf Verwaltungs- noch
-- auf Fachtabellen wie kunden, objekte, aenderungen, noch auf Geheimspalten von benutzer). Alles läuft über die
-- SECURITY-DEFINER-Funktionen unten (Ruling R7):
--   * Eigentümer crm (umgeht RLS), fester search_path (app, pg_temp), EXECUTE nie für public/crm_app/crm_auth,
--     nur für crm_admin;
--   * jede Funktion prüft ZUERST in SQL über app.admin_pruefen(), dass app.admin_id (gesetzt von mitAdmin in db.ts)
--     ein aktiver Plattform-Admin ohne Betrieb mit einer laufenden, mit zweitem Faktor bestätigten Sitzung ist –
--     die Anwendung allein reicht nicht;
--   * sie liefern nur Verwaltungsdaten (Name, Tarif, Abo, Benutzeranzahl, letzte Aktivität), nie Kundendaten;
--   * sie ändern nie die betrieb_id fachlicher Zeilen (zusätzlich per Trigger unten verboten).
--
-- Protokoll (Pflichtenheft 7.3 „Jede Admin-Aktion wird protokolliert“): app.admin_protokoll. Einträge schreiben die
-- Funktionen, die Betriebsdaten liefern oder ändern (angesehen, angelegt, geändert). Nicht protokolliert werden
-- admin_tarife (nur der allgemeine Tarifkatalog) und admin_protokoll_lesen (liest nur dieses Protokoll selbst;
-- ein Eintrag je Lesen wäre reines Rauschen). Geheimnisse (Einladungs-Token) stehen nie in details.

-- Zufall für das Einladungs-Token (gen_random_bytes). Wie unaccent (007) im Schema public.
create extension if not exists pgcrypto with schema public;

-- ---------------------------------------------------------------------------------------------------------------
-- Admin-Protokoll
create table app.admin_protokoll (
	id bigserial primary key,
	-- Kein Fremdschlüssel: Das Protokoll darf sich nie dadurch ändern, dass ein Benutzer gelöscht wird.
	admin_id uuid not null,
	aktion text not null check (length(aktion) between 1 and 60),
	details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
	zeit timestamptz not null default now()
);
-- „Verlauf eines Betriebs, neueste zuerst“
create index admin_protokoll_betrieb_idx on app.admin_protokoll ((details ->> 'betrieb_id'), id desc);

revoke all on app.admin_protokoll from public, crm_app, crm_admin, crm_auth;
revoke all on sequence app.admin_protokoll_id_seq from public, crm_app, crm_admin, crm_auth;
alter table app.admin_protokoll enable row level security;
alter table app.admin_protokoll force row level security;

-- ---------------------------------------------------------------------------------------------------------------
-- Carry T3: In plattform_admins stehen nur Benutzer ohne Betrieb. Geprüft beim Eintragen; dass ein Admin später
-- einen Betrieb bekommt, verhindert der Trigger „betrieb_id unveränderlich“ an app.benutzer (unten).
create function app.plattform_admin_ohne_betrieb()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
	if not exists (select 1 from app.benutzer b where b.id = new.benutzer_id and b.betrieb_id is null) then
		raise exception 'Plattform-Admin muss ein Benutzer ohne Betrieb sein' using errcode = '23514';
	end if;
	return new;
end;
$$;

create trigger plattform_admins_ohne_betrieb
	before insert or update on app.plattform_admins
	for each row execute function app.plattform_admin_ohne_betrieb();

-- ---------------------------------------------------------------------------------------------------------------
-- Carry T10: Eine Zeile wechselt nie den Betrieb (auch nicht durch den Eigentümer oder eine Admin-Funktion).
-- crm_app kann betrieb_id ohnehin nicht ändern (Spaltenrechte bzw. RLS WITH CHECK); dieser Trigger gilt für alle.
-- AFTER statt BEFORE: So melden RLS und Spaltenrechte bei crm_app weiter zuerst ihren eigenen Fehler.
create function app.betrieb_id_unveraenderlich()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
	raise exception 'betrieb_id von %.% darf sich nicht ändern', tg_table_schema, tg_table_name
		using errcode = '23514';
end;
$$;

create trigger rollen_betrieb_fest
	after update of betrieb_id on app.rollen
	for each row when (old.betrieb_id is distinct from new.betrieb_id)
	execute function app.betrieb_id_unveraenderlich();
create trigger benutzer_betrieb_fest
	after update of betrieb_id on app.benutzer
	for each row when (old.betrieb_id is distinct from new.betrieb_id)
	execute function app.betrieb_id_unveraenderlich();
create trigger einladungen_betrieb_fest
	after update of betrieb_id on app.einladungen
	for each row when (old.betrieb_id is distinct from new.betrieb_id)
	execute function app.betrieb_id_unveraenderlich();
create trigger kunden_betrieb_fest
	after update of betrieb_id on app.kunden
	for each row when (old.betrieb_id is distinct from new.betrieb_id)
	execute function app.betrieb_id_unveraenderlich();
create trigger objekte_betrieb_fest
	after update of betrieb_id on app.objekte
	for each row when (old.betrieb_id is distinct from new.betrieb_id)
	execute function app.betrieb_id_unveraenderlich();

revoke execute on function app.plattform_admin_ohne_betrieb() from public, crm_app, crm_admin, crm_auth;
revoke execute on function app.betrieb_id_unveraenderlich() from public, crm_app, crm_admin, crm_auth;

-- ---------------------------------------------------------------------------------------------------------------
-- Interne Prüfung (nur für die Funktionen unten): Ist app.admin_id ein Plattform-Admin, der gerade wirklich
-- angemeldet ist? Verlangt: gültige UUID, Eintrag in plattform_admins, Benutzer aktiv und ohne Betrieb, und eine
-- laufende volle Sitzung, die mit zweitem Faktor entstanden ist (R13). Sonst Fehler 'kein_plattform_admin' (42501).
-- Liefert die Admin-ID.
create function app.admin_pruefen()
returns uuid
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
declare
	v_text text := nullif(current_setting('app.admin_id', true), '');
	v_id uuid;
begin
	if v_text is null
		or v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
	then
		raise exception 'kein_plattform_admin' using errcode = '42501';
	end if;
	v_id := v_text::uuid;
	if not exists (
		select 1
		from app.plattform_admins pa
		join app.benutzer b on b.id = pa.benutzer_id
		where pa.benutzer_id = v_id
			and b.aktiv
			and b.betrieb_id is null
			and exists (
				select 1 from app.sitzungen s
				where s.benutzer_id = v_id
					and not s.zweiter_faktor_offen
					and s.mit_zweitem_faktor
					and s.laeuft_ab > now()
			)
	) then
		raise exception 'kein_plattform_admin' using errcode = '42501';
	end if;
	return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Übersicht aller Betriebe: nur Verwaltungsdaten. benutzer_anzahl = aktive Benutzer, letzte_aktivitaet = jüngste
-- Aktivität eines Benutzers des Betriebs (NULL, wenn noch niemand aktiv war).
create function app.admin_betriebe()
returns table (
	id uuid, name text, tarif text, abo_status text, abo_ende date, benutzer_anzahl integer,
	letzte_aktivitaet timestamptz
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
#variable_conflict use_column
declare
	v_admin uuid := app.admin_pruefen();
begin
	insert into app.admin_protokoll (admin_id, aktion, details) values (v_admin, 'betriebe_angesehen', '{}'::jsonb);
	return query
		select b.id, b.name, t.schluessel, b.abo_status, b.abo_ende,
			(select count(*)::int from app.benutzer u where u.betrieb_id = b.id and u.aktiv),
			(select max(u.letzte_aktivitaet) from app.benutzer u where u.betrieb_id = b.id)
		from app.betriebe b
		join app.tarife t on t.id = b.tarif_id
		order by b.name, b.id;
end;
$$;

-- Ein Betrieb (gleiche Spalten); unbekannt → keine Zeile (und kein Protokolleintrag).
create function app.admin_betrieb(p_id uuid)
returns table (
	id uuid, name text, tarif text, abo_status text, abo_ende date, benutzer_anzahl integer,
	letzte_aktivitaet timestamptz
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
#variable_conflict use_column
declare
	v_admin uuid := app.admin_pruefen();
begin
	if not exists (select 1 from app.betriebe b where b.id = p_id) then
		return;
	end if;
	insert into app.admin_protokoll (admin_id, aktion, details)
	values (v_admin, 'betrieb_angesehen', jsonb_build_object('betrieb_id', p_id));
	return query
		select b.id, b.name, t.schluessel, b.abo_status, b.abo_ende,
			(select count(*)::int from app.benutzer u where u.betrieb_id = b.id and u.aktiv),
			(select max(u.letzte_aktivitaet) from app.benutzer u where u.betrieb_id = b.id)
		from app.betriebe b
		join app.tarife t on t.id = b.tarif_id
		where b.id = p_id;
end;
$$;

-- Tarifkatalog für Auswahllisten (keine Betriebsdaten, daher kein Protokolleintrag).
create function app.admin_tarife()
returns table (schluessel text, name text)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
#variable_conflict use_column
begin
	perform app.admin_pruefen();
	return query select t.schluessel, t.name from app.tarife t order by t.schluessel;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Neuen Betrieb anlegen: Betrieb (Status 'test') mit Tarif per Schlüssel, die drei Rollen aus den Vorlagen und eine
-- Einladung für den Chef (Rolle aus der Vorlage 'chef'). Liefert NUR das Einladungs-Token (32 Byte Zufall, base64url,
-- 43 Zeichen – wie in benutzer.ts); gespeichert wird nur dessen SHA-256, protokolliert wird es nie. Es wird keine
-- E-Mail verschickt – der Admin gibt den Link selbst weiter.
--
-- Vorlagen: Die einzige Quelle ist VORLAGEN/VORLAGEN_NAMEN in src/lib/server/rechte.ts. Der Aufrufer (admin.ts)
-- übergibt sie als JSON-Liste [{vorlage, name, rechte[]}, …]; hier wird nur die Form geprüft: genau chef, buero,
-- monteur, jeweils Name und Rechte als Texte, und 'chef' muss einstellungen und benutzer.verwalten haben (sonst
-- könnte der eingeladene Chef seinen Betrieb nicht verwalten). So gibt es keine zweite Kopie der Rechte in SQL.
--
-- Fehler (Meldung = Schlüssel für admin.ts): name_ungueltig, chef_name_ungueltig, email_ungueltig (22023),
-- tarif_unbekannt (22023), email_vergeben (23505), vorlagen_ungueltig (22023).
create function app.admin_betrieb_anlegen(
	p_name text, p_tarif text, p_chef_email public.citext, p_chef_name text, p_vorlagen jsonb
)
returns text
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_admin uuid := app.admin_pruefen();
	v_name text := btrim(p_name);
	v_chef_name text := btrim(p_chef_name);
	v_email text := lower(btrim(p_chef_email::text));
	v_tarif uuid;
	v_betrieb uuid;
	v_v jsonb;
	v_rolle uuid;
	v_chef_rolle uuid;
	v_token text;
begin
	if v_name is null or v_name = '' or length(v_name) > 200 then
		raise exception 'name_ungueltig' using errcode = '22023';
	end if;
	if v_chef_name is null or v_chef_name = '' or length(v_chef_name) > 100 then
		raise exception 'chef_name_ungueltig' using errcode = '22023';
	end if;
	if v_email is null or length(v_email) > 254
		or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
	then
		raise exception 'email_ungueltig' using errcode = '22023';
	end if;
	select t.id into v_tarif from app.tarife t where t.schluessel = p_tarif;
	if v_tarif is null then
		raise exception 'tarif_unbekannt' using errcode = '22023';
	end if;
	if exists (select 1 from app.benutzer b where b.email operator(public.=) v_email::public.citext) then
		raise exception 'email_vergeben' using errcode = '23505';
	end if;

	-- Form der Vorlagen prüfen (siehe oben)
	if p_vorlagen is null or jsonb_typeof(p_vorlagen) <> 'array' or jsonb_array_length(p_vorlagen) <> 3
		or (select array_agg(e ->> 'vorlage' order by e ->> 'vorlage') from jsonb_array_elements(p_vorlagen) e)
			is distinct from array['buero', 'chef', 'monteur']
		or exists (
			select 1 from jsonb_array_elements(p_vorlagen) e
			where jsonb_typeof(e -> 'name') is distinct from 'string'
				or btrim(e ->> 'name') = '' or length(e ->> 'name') > 100
				or jsonb_typeof(e -> 'rechte') is distinct from 'array'
				or exists (select 1 from jsonb_array_elements(e -> 'rechte') r where jsonb_typeof(r) <> 'string')
		)
		or not exists (
			select 1 from jsonb_array_elements(p_vorlagen) e
			where e ->> 'vorlage' = 'chef'
				and (e -> 'rechte') ? 'einstellungen'
				and (e -> 'rechte') ? 'benutzer.verwalten'
		)
	then
		raise exception 'vorlagen_ungueltig' using errcode = '22023';
	end if;

	insert into app.betriebe (name, tarif_id) values (v_name, v_tarif) returning id into v_betrieb;

	for v_v in select e from jsonb_array_elements(p_vorlagen) e loop
		insert into app.rollen (betrieb_id, name, rechte, vorlage)
		values (
			v_betrieb, btrim(v_v ->> 'name'),
			array(select jsonb_array_elements_text(v_v -> 'rechte')), v_v ->> 'vorlage'
		)
		returning id into v_rolle;
		if v_v ->> 'vorlage' = 'chef' then
			v_chef_rolle := v_rolle;
		end if;
	end loop;

	v_token := rtrim(translate(encode(public.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
	insert into app.einladungen (betrieb_id, email, rolle_id, token_hash)
	values (v_betrieb, v_email, v_chef_rolle, sha256(convert_to(v_token, 'UTF8')));

	insert into app.admin_protokoll (admin_id, aktion, details)
	values (v_admin, 'betrieb_angelegt', jsonb_build_object(
		'betrieb_id', v_betrieb, 'name', v_name, 'tarif', p_tarif, 'chef_email', v_email, 'chef_name', v_chef_name
	));
	return v_token;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Betrieb ändern: Tarif (per Schlüssel), Abo-Status (erlaubte Menge) und Abo-Ende. NULL heißt „unverändert“; das
-- Abo-Ende entfernt p_abo_ende_leeren = true. Ändert nur die Zeile in app.betriebe (nie betrieb_id anderer Zeilen).
-- Wird der Betrieb gesperrt, enden sofort alle Sitzungen seiner Benutzer (sitzung_pruefen weist gesperrte Betriebe
-- ohnehin ab; das Löschen räumt zusätzlich auf). Ein Protokolleintrag mit vorher/nachher entsteht nur bei einer
-- tatsächlichen Änderung.
-- Fehler: betrieb_unbekannt (P0002), tarif_unbekannt, status_ungueltig, abo_ende_widerspruch (22023).
create function app.admin_betrieb_aendern(
	p_id uuid, p_tarif text, p_status text, p_abo_ende date, p_abo_ende_leeren boolean default false
)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_admin uuid := app.admin_pruefen();
	v_alt_tarif text;
	v_alt_status text;
	v_alt_ende date;
	v_tarif uuid;
	v_ende date;
	v_vorher jsonb := '{}'::jsonb;
	v_nachher jsonb := '{}'::jsonb;
	v_beendet integer := 0;
begin
	select t.schluessel, b.abo_status, b.abo_ende into v_alt_tarif, v_alt_status, v_alt_ende
	from app.betriebe b
	join app.tarife t on t.id = b.tarif_id
	where b.id = p_id
	for update of b;
	if not found then
		raise exception 'betrieb_unbekannt' using errcode = 'P0002';
	end if;

	if p_tarif is not null then
		select t.id into v_tarif from app.tarife t where t.schluessel = p_tarif;
		if v_tarif is null then
			raise exception 'tarif_unbekannt' using errcode = '22023';
		end if;
		if p_tarif <> v_alt_tarif then
			update app.betriebe b set tarif_id = v_tarif where b.id = p_id;
			v_vorher := v_vorher || jsonb_build_object('tarif', v_alt_tarif);
			v_nachher := v_nachher || jsonb_build_object('tarif', p_tarif);
		end if;
	end if;

	if p_status is not null then
		if p_status not in ('test', 'aktiv', 'ueberfaellig', 'gekuendigt', 'gesperrt') then
			raise exception 'status_ungueltig' using errcode = '22023';
		end if;
		if p_status <> v_alt_status then
			update app.betriebe b set abo_status = p_status where b.id = p_id;
			v_vorher := v_vorher || jsonb_build_object('abo_status', v_alt_status);
			v_nachher := v_nachher || jsonb_build_object('abo_status', p_status);
			if p_status = 'gesperrt' then
				delete from app.sitzungen s
				using app.benutzer u
				where s.benutzer_id = u.id and u.betrieb_id = p_id;
				get diagnostics v_beendet = row_count;
			end if;
		end if;
	end if;

	if coalesce(p_abo_ende_leeren, false) and p_abo_ende is not null then
		raise exception 'abo_ende_widerspruch' using errcode = '22023';
	end if;
	if coalesce(p_abo_ende_leeren, false) or p_abo_ende is not null then
		v_ende := case when coalesce(p_abo_ende_leeren, false) then null else p_abo_ende end;
		if v_ende is distinct from v_alt_ende then
			update app.betriebe b set abo_ende = v_ende where b.id = p_id;
			v_vorher := v_vorher || jsonb_build_object('abo_ende', v_alt_ende);
			v_nachher := v_nachher || jsonb_build_object('abo_ende', v_ende);
		end if;
	end if;

	if v_nachher <> '{}'::jsonb then
		insert into app.admin_protokoll (admin_id, aktion, details)
		values (v_admin, 'betrieb_geaendert', jsonb_build_object(
			'betrieb_id', p_id, 'vorher', v_vorher, 'nachher', v_nachher, 'sitzungen_beendet', v_beendet
		));
	end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Änderungsverlauf eines Betriebs aus dem Admin-Protokoll (angelegt/geändert, neueste zuerst, höchstens 50).
create function app.admin_protokoll_lesen(p_betrieb uuid)
returns table (id bigint, zeit timestamptz, admin_name text, aktion text, details jsonb)
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
#variable_conflict use_column
begin
	perform app.admin_pruefen();
	return query
		select p.id, p.zeit, b.name, p.aktion, p.details
		from app.admin_protokoll p
		left join app.benutzer b on b.id = p.admin_id
		where p.details ->> 'betrieb_id' = p_betrieb::text
			and p.aktion in ('betrieb_angelegt', 'betrieb_geaendert')
		order by p.id desc
		limit 50;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
revoke execute on function app.admin_pruefen() from public, crm_app, crm_admin, crm_auth;
revoke execute on function app.admin_betriebe() from public, crm_app, crm_auth;
revoke execute on function app.admin_betrieb(uuid) from public, crm_app, crm_auth;
revoke execute on function app.admin_tarife() from public, crm_app, crm_auth;
revoke execute on function app.admin_betrieb_anlegen(text, text, public.citext, text, jsonb) from public, crm_app, crm_auth;
revoke execute on function app.admin_betrieb_aendern(uuid, text, text, date, boolean) from public, crm_app, crm_auth;
revoke execute on function app.admin_protokoll_lesen(uuid) from public, crm_app, crm_auth;
grant execute on function app.admin_betriebe() to crm_admin;
grant execute on function app.admin_betrieb(uuid) to crm_admin;
grant execute on function app.admin_tarife() to crm_admin;
grant execute on function app.admin_betrieb_anlegen(text, text, public.citext, text, jsonb) to crm_admin;
grant execute on function app.admin_betrieb_aendern(uuid, text, text, date, boolean) to crm_admin;
grant execute on function app.admin_protokoll_lesen(uuid) to crm_admin;
