-- Zwei-Faktor-Anmeldung (TOTP). Ruling R1 (eigene Migration nach 003_auth) und R11 (Design).
--
-- Vor-Sitzung = Zeile in app.sitzungen mit zweiter_faktor_offen = true und 5 Minuten Laufzeit. Sie entsteht nach
-- dem richtigen Passwort, wenn noch ein Code fehlt, und ist KEINE Sitzung: sitzung_pruefen ignoriert sie.
-- Erst zweiten_faktor_abschliessen tauscht sie nach gültigem Code gegen eine volle Sitzung.
--
-- Alle Funktionen sind SECURITY DEFINER (Eigentümer crm, umgeht RLS) mit festem search_path, ohne EXECUTE für
-- public/crm_app, EXECUTE nur für crm_auth (R7, R10). Sie werden über den Hash der Vor-Sitzung angesprochen, nie über
-- eine frei gewählte benutzer_id. Den Code selbst prüft der Anwendungscode (otpauth); die Datenbank sorgt für
-- Atomarität: Zeitschritt nur einmal verwendbar, Fehlversuche je Benutzer begrenzt, Sitzungstausch in einem Schritt.

alter table app.sitzungen add column zweiter_faktor_offen boolean not null default false;

alter table app.benutzer
	-- letzter erfolgreich genutzter Zeitschritt (Unix-Zeit / 30 s); ein Code gilt nur, wenn sein Schritt größer ist
	add column totp_letzter_schritt bigint,
	-- Fehlversuche seit dem letzten Erfolg; beim 5. wird gesperrt und zurückgesetzt
	add column totp_fehlversuche smallint not null default 0,
	add column totp_gesperrt_bis timestamptz,
	add constraint totp_aktiv_braucht_geheimnis check (not totp_aktiv or totp_geheim is not null);

-- Ruling R6 (Abschluss): crm_app darf Geheimnis und Aktiv-Schalter weder lesen noch ändern. Die neuen Spalten
-- (totp_letzter_schritt, totp_fehlversuche, totp_gesperrt_bis) sind nie freigegeben worden.
revoke select (totp_geheim, totp_aktiv), update (totp_geheim, totp_aktiv) on app.benutzer from crm_app;

-- Interne Hilfsfunktion (nur für andere Funktionen dieses Eigentümers): braucht dieses Konto einen zweiten Faktor?
-- Ja bei aktivem TOTP (jede Rolle), bei Plattform-Admins und bei Rollen mit dem Recht 'einstellungen'.
-- Unbekannte Benutzer gelten sicherheitshalber als „ja“.
create function app.zweiter_faktor_noetig(p_benutzer uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select coalesce(
		(select b.totp_aktiv
			or exists (select 1 from app.plattform_admins pa where pa.benutzer_id = b.id)
			or exists (
				select 1 from app.rollen r
				where r.id = b.rolle_id and r.betrieb_id = b.betrieb_id and 'einstellungen' = any (r.rechte)
			)
		from app.benutzer b where b.id = p_benutzer),
		true
	);
$$;

-- Sitzung ohne Code gibt es für Konten mit Pflicht-2FA nicht (Verteidigung in der Tiefe; der Login geht über
-- anmeldung_weiter).
create or replace function app.sitzung_anlegen(p_benutzer uuid, p_hash bytea, p_ablauf timestamptz)
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
	) or app.zweiter_faktor_noetig(p_benutzer) then
		return false;
	end if;
	delete from app.sitzungen s where s.benutzer_id = p_benutzer and s.laeuft_ab <= now();
	insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab) values (p_hash, p_benutzer, p_ablauf);
	return true;
end;
$$;

-- Vor-Sitzungen zählen nicht als Sitzung.
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
	v_verlaengert boolean := false;
begin
	select s.benutzer_id, s.laeuft_ab into v_benutzer, v_ablauf
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

-- Eingang nach dem richtigen Passwort: entscheidet selbst, ob eine volle Sitzung oder eine Vor-Sitzung entsteht.
--   'verweigert'  Benutzer inaktiv/unbekannt oder Betrieb gesperrt (nichts angelegt)
--   'gesperrt'    zweiter Faktor wegen zu vieler Fehlversuche vorübergehend gesperrt (nichts angelegt)
--   'sitzung'     volle Sitzung (p_voll_hash, p_voll_ablauf) angelegt – kein zweiter Faktor nötig
--   'code'        Vor-Sitzung (p_vor_hash, 5 Minuten) angelegt; 2FA ist aktiv, Code eingeben
--   'einrichten'  Vor-Sitzung angelegt; 2FA ist Pflicht, aber noch nicht eingerichtet
-- Je Benutzer bleiben höchstens 5 Vor-Sitzungen bestehen.
create function app.anmeldung_weiter(
	p_benutzer uuid, p_voll_hash bytea, p_voll_ablauf timestamptz, p_vor_hash bytea
)
returns text
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_aktiv boolean;
	v_gesperrt timestamptz;
