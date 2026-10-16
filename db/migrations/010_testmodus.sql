-- Testmodus der Vorschau (Wunsch Can + Jamil, 16.10.2026): Anmeldung nur mit Benutzername – ohne Passwort und
-- ohne zweiten Faktor –, ausschließlich für Test-Konten (E-Mail endet auf „.test“). Die Anwendung ruft diese
-- Funktion nur auf, wenn CRM_TESTMODUS=1 gesetzt ist; die Einschränkung auf .test-Konten gilt zusätzlich hier in
-- der Datenbank (Verteidigung in der Tiefe). Echte Konten melden sich weiter mit Passwort und 2FA an.
create function app.test_anmeldung(p_benutzer uuid, p_hash bytea, p_ablauf timestamptz)
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
	) then
		return false;
	end if;
	delete from app.sitzungen s where s.benutzer_id = p_benutzer and s.laeuft_ab <= now();
	-- mit_zweitem_faktor = true: sitzung_pruefen (R13) verlangt das für Konten mit Pflicht-2FA; im Testmodus
	-- (nur .test-Konten, siehe oben) gilt die Sitzung bewusst als bestätigt.
	insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, mit_zweitem_faktor)
	values (p_hash, p_benutzer, p_ablauf, true);
	return true;
end;
$$;
revoke execute on function app.test_anmeldung(uuid, bytea, timestamptz) from public, crm_app, crm_admin;
grant execute on function app.test_anmeldung(uuid, bytea, timestamptz) to crm_auth;
