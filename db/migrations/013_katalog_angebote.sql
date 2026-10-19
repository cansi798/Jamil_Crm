-- Leistungskatalog, Briefkopf (Betriebsprofil), Angebote und Angebotspositionen – Stufe 1c, Task 2.
--
-- Geldbeträge sind ganze Cent (bigint), Mengen numeric(12,3). Mandantentrennung wie 007/011/012: betrieb_id not null,
-- RLS aktiv und erzwungen (USING und WITH CHECK gegen app.betrieb_id), Querverweise über zusammengesetzte
-- Fremdschlüssel (x_id, betrieb_id), Änderungsprotokoll per app.protokolliere.
--
-- Startvorlagen (app.katalog_vorlagen) sind ein gemeinsamer Katalog ohne Betrieb und ohne Preise – wie app.tarife nur
-- lesbar. Ein Betrieb übernimmt Vorlagen in seinen eigenen Katalog (app.katalog_positionen) und setzt dort Preise.
--
-- Angebote: Nur ein Entwurf ist änderbar. Kopf und Positionen eines versendeten, angenommenen oder abgelehnten
-- Angebots sind eingefroren (Fehler 55000 „Angebot ist nicht mehr änderbar“); nur der Status wechselt noch.
-- Preise werden beim Übernehmen aus dem Katalog in die Position kopiert – eine spätere Katalogänderung ändert kein
-- Angebot. Ein Auftrag mit Angeboten lässt sich nicht löschen (Fremdschlüssel ohne Kaskade, nie automatisch löschen).

-- Erlaubte Einheiten (gleiche Liste für Vorlagen, Katalog und Angebotspositionen; src/lib/server/katalog.ts EINHEITEN)
create domain app.einheit as text
	check (value in ('Stk', 'm²', 'm', 'lfm', 'm³', 'h', 'psch', 'kg', 'l'));

create table app.katalog_vorlagen (
	id uuid primary key default gen_random_uuid(),
	gewerk text not null check (gewerk in ('bad_sanitaer', 'fliesen', 'maler', 'trockenbau')),
	bezeichnung text not null check (char_length(btrim(bezeichnung)) between 1 and 200),
	beschreibung text check (char_length(beschreibung) <= 2000),
	einheit app.einheit not null,
	sortierung smallint not null default 0,
	unique (gewerk, bezeichnung)
);

create table app.katalog_positionen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	gewerk text check (gewerk in ('bad_sanitaer', 'fliesen', 'maler', 'trockenbau')),
	nummer text,
	bezeichnung text not null,
	beschreibung text,
	einheit app.einheit not null,
	lohn_cent bigint not null default 0 check (lohn_cent between 0 and 1000000000),
	material_cent bigint not null default 0 check (material_cent between 0 and 1000000000),
	aktiv boolean not null default true,
	vorlage_id uuid references app.katalog_vorlagen (id) on delete set null,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	-- jede Vorlage höchstens einmal je Betrieb (zweites Übernehmen legt nichts doppelt an)
	unique (betrieb_id, vorlage_id),
	constraint katalog_laengen check (
		char_length(btrim(bezeichnung)) between 1 and 200 and char_length(bezeichnung) <= 200
		and char_length(nummer) <= 20 and char_length(beschreibung) <= 2000
	)
);
create index katalog_betrieb_idx on app.katalog_positionen (betrieb_id, gewerk);

