-- Sitzungen beenden, wenn ein Benutzer neu das Recht 'einstellungen' bekommt (Carry T7): Für solche Konten ist der
-- zweite Faktor Pflicht (003a). Bestehende Sitzungen wurden ohne Code angelegt und müssen deshalb enden, damit die
-- Pflicht sofort greift.
--
-- crm_app hat keinerlei Rechte auf app.sitzungen. Deshalb SECURITY DEFINER (Eigentümer crm, umgeht RLS) mit
--   * festem search_path (app, pg_temp),
--   * ausdrücklicher Beschränkung auf den Betrieb aus app.betrieb_id (nie mandantenübergreifend; ohne gesetzten oder
--     bei leerem Kontext passiert nichts),
--   * EXECUTE nur für crm_app (nie public, crm_auth, crm_admin).
-- Beide liefern die Zahl der gelöschten Sitzungen (inklusive offener Vor-Sitzungen).

-- Alle Sitzungen der Benutzer einer Rolle im aktuellen Betrieb (die Rolle gehört wegen des zusammengesetzten
-- Fremdschlüssels immer zum Betrieb ihrer Benutzer).
create function app.sitzungen_beenden_fuer_rolle(p_rolle uuid)
returns integer
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_betrieb uuid := nullif(current_setting('app.betrieb_id', true), '')::uuid;
	v_anzahl integer;
begin
	if v_betrieb is null or p_rolle is null then
		return 0;
	end if;
	delete from app.sitzungen s
	using app.benutzer b
	where s.benutzer_id = b.id
		and b.betrieb_id = v_betrieb
		and b.rolle_id = p_rolle;
	get diagnostics v_anzahl = row_count;
	return v_anzahl;
end;
$$;

-- Alle Sitzungen eines einzelnen Benutzers des aktuellen Betriebs (z. B. wenn er einer Rolle mit 'einstellungen'
-- zugewiesen wird).
create function app.sitzungen_beenden_fuer_benutzer(p_benutzer uuid)
returns integer
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_betrieb uuid := nullif(current_setting('app.betrieb_id', true), '')::uuid;
	v_anzahl integer;
begin
	if v_betrieb is null or p_benutzer is null then
		return 0;
	end if;
	delete from app.sitzungen s
	using app.benutzer b
	where s.benutzer_id = b.id
		and b.betrieb_id = v_betrieb
		and b.id = p_benutzer;
	get diagnostics v_anzahl = row_count;
	return v_anzahl;
end;
$$;

revoke execute on function app.sitzungen_beenden_fuer_rolle(uuid) from public, crm_admin, crm_auth;
revoke execute on function app.sitzungen_beenden_fuer_benutzer(uuid) from public, crm_admin, crm_auth;
grant execute on function app.sitzungen_beenden_fuer_rolle(uuid) to crm_app;
grant execute on function app.sitzungen_beenden_fuer_benutzer(uuid) to crm_app;
