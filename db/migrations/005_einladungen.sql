-- Benutzer & Einladungen (Task 9), dazu Ruling R6 (Abschluss: kein INSERT auf benutzer für crm_app) und
-- Ruling R13 (volle Sitzungen merken sich, ob sie mit zweitem Faktor entstanden sind).
--
-- Einladung: Ein Verwalter lädt eine E-Mail-Adresse in eine Rolle seines Betriebs ein. Der Link enthält ein Token
-- (32 Byte Zufall, base64url); gespeichert wird nur dessen SHA-256. Die Einladung gilt 7 Tage und nur einmal.
-- Angenommen wird sie ohne Anmeldung über app.einladung_annehmen (nur für crm_auth, adressiert über den
-- Token-Hash – nie über eine frei wählbare Benutzer- oder Betriebs-ID). Nur dort entstehen neue Benutzer.
--
-- Alle SECURITY-DEFINER-Funktionen gehören crm (umgeht RLS), haben einen festen search_path und filtern
-- ausdrücklich (R7); EXECUTE nie für public.

create table app.einladungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	email public.citext not null,
	rolle_id uuid not null,
	token_hash bytea not null unique check (length(token_hash) = 32),
	-- Laufzeit legt die Datenbank fest; crm_app darf die Spalte nicht setzen.
	laeuft_ab timestamptz not null default now() + interval '7 days',
	angenommen timestamptz,
	angelegt timestamptz not null default now(),
	eingeladen_von uuid references app.benutzer (id) on delete set null,
	-- Mandantentreue wie bei benutzer: Die Rolle muss zum Betrieb der Einladung gehören. Wird die Rolle gelöscht,
	-- verfällt die Einladung mit.
	foreign key (rolle_id, betrieb_id) references app.rollen (id, betrieb_id) on delete cascade
);
create index einladungen_betrieb_idx on app.einladungen (betrieb_id);
-- Je Betrieb höchstens eine offene Einladung pro E-Mail (erneutes Einladen ersetzt die alte).
create unique index einladungen_offen_email_idx on app.einladungen (betrieb_id, email) where angenommen is null;

revoke all on app.einladungen from public, crm_app, crm_admin, crm_auth;
-- token_hash ist nicht lesbar; laeuft_ab, angenommen und angelegt sind nicht frei setzbar; kein UPDATE.
grant select (id, betrieb_id, email, rolle_id, laeuft_ab, angenommen, angelegt, eingeladen_von)
	on app.einladungen to crm_app;
grant insert (betrieb_id, email, rolle_id, token_hash, eingeladen_von) on app.einladungen to crm_app;
grant delete on app.einladungen to crm_app;

alter table app.einladungen enable row level security;
alter table app.einladungen force row level security;
create policy einladungen_mandant on app.einladungen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Ruling R6 (Abschluss): crm_app legt keine Benutzer mehr an – das geschieht nur in einladung_annehmen. So kann
-- fachlicher Code (Bug, SQL-Injection) weder Konten mit gewähltem Passwort-Hash noch mit TOTP-Daten erzeugen.
revoke insert on app.benutzer from crm_app;

-- Ist diese E-Mail schon irgendeinem Konto zugeordnet (mandantenübergreifend, weil E-Mails global eindeutig sind)?
-- Liefert nur ja/nein. EXECUTE nur für crm_app (Einladen braucht die Prüfung im Betriebskontext).
create function app.email_vergeben(p_email public.citext)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select exists (select 1 from app.benutzer b where b.email operator(public.=) p_email);
$$;

