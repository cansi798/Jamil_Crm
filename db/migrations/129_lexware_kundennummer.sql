-- Lexware-Kundennummer als DIE Kundennummer im CRM (Can #6748, Plan freigegeben 21.11.2026) und Ratenlimit über alle
-- Prozesse (Prüfbericht 21.11.2026).
--
-- 1. kunden.lexware_kundennummer: die Kundennummer, die Lexware beim Anlegen eines Kontakts mit Rolle „Kunde“ vergibt
--    (Doku https://developers.lexware.io/docs/ → Contacts → Roles Details: roles.customer.number, Integer, „Unique
--    customer number within the current organization … created by Lexware … cannot be set during creation and cannot be
--    changed“; die POST-Antwort enthält sie nicht, GET /v1/contacts/{id} schon). Eindeutig je Betrieb. Die interne ID
--    (kunden.id) bleibt technischer Primärschlüssel. Ohne Lexware zeigt die Oberfläche „Kundennummer folgt von Lexware“.
-- 2. lexware_konfig.kunden_auto_seit: ab wann das CRM neu angelegte Kunden selbst in Lexware anlegt (Plan a) – gesetzt,
--    sobald die Verbindung steht. Ältere, nicht gefundene Kunden legt weiter nur der Schalter „fehlende Kunden in Lexware
--    anlegen“ an (sonst drohen Doppel in Lexware). Der einmalige Abgleich aller Kunden (Verknüpfen + Nummern holen)
--    läuft über die Warteschlange (Idempotenz „kontakte_abgleichen:kundennummern“).
-- 3. lexware_takt: nächster freier Platz für eine Anfrage je Betrieb (Lexware erlaubt 2 Anfragen/s je Schlüssel) – gilt
--    für alle App-Prozesse; vergeben über app.lexware_takt_platz (nur crm_auth).

alter table app.kunden add column lexware_kundennummer integer check (lexware_kundennummer > 0);
alter table app.kunden add constraint kunden_lexware_kundennummer_eindeutig unique (betrieb_id, lexware_kundennummer);
grant update (lexware_kundennummer) on app.kunden to crm_app;

alter table app.lexware_konfig add column kunden_auto_seit timestamptz;
grant select (kunden_auto_seit) on app.lexware_konfig to crm_app;
grant update (kunden_auto_seit) on app.lexware_konfig to crm_app;
update app.lexware_konfig set kunden_auto_seit = now() where status = 'verbunden';

create table app.lexware_takt (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	naechster timestamptz not null
);
revoke all on app.lexware_takt from public, crm_app, crm_admin, crm_auth;

-- Platz für die nächste Anfrage reservieren: Ergebnis = Wartezeit in Millisekunden (0 = sofort).
create function app.lexware_takt_platz(p_betrieb uuid, p_abstand_ms integer)
returns integer language plpgsql security definer set search_path = app, pg_temp as $$
declare v_platz timestamptz;
begin
	insert into app.lexware_takt as t (betrieb_id, naechster)
	values (p_betrieb, clock_timestamp() + make_interval(secs => greatest(p_abstand_ms, 0) / 1000.0))
	on conflict (betrieb_id) do update
		set naechster = greatest(t.naechster, clock_timestamp()) + make_interval(secs => greatest(p_abstand_ms, 0) / 1000.0)
	returning naechster - make_interval(secs => greatest(p_abstand_ms, 0) / 1000.0) into v_platz;
	return greatest(0, ceil(extract(epoch from (v_platz - clock_timestamp())) * 1000))::integer;
end $$;

-- Nach 429 (Retry-After): den Schlüssel des Betriebs so lange für alle Prozesse sperren.
create function app.lexware_takt_sperren(p_betrieb uuid, p_ms integer)
returns void language sql security definer set search_path = app, pg_temp as $$
	insert into app.lexware_takt as t (betrieb_id, naechster) values (p_betrieb, clock_timestamp() + make_interval(secs => greatest(p_ms, 0) / 1000.0))
	on conflict (betrieb_id) do update set naechster = greatest(t.naechster, excluded.naechster);
$$;

revoke all on function app.lexware_takt_platz(uuid, integer), app.lexware_takt_sperren(uuid, integer) from public, crm_app, crm_admin;
grant execute on function app.lexware_takt_platz(uuid, integer), app.lexware_takt_sperren(uuid, integer) to crm_auth;

-- „Erneut versuchen“ von Hand (Prüfbericht 21.11.2026: Mahnungen): Die Warteschlange merkt sich in der Nutzlast, dass
-- ein Mensch nachgesehen und bestätigt hat (erneutVonHand) – Mahnungen lassen sich in Lexware nicht suchen.
grant update (nutzlast) on app.lexware_auftraege to crm_app;
