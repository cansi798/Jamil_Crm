-- Anmeldung und Sitzungen.
-- Die Funktionen sind SECURITY DEFINER und gehören dem Migrations-Superuser crm (umgeht RLS). Deshalb:
--   * fester search_path (app, pg_temp), damit niemand Objekte unterschieben kann,
--   * jede Abfrage filtert ausdrücklich nach der übergebenen E-Mail bzw. dem Token-Hash,
--   * EXECUTE nur für crm_app (nie für public), passwort_hash liefert nur anmeldung_finden.

-- Ruling R6: crm_app darf passwort_hash weder lesen noch ändern (Anmeldung läuft über anmeldung_finden).
-- INSERT bleibt tabellenweit (neue Benutzer brauchen einen Hash); Passwortwechsel später über eine eigene Funktion.
-- Hinweis: Neue Spalten an app.benutzer müssen künftig ausdrücklich freigegeben werden.
revoke select, update on app.benutzer from crm_app;
grant select (id, betrieb_id, email, name, rolle_id, aktiv, totp_geheim, totp_aktiv, letzte_aktivitaet)
	on app.benutzer to crm_app;
grant update (id, betrieb_id, email, name, rolle_id, aktiv, totp_geheim, totp_aktiv, letzte_aktivitaet)
	on app.benutzer to crm_app;

-- Aufräumen abgelaufener Sitzungen in sitzung_anlegen soll schnell sein.
create index if not exists sitzungen_laeuft_ab_idx on app.sitzungen (laeuft_ab);

-- Sucht ein Konto für die Anmeldung. Als Einzige gibt diese Funktion den Passwort-Hash zurück.
create function app.anmeldung_finden(p_email public.citext)
returns table (id uuid, betrieb_id uuid, passwort_hash text, aktiv boolean, totp_aktiv boolean)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select b.id, b.betrieb_id, b.passwort_hash, b.aktiv, b.totp_aktiv
	from app.benutzer b
	-- citext-Operator ausdrücklich aus public: der search_path enthält public absichtlich nicht.
	where b.email operator(public.=) p_email;
$$;

-- Legt eine Sitzung an (nur der SHA-256 des Tokens wird gespeichert) und räumt abgelaufene Sitzungen desselben Benutzers weg.
create function app.sitzung_anlegen(p_benutzer uuid, p_hash bytea, p_ablauf timestamptz)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
	delete from app.sitzungen s where s.benutzer_id = p_benutzer and s.laeuft_ab <= now();
	insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab) values (p_hash, p_benutzer, p_ablauf);
end;
$$;

-- Prüft eine Sitzung. Liefert nichts, wenn sie unbekannt oder abgelaufen ist, der Benutzer inaktiv
-- oder der Betrieb gesperrt ist. Verlängert gültige Sitzungen gleitend auf +30 Tage.
create function app.sitzung_pruefen(p_hash bytea)
returns table (benutzer_id uuid, betrieb_id uuid, ist_admin boolean, rolle_rechte text[], betrieb_status text)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
#variable_conflict use_column
declare
	v_benutzer uuid;
begin
	select s.benutzer_id into v_benutzer
	from app.sitzungen s
	join app.benutzer b on b.id = s.benutzer_id
	left join app.betriebe bt on bt.id = b.betrieb_id
	where s.token_hash = p_hash
		and s.laeuft_ab > now()
		and b.aktiv
		and (b.betrieb_id is null or bt.abo_status <> 'gesperrt');
	if v_benutzer is null then
		return;
	end if;

	update app.sitzungen s set laeuft_ab = now() + interval '30 days' where s.token_hash = p_hash;
	update app.benutzer b set letzte_aktivitaet = now() where b.id = v_benutzer;

	return query
		select b.id,
			b.betrieb_id,
			exists (select 1 from app.plattform_admins pa where pa.benutzer_id = b.id),
			coalesce(r.rechte, '{}'::text[]),
			bt.abo_status
		from app.benutzer b
		left join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		left join app.betriebe bt on bt.id = b.betrieb_id
		where b.id = v_benutzer;
end;
$$;

create function app.sitzung_loeschen(p_hash bytea)
returns void
language sql
security definer
set search_path = app, pg_temp
as $$
	delete from app.sitzungen s where s.token_hash = p_hash;
$$;

revoke execute on function app.anmeldung_finden(public.citext) from public;
revoke execute on function app.sitzung_anlegen(uuid, bytea, timestamptz) from public;
revoke execute on function app.sitzung_pruefen(bytea) from public;
revoke execute on function app.sitzung_loeschen(bytea) from public;
grant execute on function app.anmeldung_finden(public.citext) to crm_app;
grant execute on function app.sitzung_anlegen(uuid, bytea, timestamptz) to crm_app;
grant execute on function app.sitzung_pruefen(bytea) to crm_app;
grant execute on function app.sitzung_loeschen(bytea) to crm_app;
