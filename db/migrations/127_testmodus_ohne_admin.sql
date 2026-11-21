-- Testmodus (Prüfbericht 21.11.2026, Can 23:21): Plattform-Admins dürfen sich NIE ohne Passwort anmelden – auch nicht
-- mit einer .test-Adresse. Der passwortlose Testzugang bleibt für Test-Konten der Betriebe (Chef, Büro, Monteur …).
-- Admin-Testkonten melden sich mit Passwort und zweitem Faktor an (scripts/testzugaenge.ts legt beides an).
create or replace function app.test_anmeldung(p_benutzer uuid, p_hash bytea, p_ablauf timestamptz)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
	if not exists (
		select 1
		from app.benutzer b
		left join app.betriebe bt on bt.id = b.betrieb_id
		where b.id = p_benutzer
			and b.aktiv
			and (b.betrieb_id is null or bt.abo_status <> 'gesperrt')
			and lower(b.email::text) like '%.test'
			and not exists (select 1 from app.plattform_admins pa where pa.benutzer_id = b.id)
	) then
		return false;
	end if;
	delete from app.sitzungen s where s.benutzer_id = p_benutzer and s.laeuft_ab <= now();
	insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, mit_zweitem_faktor)
	values (p_hash, p_benutzer, p_ablauf, true);
	return true;
end;
$$;
revoke execute on function app.test_anmeldung(uuid, bytea, timestamptz) from public, crm_app, crm_admin;
grant execute on function app.test_anmeldung(uuid, bytea, timestamptz) to crm_auth;