-- Briefkopf und Logo eines Betriebs (eine Zeile je Betrieb). id nur für das Änderungsprotokoll (braucht eine
-- Datensatz-ID); das Logo selbst kommt nie ins Protokoll, nur logo_typ und logo_geaendert.
create table app.betrieb_profil (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	id uuid not null unique default gen_random_uuid(),
	firmenname text,
	strasse text,
	plz text,
	ort text,
	telefon text,
	email text,
	web text,
	steuernummer text,
	ust_id text,
	iban text,
	bic text,
	bank text,
	fusszeile text,
	logo bytea,
	logo_typ text check (logo_typ in ('image/png', 'image/jpeg')),
	logo_geaendert timestamptz,
	geaendert timestamptz not null default now(),
	constraint profil_logo check ((logo is null) = (logo_typ is null) and octet_length(logo) <= 1048576),
	constraint profil_laengen check (
		char_length(firmenname) <= 200 and char_length(strasse) <= 200 and char_length(plz) <= 20
		and char_length(ort) <= 200 and char_length(telefon) <= 50 and char_length(email) <= 200
		and char_length(web) <= 200 and char_length(steuernummer) <= 50 and char_length(ust_id) <= 20
		and char_length(iban) <= 34 and char_length(bic) <= 11 and char_length(bank) <= 200
		and char_length(fusszeile) <= 500
	)
);

create table app.angebote (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	-- Fortlaufend je Betrieb und Jahr (AN-2026-0001), vergeben vom Trigger angebot_nummer (nie von der Anwendung).
	nummer text not null,
	auftrag_id uuid not null,
	status text not null default 'entwurf' check (status in ('entwurf', 'versendet', 'angenommen', 'abgelehnt')),
	datum date not null default (now() at time zone 'Europe/Berlin')::date,
	gueltig_bis date not null,
	mwst_satz smallint not null default 19 check (mwst_satz in (0, 7, 19)),
	einleitung text,
	schluss text,
	vorgaenger_id uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	unique (betrieb_id, nummer),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id),
	foreign key (vorgaenger_id, betrieb_id) references app.angebote (id, betrieb_id) on delete set null (vorgaenger_id),
	check (gueltig_bis >= datum),
	constraint angebote_laengen check (
		char_length(einleitung) <= 2000 and char_length(schluss) <= 2000 and char_length(nummer) <= 40
	)
);
create index angebote_auftrag_idx on app.angebote (auftrag_id, betrieb_id);
create index angebote_betrieb_idx on app.angebote (betrieb_id, angelegt desc);

create table app.angebot_positionen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	angebot_id uuid not null,
	pos smallint not null check (pos between 1 and 200),
	katalog_position_id uuid,
	bezeichnung text not null,
	beschreibung text,
	menge numeric(12, 3) not null check (menge > 0 and menge <= 1000000),
	einheit app.einheit not null,
	einzelpreis_cent bigint not null check (einzelpreis_cent between 0 and 1000000000),
	unique (id, betrieb_id),
	-- beim Neuordnen innerhalb einer Transaktion vorübergehend doppelt erlaubt
	constraint angebot_positionen_pos unique (angebot_id, pos) deferrable initially deferred,
	foreign key (angebot_id, betrieb_id) references app.angebote (id, betrieb_id) on delete cascade,
	foreign key (katalog_position_id, betrieb_id) references app.katalog_positionen (id, betrieb_id)
		on delete set null (katalog_position_id),
	constraint angebot_positionen_laengen check (
		char_length(btrim(bezeichnung)) between 1 and 200 and char_length(bezeichnung) <= 200
		and char_length(beschreibung) <= 2000
	)
);
create index angebot_positionen_katalog_idx on app.angebot_positionen (katalog_position_id, betrieb_id);

-- Nummernkreis der Angebote je Betrieb und Kalenderjahr (Berlin) – Verfahren wie bei den Aufträgen (011).
create table app.angebot_nummern (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	jahr int not null check (jahr between 2000 and 9999),
	letzte int not null check (letzte >= 1),
	primary key (betrieb_id, jahr)
);

create function app.naechste_angebotsnummer(p_betrieb uuid)
returns text
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_jahr int := extract(year from (now() at time zone 'Europe/Berlin'))::int;
	v_nr int;
begin
	if p_betrieb is null then
		raise exception 'naechste_angebotsnummer: Betrieb fehlt' using errcode = '22004';
	end if;
	insert into app.angebot_nummern as n (betrieb_id, jahr, letzte)
	values (p_betrieb, v_jahr, 1)
	on conflict (betrieb_id, jahr) do update set letzte = n.letzte + 1
	returning letzte into v_nr;
	return 'AN-' || v_jahr || '-' || lpad(v_nr::text, greatest(4, length(v_nr::text)), '0');
