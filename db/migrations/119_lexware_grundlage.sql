-- Lexware Office als Belegsystem – Grundlage (Plan „Lexware als Belegsystem“, Task T3; Jamil Talk #6086/#6088/#6093).
-- Schnittstelle: https://developers.lexware.io/docs/ (nur Tarif XL, Bearer-Schlüssel höchstens 24 Monate gültig,
-- Ratenlimit 2 Anfragen/s je Schlüssel, Rückmeldungen per Event-Subscription mit Signatur X-Lxo-Signature).
--
-- 1. app.lexware_konfig: Verbindung je Betrieb. Der API-Schlüssel liegt AES-256-GCM-verschlüsselt in `schluessel`;
--    crm_app darf ihn schreiben, aber NICHT lesen (nur app.lexware_schluessel() für crm_auth).
-- 2. app.lexware_auftraege: Ausgangs-Warteschlange. Alles, was zu Lexware geht, wird erst hier gespeichert. Der
--    Idempotenz-Schlüssel ist je Betrieb eindeutig → derselbe Auftrag (z. B. „Kontakt für Kunde X anlegen“) entsteht nie
--    doppelt. Zustände: wartet → laeuft → erledigt | wartet (Wiederholung) | ungewiss (Zeitüberschreitung bei einem
--    anlegenden Aufruf: vor dem Neuversuch wird in Lexware nachgesehen) | pruefen (Mensch muss schauen) | abgebrochen.
-- 3. app.lexware_protokoll: jede Anfrage (Methode, Pfad, Status, Dauer, Fehler) – nie Schlüssel oder Inhalte; 90 Tage.
-- 4. app.lexware_belege: Spiegel der Lexware-Belege (aus Belegliste/Rückmeldungen). Nie von Hand ändern (GoBD):
--    nur der Abgleich schreibt.
-- 5. app.lexware_ereignisse: angenommene Rückmeldungen (Webhooks), je Meldung genau einmal (eindeutig).
-- 6. app.lexware_abos: welche Event-Subscriptions das CRM in Lexware angelegt hat.

create table app.lexware_konfig (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	id uuid not null default gen_random_uuid() unique,
	schluessel bytea check (octet_length(schluessel) <= 4000),
	schluessel_hinweis text check (char_length(schluessel_hinweis) <= 10),
	gueltig_bis date,
	status text not null default 'nicht_verbunden' check (status in ('nicht_verbunden', 'verbunden', 'schluessel_ungueltig', 'fehler')),
	organisation_id uuid unique,
	firmenname text check (char_length(firmenname) <= 300),
	steuerart text check (char_length(steuerart) <= 40),
	kleinunternehmer boolean,
	geprueft_am timestamptz,
	letzter_fehler text check (char_length(letzter_fehler) <= 1000),
	kunden_anlegen boolean not null default false,
	letzter_abgleich timestamptz,
	abgleich_tag date,
	eingerichtet_von uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now()
);
revoke all on app.lexware_konfig from public, crm_app, crm_admin, crm_auth;
grant select (betrieb_id, id, schluessel_hinweis, gueltig_bis, status, organisation_id, firmenname, steuerart, kleinunternehmer,
	geprueft_am, letzter_fehler, kunden_anlegen, letzter_abgleich, abgleich_tag, eingerichtet_von, angelegt, geaendert) on app.lexware_konfig to crm_app;
grant insert (betrieb_id, schluessel, schluessel_hinweis, gueltig_bis, status, eingerichtet_von, kunden_anlegen) on app.lexware_konfig to crm_app;
grant update (schluessel, schluessel_hinweis, gueltig_bis, status, organisation_id, firmenname, steuerart, kleinunternehmer,
	geprueft_am, letzter_fehler, kunden_anlegen, letzter_abgleich, abgleich_tag, eingerichtet_von) on app.lexware_konfig to crm_app;
grant delete on app.lexware_konfig to crm_app;
alter table app.lexware_konfig enable row level security;
alter table app.lexware_konfig force row level security;
create policy lexware_konfig_mandant on app.lexware_konfig for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create trigger lexware_konfig_geaendert before update on app.lexware_konfig
	for each row execute function app.setze_geaendert();
create trigger lexware_konfig_protokoll after insert or update or delete on app.lexware_konfig
	for each row execute function app.protokolliere('geaendert', 'schluessel', 'letzter_abgleich', 'abgleich_tag', 'geprueft_am');