-- Gilt eine Einladung (noch)? Zentrale Bedingung für einladung_pruefen und einladung_annehmen:
-- nicht angenommen, nicht abgelaufen, Betrieb weder gesperrt noch im Nur-Lesezugriff, E-Mail noch frei.
-- Nur-Lesezugriff wie istNurLesen in src/lib/server/tarif.ts (überfällig: abo_ende + 14 Tage, gekündigt: ab dem
-- Tag nach abo_ende; Kalendertag in Europe/Berlin).
create function app.einladung_gueltig(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select coalesce((
		select e.angenommen is null
			and e.laeuft_ab > now()
			and bt.abo_status <> 'gesperrt'
			and not coalesce(
				bt.abo_ende is not null and case bt.abo_status
					when 'ueberfaellig' then bt.abo_ende + 14 < (now() at time zone 'Europe/Berlin')::date
					when 'gekuendigt' then bt.abo_ende < (now() at time zone 'Europe/Berlin')::date
					else false
				end, false)
			and not exists (select 1 from app.benutzer b where b.email operator(public.=) e.email)
		from app.einladungen e
		join app.betriebe bt on bt.id = e.betrieb_id
		where e.id = p_id
	), false);
$$;

-- Für die Einladungsseite: E-Mail und Name des Betriebs, wenn die Einladung gilt; sonst nichts.
create function app.einladung_pruefen(p_hash bytea)
returns table (email public.citext, betrieb text)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select e.email, bt.name
	from app.einladungen e
	join app.betriebe bt on bt.id = e.betrieb_id
	where e.token_hash = p_hash
		and app.einladung_gueltig(e.id);
$$;

-- Nimmt eine Einladung an: legt den Benutzer (Rolle und Betrieb aus der Einladung) mit dem übergebenen
-- Argon2id-Hash an und markiert die Einladung als angenommen. Liefert die neue Benutzer-ID oder NULL, wenn die
-- Einladung nicht (mehr) gilt. Gleichzeitige Annahmen desselben Tokens laufen über die Zeilensperre hintereinander.
--
-- Benutzergrenze: Hier wird sie erneut und atomar geprüft (gleiche Sperre wie pruefeGrenze in tarif.ts, Schlüssel
-- 'benutzergrenze:<betrieb_id>'). Gezählt werden die aktiven Benutzer: Nach der Annahme dürfen es höchstens so viele
-- sein, wie der Tarif erlaubt. Ist die Grenze erreicht: Fehler 'benutzergrenze' (P0001), die Einladung bleibt offen.
-- Fehlt die Grenze im Tarif oder ist sie unbrauchbar: Fehler (fail closed); JSON null bedeutet unbegrenzt.
-- Sperr-Reihenfolge wie beim Einladen: erst Einladungszeile, dann Grenz-Sperre (keine Verklemmung).
create function app.einladung_annehmen(p_hash bytea, p_name text, p_passwort_hash text)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_e app.einladungen%rowtype;
	v_grenze jsonb;
	v_anzahl integer;
	v_id uuid;
begin
	if p_hash is null
		or p_name is null or btrim(p_name) = '' or length(p_name) > 100
		or p_passwort_hash is null or p_passwort_hash not like '$argon2id$%'
	then
		raise exception 'einladung_annehmen: ungültige Eingabe' using errcode = '22023';
	end if;

	select * into v_e from app.einladungen e where e.token_hash = p_hash for update;
	if not found or not app.einladung_gueltig(v_e.id) then
		return null;
	end if;

	perform pg_advisory_xact_lock(hashtextextended('benutzergrenze:' || v_e.betrieb_id::text, 0));
	select t.grenzen -> 'benutzer',
		(select count(*)::int from app.benutzer u where u.betrieb_id = bt.id and u.aktiv)
	into v_grenze, v_anzahl
	from app.betriebe bt
	join app.tarife t on t.id = bt.tarif_id
	where bt.id = v_e.betrieb_id;
	-- CASE in Klammern: PL/pgSQL beendet die IF-Bedingung sonst am ersten THEN.
	if v_grenze is null or (case jsonb_typeof(v_grenze)
			when 'null' then false
			when 'number' then (v_grenze #>> '{}')::numeric < 0
			else true
		end)
	then
		raise exception 'einladung_annehmen: Tarif ohne gültige Benutzergrenze';
	end if;
	if jsonb_typeof(v_grenze) = 'number' and v_anzahl >= (v_grenze #>> '{}')::numeric then
		-- Die Ausnahme rollt die Transaktion zurück; bis hier wurde nichts geschrieben.
		raise exception 'benutzergrenze' using errcode = 'P0001';
	end if;

	begin
		insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
		values (v_e.betrieb_id, v_e.email, btrim(p_name), p_passwort_hash, v_e.rolle_id)
		returning id into v_id;
	exception when unique_violation then
		-- E-Mail wurde gleichzeitig über eine andere Einladung registriert
		return null;
	end;
	update app.einladungen e set angenommen = now() where e.id = v_e.id;
	return v_id;
end;
$$;

revoke execute on function app.email_vergeben(public.citext) from public, crm_admin, crm_auth;
revoke execute on function app.einladung_gueltig(uuid) from public, crm_app, crm_admin, crm_auth;
revoke execute on function app.einladung_pruefen(bytea) from public, crm_app, crm_admin;
revoke execute on function app.einladung_annehmen(bytea, text, text) from public, crm_app, crm_admin;
grant execute on function app.email_vergeben(public.citext) to crm_app;
grant execute on function app.einladung_pruefen(bytea) to crm_auth;
grant execute on function app.einladung_annehmen(bytea, text, text) to crm_auth;

-- ---------------------------------------------------------------------------------------------------------------
-- Ruling R13: Eine volle Sitzung weiß, ob sie nach erfolgreichem zweiten Faktor entstanden ist. sitzung_pruefen
-- verwirft volle Sitzungen ohne zweiten Faktor, wenn das Konto ihn braucht (Plattform-Admin oder Recht
-- 'einstellungen'). Schließt das Rennen „Rolle bekommt 'einstellungen' während einer parallelen Anmeldung“ und
-- macht das Beenden von Sitzungen beim Rollenwechsel zur zweiten Verteidigungslinie.
-- Entstehungswege: anmeldung_weiter/sitzung_anlegen (ohne Faktor → false), zweiten_faktor_abschliessen (→ true).
alter table app.sitzungen add column mit_zweitem_faktor boolean not null default false;

create or replace function app.sitzung_pruefen(p_hash bytea)
returns table (
	benutzer_id uuid, betrieb_id uuid, ist_admin boolean, rolle_rechte text[], betrieb_status text,
	verlaengert boolean
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
#variable_conflict use_column
declare
	v_benutzer uuid;
	v_ablauf timestamptz;
	v_mit_faktor boolean;
	v_verlaengert boolean := false;
begin
	select s.benutzer_id, s.laeuft_ab, s.mit_zweitem_faktor into v_benutzer, v_ablauf, v_mit_faktor
	from app.sitzungen s
	join app.benutzer b on b.id = s.benutzer_id
	left join app.betriebe bt on bt.id = b.betrieb_id
	where s.token_hash = p_hash
		and not s.zweiter_faktor_offen
		and s.laeuft_ab > now()
		and b.aktiv
		and (b.betrieb_id is null or bt.abo_status <> 'gesperrt');
	if v_benutzer is null then
		return;
	end if;

	-- R13: Pflicht-2FA (Plattform-Admin oder 'einstellungen'), aber Sitzung ohne zweiten Faktor → keine Sitzung.
	if not v_mit_faktor and (
		exists (select 1 from app.plattform_admins pa where pa.benutzer_id = v_benutzer)
		or exists (
			select 1 from app.benutzer b
			join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
			where b.id = v_benutzer and 'einstellungen' = any (r.rechte)
		)
	) then
		return;
	end if;

	if v_ablauf < now() + interval '29 days' then
		update app.sitzungen s set laeuft_ab = now() + interval '30 days' where s.token_hash = p_hash;
		update app.benutzer b set letzte_aktivitaet = now() where b.id = v_benutzer;
		v_verlaengert := true;
	end if;

	return query
		select b.id,
			b.betrieb_id,
			exists (select 1 from app.plattform_admins pa where pa.benutzer_id = b.id),
			coalesce(r.rechte, '{}'::text[]),
			bt.abo_status,
			v_verlaengert
		from app.benutzer b
		left join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		left join app.betriebe bt on bt.id = b.betrieb_id
		where b.id = v_benutzer;
end;
$$;

-- Wie in 003a, aber die neue volle Sitzung trägt mit_zweitem_faktor = true.
create or replace function app.zweiten_faktor_abschliessen(
	p_hash bytea, p_schritt bigint, p_neu_hash bytea, p_neu_ablauf timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_benutzer uuid;
	v_geheim text;
	v_letzter bigint;
	v_gesperrt boolean;
begin
	select d.benutzer_id into v_benutzer from app.vorsitzung_daten(p_hash) d;
	if v_benutzer is null then
		return false;
	end if;
	-- Benutzerzeile sperren, danach alles frisch lesen: gleichzeitige Anfragen laufen hintereinander.
	perform 1 from app.benutzer b where b.id = v_benutzer for update;
	select d.totp_geheim, d.totp_letzter_schritt, d.gesperrt
	into v_geheim, v_letzter, v_gesperrt
	from app.vorsitzung_daten(p_hash) d;
	if not found then
		return false;
	end if;
	if v_geheim is null
		or v_gesperrt
		or p_schritt is null
		-- Der Zeitschritt kommt vom Aufrufer; die Datenbank akzeptiert nur Schritte nahe der eigenen Uhr (±1).
		or abs(p_schritt - floor(extract(epoch from now()) / 30)) > 1
		or p_schritt <= coalesce(v_letzter, -1)
	then
		return false;
	end if;

	update app.benutzer b
	set totp_aktiv = true, totp_geheim = v_geheim, totp_letzter_schritt = p_schritt, totp_fehlversuche = 0,
		totp_sperr_stufe = 0, totp_gesperrt_bis = null, letzte_aktivitaet = now()
	where b.id = v_benutzer;
	delete from app.sitzungen s
	where s.benutzer_id = v_benutzer and (s.zweiter_faktor_offen or s.laeuft_ab <= now());
	insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, mit_zweitem_faktor)
	values (p_neu_hash, v_benutzer, p_neu_ablauf, true);
	return true;
end;
$$;

-- create or replace behält die Rechte; zur Sicherheit noch einmal ausdrücklich (R7/R10).
revoke execute on function app.sitzung_pruefen(bytea) from public, crm_app, crm_admin;
revoke execute on function app.zweiten_faktor_abschliessen(bytea, bigint, bytea, timestamptz) from public, crm_app, crm_admin;
grant execute on function app.sitzung_pruefen(bytea) to crm_auth;
grant execute on function app.zweiten_faktor_abschliessen(bytea, bigint, bytea, timestamptz) to crm_auth;