end;
$$;
revoke execute on function app.naechste_angebotsnummer(uuid) from public, crm_app, crm_admin, crm_auth;

create function app.angebot_nummer_setzen()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_kontext text := nullif(current_setting('app.betrieb_id', true), '');
begin
	if v_kontext is not null and v_kontext is distinct from new.betrieb_id::text then
		raise exception 'angebot_nummer_setzen: Betriebskontext passt nicht' using errcode = '42501';
	end if;
	if new.nummer is null then
		new.nummer := app.naechste_angebotsnummer(new.betrieb_id);
	end if;
	return new;
end;
$$;
revoke execute on function app.angebot_nummer_setzen() from public, crm_app, crm_admin, crm_auth;

create trigger angebot_nummer before insert on app.angebote
	for each row execute function app.angebot_nummer_setzen();

-- Nur Entwürfe sind änderbar. Kopf: Außer im Entwurf ändert sich nur noch der Status. Löschen nur im Entwurf – außer
-- der Betrieb selbst wird gerade gelöscht (Löschkaskade der Plattform; seine Zeile ist dann schon weg).
create function app.angebot_nur_entwurf()
returns trigger
language plpgsql
as $$
begin
	if tg_op = 'DELETE' then
		if old.status <> 'entwurf' and exists (select 1 from app.betriebe where id = old.betrieb_id) then
			raise exception 'Angebot ist nicht mehr änderbar' using errcode = '55000';
		end if;
		return old;
	end if;
	if old.status <> 'entwurf' and (
		new.auftrag_id is distinct from old.auftrag_id or new.datum is distinct from old.datum
		or new.gueltig_bis is distinct from old.gueltig_bis or new.mwst_satz is distinct from old.mwst_satz
		or new.einleitung is distinct from old.einleitung or new.schluss is distinct from old.schluss
		or new.vorgaenger_id is distinct from old.vorgaenger_id
	) then
		raise exception 'Angebot ist nicht mehr änderbar' using errcode = '55000';
	end if;
	return new;
end;
$$;

create trigger angebote_nur_entwurf before update or delete on app.angebote
	for each row execute function app.angebot_nur_entwurf();

-- Positionen: anlegen, ändern, löschen nur, solange das Angebot ein Entwurf ist. Fehlt das Angebot (es wird gerade
-- selbst gelöscht – Kaskade) oder der Betrieb (Löschkaskade der Plattform), ist nichts zu schützen. Die Abfragen laufen
-- mit den Rechten des Aufrufers (RLS: crm_app sieht nur den eigenen Betrieb).
create function app.angebot_position_nur_entwurf()
returns trigger
language plpgsql
as $$
declare
	v_angebot uuid := case when tg_op = 'DELETE' then old.angebot_id else new.angebot_id end;
	v_betrieb uuid := case when tg_op = 'DELETE' then old.betrieb_id else new.betrieb_id end;
	v_status text;
begin
	if tg_op = 'DELETE' and not exists (select 1 from app.betriebe where id = v_betrieb) then
		return old;
	end if;
	select status into v_status from app.angebote where id = v_angebot and betrieb_id = v_betrieb;
	if v_status is not null and v_status <> 'entwurf' then
		raise exception 'Angebot ist nicht mehr änderbar' using errcode = '55000';
	end if;
	if tg_op = 'UPDATE' and new.angebot_id is distinct from old.angebot_id then
		raise exception 'Position kann nicht in ein anderes Angebot verschoben werden' using errcode = '55000';
	end if;
	return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger angebot_positionen_nur_entwurf before insert or update or delete on app.angebot_positionen
	for each row execute function app.angebot_position_nur_entwurf();

create trigger katalog_positionen_geaendert before update on app.katalog_positionen
	for each row execute function app.setze_geaendert();