begin
	select b.totp_aktiv, b.totp_gesperrt_bis into v_aktiv, v_gesperrt
	from app.benutzer b
	left join app.betriebe bt on bt.id = b.betrieb_id
	where b.id = p_benutzer
		and b.aktiv
		and (b.betrieb_id is null or bt.abo_status <> 'gesperrt');
	if not found then
		return 'verweigert';
	end if;

	delete from app.sitzungen s where s.benutzer_id = p_benutzer and s.laeuft_ab <= now();

	if not app.zweiter_faktor_noetig(p_benutzer) then
		insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab) values (p_voll_hash, p_benutzer, p_voll_ablauf);
		return 'sitzung';
	end if;

	if v_gesperrt is not null and v_gesperrt > now() then
		return 'gesperrt';
	end if;

	delete from app.sitzungen s
	where s.benutzer_id = p_benutzer
		and s.zweiter_faktor_offen
		and s.token_hash not in (
			select s2.token_hash from app.sitzungen s2
			where s2.benutzer_id = p_benutzer and s2.zweiter_faktor_offen
			order by s2.angelegt desc
			limit 4
		);
	insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, zweiter_faktor_offen)
	values (p_vor_hash, p_benutzer, now() + interval '5 minutes', true);
	return case when v_aktiv then 'code' else 'einrichten' end;
end;
$$;

-- Daten zur Vor-Sitzung für die Code-Prüfung im Anwendungscode. Nichts, wenn sie unbekannt/abgelaufen ist, keine
-- Vor-Sitzung ist (volle Sitzungen werden nie herausgegeben), der Benutzer inaktiv oder der Betrieb gesperrt ist.
create function app.vorsitzung_daten(p_hash bytea)
returns table (
	benutzer_id uuid, email public.citext, totp_geheim text, totp_aktiv boolean, totp_letzter_schritt bigint,
	gesperrt boolean
)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select b.id, b.email, b.totp_geheim, b.totp_aktiv, b.totp_letzter_schritt,
		coalesce(b.totp_gesperrt_bis > now(), false)
	from app.sitzungen s
	join app.benutzer b on b.id = s.benutzer_id
	left join app.betriebe bt on bt.id = b.betrieb_id
	where s.token_hash = p_hash
		and s.zweiter_faktor_offen
		and s.laeuft_ab > now()
		and b.aktiv
		and (b.betrieb_id is null or bt.abo_status <> 'gesperrt');
$$;

-- Einrichtung: liefert das noch nicht aktivierte Geheimnis des Benutzers der Vor-Sitzung und legt p_neu an, falls
-- es noch keines gibt. Bei bereits aktivem TOTP, ungültiger Vor-Sitzung oder falschem Format: null – ein aktives
-- Geheimnis kann damit weder gelesen noch ersetzt werden.
create function app.totp_geheimnis_vorbereiten(p_hash bytea, p_neu text)
returns text
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_benutzer uuid;
	v_aktiv boolean;
	v_geheim text;
begin
	if p_neu is null or p_neu !~ '^[A-Z2-7]{32}$' then
		return null;
	end if;
	select d.benutzer_id into v_benutzer from app.vorsitzung_daten(p_hash) d;
	if v_benutzer is null then
		return null;
	end if;
	select b.totp_aktiv, b.totp_geheim into v_aktiv, v_geheim
	from app.benutzer b where b.id = v_benutzer for update;
	if v_aktiv then
		return null;
	end if;
	if v_geheim is null then
		update app.benutzer b set totp_geheim = p_neu where b.id = v_benutzer;
		return p_neu;
	end if;
	return v_geheim;
end;
$$;

-- Zählt einen falschen Code (je Benutzer, nicht je Vor-Sitzung – sonst ließe sich durch neue Anmeldungen
-- unbegrenzt weiterraten). Beim 5. Fehlversuch: alle Vor-Sitzungen des Benutzers löschen, 15 Minuten sperren.
-- Rückgabe: -1 Vor-Sitzung ungültig/abgelaufen, 0 gesperrt (Vor-Sitzung ist weg), sonst Zahl verbleibender Versuche.
create function app.vorsitzung_fehlversuch(p_hash bytea)
returns smallint
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_benutzer uuid;
	v_n smallint;
	v_gesperrt timestamptz;