create table app.lexware_auftraege (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	art text not null check (art in ('kontakt_anlegen', 'kontakt_aktualisieren', 'kontakte_abgleichen', 'belege_abgleichen', 'abos_einrichten')),
	nutzlast jsonb not null default '{}' check (jsonb_typeof(nutzlast) = 'object' and octet_length(nutzlast::text) <= 200000),
	idempotenz text not null check (char_length(idempotenz) between 3 and 200),
	status text not null default 'wartet' check (status in ('wartet', 'laeuft', 'ungewiss', 'erledigt', 'pruefen', 'abgebrochen')),
	versuche integer not null default 0 check (versuche between 0 and 1000),
	naechster_versuch timestamptz not null default now(),
	gesperrt_bis timestamptz,
	letzter_fehler text check (char_length(letzter_fehler) <= 1000),
	ergebnis jsonb,
	lexware_id uuid,
	von_benutzer uuid,
	angelegt timestamptz not null default now(),
	erledigt_am timestamptz,
	unique (betrieb_id, idempotenz),
	unique (id, betrieb_id)
);
create index lexware_auftraege_faellig_idx on app.lexware_auftraege (naechster_versuch) where status in ('wartet', 'ungewiss', 'laeuft');
create index lexware_auftraege_betrieb_idx on app.lexware_auftraege (betrieb_id, angelegt desc);
revoke all on app.lexware_auftraege from public, crm_app, crm_admin, crm_auth;
grant select on app.lexware_auftraege to crm_app;
grant insert (betrieb_id, art, nutzlast, idempotenz, von_benutzer, naechster_versuch) on app.lexware_auftraege to crm_app;
grant update (status, versuche, naechster_versuch, gesperrt_bis, letzter_fehler, ergebnis, lexware_id, erledigt_am) on app.lexware_auftraege to crm_app;
alter table app.lexware_auftraege enable row level security;
alter table app.lexware_auftraege force row level security;
create policy lexware_auftraege_mandant on app.lexware_auftraege for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create table app.lexware_protokoll (
	id bigint generated always as identity primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	methode text not null check (methode in ('GET', 'POST', 'PUT', 'DELETE')),
	pfad text not null check (char_length(pfad) <= 500),
	status integer,
	dauer_ms integer not null check (dauer_ms >= 0),
	fehler text check (char_length(fehler) <= 500),
	auftrag_id uuid,
	zeit timestamptz not null default now()
);
create index lexware_protokoll_betrieb_idx on app.lexware_protokoll (betrieb_id, zeit desc);
revoke all on app.lexware_protokoll from public, crm_app, crm_admin, crm_auth;
grant select, insert (betrieb_id, methode, pfad, status, dauer_ms, fehler, auftrag_id), delete on app.lexware_protokoll to crm_app;
alter table app.lexware_protokoll enable row level security;
alter table app.lexware_protokoll force row level security;
create policy lexware_protokoll_mandant on app.lexware_protokoll for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create table app.lexware_belege (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	lexware_id uuid not null,
	-- voucherType aus der Belegliste: quotation, orderconfirmation, invoice, downpaymentinvoice, creditnote, …
	typ text not null check (char_length(typ) between 1 and 40),
	nummer text check (char_length(nummer) <= 100),
	-- voucherStatus: draft, open, overdue, paid, paidoff, voided, accepted, rejected, …
	status text not null check (char_length(status) between 1 and 40),
	datum date,
	faellig date,
	brutto_cent bigint,
	offen_cent bigint,
	waehrung text check (char_length(waehrung) <= 3),
	kontakt_id uuid,
	kontakt_name text check (char_length(kontakt_name) <= 300),
	kunde_id uuid,
	archiviert boolean not null default false,
	geaendert_lexware timestamptz,
	veraltet boolean not null default false,
	stand timestamptz not null default now(),
	unique (betrieb_id, lexware_id),
	unique (id, betrieb_id)
);
create index lexware_belege_kunde_idx on app.lexware_belege (betrieb_id, kunde_id);
revoke all on app.lexware_belege from public, crm_app, crm_admin, crm_auth;
grant select, insert (betrieb_id, lexware_id, typ, nummer, status, datum, faellig, brutto_cent, offen_cent, waehrung, kontakt_id,
	kontakt_name, kunde_id, archiviert, geaendert_lexware, veraltet, stand) on app.lexware_belege to crm_app;
grant update (typ, nummer, status, datum, faellig, brutto_cent, offen_cent, waehrung, kontakt_id, kontakt_name, kunde_id, archiviert,
	geaendert_lexware, veraltet, stand) on app.lexware_belege to crm_app;