create trigger betrieb_profil_geaendert before update on app.betrieb_profil
	for each row execute function app.setze_geaendert();
create trigger angebote_geaendert before update on app.angebote
	for each row execute function app.setze_geaendert();

-- Rechte. id, betrieb_id, nummer, angelegt, geaendert setzt nie die Anwendung; ein neues Angebot beginnt immer als
-- Entwurf (kein INSERT auf status). Der Betrieb einer Profilzeile und das Angebot einer Position ändern sich nie.
revoke all on app.katalog_vorlagen, app.katalog_positionen, app.betrieb_profil, app.angebote, app.angebot_positionen,
	app.angebot_nummern from public, crm_app, crm_admin, crm_auth;
grant select on app.katalog_vorlagen to crm_app;
grant select, delete on app.katalog_positionen, app.angebote, app.angebot_positionen to crm_app;
grant insert (betrieb_id, gewerk, nummer, bezeichnung, beschreibung, einheit, lohn_cent, material_cent, aktiv, vorlage_id)
	on app.katalog_positionen to crm_app;
grant update (gewerk, nummer, bezeichnung, beschreibung, einheit, lohn_cent, material_cent, aktiv)
	on app.katalog_positionen to crm_app;
grant select on app.betrieb_profil to crm_app;
grant insert (betrieb_id, firmenname, strasse, plz, ort, telefon, email, web, steuernummer, ust_id, iban, bic, bank,
	fusszeile, logo, logo_typ, logo_geaendert) on app.betrieb_profil to crm_app;
grant update (firmenname, strasse, plz, ort, telefon, email, web, steuernummer, ust_id, iban, bic, bank, fusszeile,
	logo, logo_typ, logo_geaendert) on app.betrieb_profil to crm_app;
grant insert (betrieb_id, auftrag_id, datum, gueltig_bis, mwst_satz, einleitung, schluss, vorgaenger_id)
	on app.angebote to crm_app;
grant update (status, datum, gueltig_bis, mwst_satz, einleitung, schluss) on app.angebote to crm_app;
grant insert (betrieb_id, angebot_id, pos, katalog_position_id, bezeichnung, beschreibung, menge, einheit,
	einzelpreis_cent) on app.angebot_positionen to crm_app;
grant update (pos, katalog_position_id, bezeichnung, beschreibung, menge, einheit, einzelpreis_cent)
	on app.angebot_positionen to crm_app;

-- Row Level Security (strikt). angebot_nummern: RLS ohne Richtlinie (für crm_app keine Zeile, kein Recht).
alter table app.katalog_positionen enable row level security;
alter table app.katalog_positionen force row level security;
alter table app.betrieb_profil enable row level security;
alter table app.betrieb_profil force row level security;
alter table app.angebote enable row level security;
alter table app.angebote force row level security;
alter table app.angebot_positionen enable row level security;
alter table app.angebot_positionen force row level security;
alter table app.angebot_nummern enable row level security;
alter table app.angebot_nummern force row level security;

create policy katalog_positionen_mandant on app.katalog_positionen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy betrieb_profil_mandant on app.betrieb_profil
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy angebote_mandant on app.angebote
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy angebot_positionen_mandant on app.angebot_positionen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll (Migration 006). Logo-Bytes nie ins Protokoll (nur logo_typ/logo_geaendert zeigen den Wechsel).
create trigger katalog_positionen_protokoll
	after insert or update or delete on app.katalog_positionen
	for each row execute function app.protokolliere('geaendert');
create trigger betrieb_profil_protokoll
	after insert or update or delete on app.betrieb_profil
	for each row execute function app.protokolliere('geaendert', 'logo');
create trigger angebote_protokoll
	after insert or update or delete on app.angebote
	for each row execute function app.protokolliere('geaendert');
create trigger angebot_positionen_protokoll
	after insert or update or delete on app.angebot_positionen
	for each row execute function app.protokolliere();