begin
	select d.benutzer_id into v_benutzer from app.vorsitzung_daten(p_hash) d;
	if v_benutzer is null then
		return -1;
	end if;
	select b.totp_fehlversuche, b.totp_gesperrt_bis into v_n, v_gesperrt
	from app.benutzer b where b.id = v_benutzer for update;
	if v_gesperrt is not null then
		if v_gesperrt > now() then
			return 0;
		end if;
		v_n := 0; -- Sperre ist abgelaufen: neu zählen
	end if;
	v_n := v_n + 1;
	if v_n >= 5 then
		update app.benutzer b set totp_fehlversuche = 0, totp_gesperrt_bis = now() + interval '15 minutes'
		where b.id = v_benutzer;
		delete from app.sitzungen s where s.benutzer_id = v_benutzer and s.zweiter_faktor_offen;
		return 0;
	end if;
	update app.benutzer b set totp_fehlversuche = v_n, totp_gesperrt_bis = null where b.id = v_benutzer;
	return (5 - v_n)::smallint;
end;
$$;

-- Tauscht eine Vor-Sitzung nach gültigem Code gegen eine volle Sitzung (p_neu_hash, p_neu_ablauf).
-- p_schritt ist der Zeitschritt des geprüften Codes; er muss größer sein als der zuletzt genutzte – so ist jeder
-- Code nur einmal verwendbar, auch bei gleichzeitigen Anfragen (Zeile des Benutzers ist gesperrt). Ist TOTP noch
-- nicht aktiv (Einrichtung), wird es hier aktiviert; ein gespeichertes Geheimnis ist dafür Voraussetzung.
-- false (nichts geändert), wenn die Vor-Sitzung ungültig ist, das Konto gesperrt, der Schritt schon benutzt wurde usw.
create function app.zweiten_faktor_abschliessen(
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
	v_gesperrt timestamptz;
begin
	select d.benutzer_id into v_benutzer from app.vorsitzung_daten(p_hash) d;
	if v_benutzer is null then
		return false;
	end if;
	-- Benutzerzeile sperren, danach alles frisch lesen: gleichzeitige Anfragen laufen hintereinander.
	select b.totp_geheim, b.totp_letzter_schritt, b.totp_gesperrt_bis into v_geheim, v_letzter, v_gesperrt
	from app.benutzer b where b.id = v_benutzer for update;
	if not exists (select 1 from app.vorsitzung_daten(p_hash)) then
		return false;
	end if;
	if v_geheim is null
		or (v_gesperrt is not null and v_gesperrt > now())
		or p_schritt is null
		or p_schritt <= coalesce(v_letzter, -1)
	then
		return false;
	end if;

	update app.benutzer b
	set totp_aktiv = true, totp_letzter_schritt = p_schritt, totp_fehlversuche = 0, totp_gesperrt_bis = null,
		letzte_aktivitaet = now()
	where b.id = v_benutzer;
	delete from app.sitzungen s
	where s.benutzer_id = v_benutzer and (s.zweiter_faktor_offen or s.laeuft_ab <= now());
	insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab) values (p_neu_hash, v_benutzer, p_neu_ablauf);
	return true;
end;
$$;

revoke execute on function app.zweiter_faktor_noetig(uuid) from public, crm_app, crm_admin, crm_auth;
revoke execute on function app.anmeldung_weiter(uuid, bytea, timestamptz, bytea) from public, crm_app;
revoke execute on function app.vorsitzung_daten(bytea) from public, crm_app;
revoke execute on function app.totp_geheimnis_vorbereiten(bytea, text) from public, crm_app;
revoke execute on function app.vorsitzung_fehlversuch(bytea) from public, crm_app;
revoke execute on function app.zweiten_faktor_abschliessen(bytea, bigint, bytea, timestamptz) from public, crm_app;
grant execute on function app.anmeldung_weiter(uuid, bytea, timestamptz, bytea) to crm_auth;
grant execute on function app.vorsitzung_daten(bytea) to crm_auth;
grant execute on function app.totp_geheimnis_vorbereiten(bytea, text) to crm_auth;
grant execute on function app.vorsitzung_fehlversuch(bytea) to crm_auth;
grant execute on function app.zweiten_faktor_abschliessen(bytea, bigint, bytea, timestamptz) to crm_auth;