alter table app.lexware_belege enable row level security;
alter table app.lexware_belege force row level security;
create policy lexware_belege_mandant on app.lexware_belege for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create table app.lexware_ereignisse (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	organisation_id uuid not null,
	event_type text not null check (event_type ~ '^[a-z-]+(\.[a-z-]+){1,2}$' and char_length(event_type) <= 60),
	resource_id uuid not null,
	event_date timestamptz not null,
	angenommen timestamptz not null default now(),
	verarbeitet_am timestamptz,
	ergebnis text check (char_length(ergebnis) <= 500),
	unique (betrieb_id, event_type, resource_id, event_date)
);
create index lexware_ereignisse_offen_idx on app.lexware_ereignisse (betrieb_id, angenommen) where verarbeitet_am is null;
revoke all on app.lexware_ereignisse from public, crm_app, crm_admin, crm_auth;
grant select, update (verarbeitet_am, ergebnis), delete on app.lexware_ereignisse to crm_app;
alter table app.lexware_ereignisse enable row level security;
alter table app.lexware_ereignisse force row level security;
create policy lexware_ereignisse_mandant on app.lexware_ereignisse for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create table app.lexware_abos (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	event_type text not null check (char_length(event_type) <= 60),
	lexware_id uuid,
	callback_url text not null check (char_length(callback_url) <= 500),
	angelegt timestamptz not null default now(),
	primary key (betrieb_id, event_type)
);
revoke all on app.lexware_abos from public, crm_app, crm_admin, crm_auth;
grant select, insert, update (lexware_id, callback_url, angelegt), delete on app.lexware_abos to crm_app;
alter table app.lexware_abos enable row level security;
alter table app.lexware_abos force row level security;
create policy lexware_abos_mandant on app.lexware_abos for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Schlüssel-Chiffrat (nur der Server, als crm_auth; entschlüsselt wird in der Anwendung).
create function app.lexware_schluessel(p_betrieb uuid)
returns bytea language sql stable security definer set search_path = app, pg_temp as $$
	select l.schluessel from app.lexware_konfig l join app.betriebe b on b.id = l.betrieb_id
	where l.betrieb_id = p_betrieb and b.abo_status <> 'gesperrt';
$$;

-- Hintergrund-Dienst: Betriebe mit Schlüssel (Modul lexware im Tarif) und ein aktiver Benutzer mit „Einstellungen“,
-- in dessen Namen der Dienst arbeitet (bevorzugt, wer die Verbindung eingerichtet hat).
create function app.lexware_dienst_kontexte()
returns table (betrieb_id uuid, benutzer_id uuid)
language sql stable security definer set search_path = app, pg_temp as $$
	select l.betrieb_id, (
		select b.id from app.benutzer b join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		where b.betrieb_id = l.betrieb_id and b.aktiv and 'einstellungen' = any (r.rechte)
		order by (b.id = l.eingerichtet_von) desc, b.id limit 1)
	from app.lexware_konfig l
	join app.betriebe bt on bt.id = l.betrieb_id
	join app.tarife t on t.id = bt.tarif_id
	where l.schluessel is not null and l.status in ('verbunden', 'fehler') and bt.abo_status <> 'gesperrt' and 'lexware' = any (t.module);
$$;

-- Rückmeldung (Webhook) annehmen – der Aufrufer hat die Signatur geprüft. Betrieb über die Organisation aus Lexware.
-- Ergebnis: 'neu', 'doppelt' (gleiche Meldung schon da → keine zweite Wirkung) oder 'unbekannt'.
create function app.lexware_ereignis_annehmen(p_org uuid, p_typ text, p_resource uuid, p_datum timestamptz)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare v_betrieb uuid; v_id uuid;
begin
	select l.betrieb_id into v_betrieb from app.lexware_konfig l where l.organisation_id = p_org and l.schluessel is not null;
	if v_betrieb is null then return 'unbekannt'; end if;
	insert into app.lexware_ereignisse (betrieb_id, organisation_id, event_type, resource_id, event_date)
	values (v_betrieb, p_org, p_typ, p_resource, p_datum)
	on conflict (betrieb_id, event_type, resource_id, event_date) do nothing
	returning id into v_id;
	return case when v_id is null then 'doppelt' else 'neu' end;
end $$;

revoke all on function app.lexware_schluessel(uuid), app.lexware_dienst_kontexte(), app.lexware_ereignis_annehmen(uuid, text, uuid, timestamptz)
	from public, crm_app, crm_admin;
grant execute on function app.lexware_schluessel(uuid), app.lexware_dienst_kontexte(), app.lexware_ereignis_annehmen(uuid, text, uuid, timestamptz) to crm_auth;
