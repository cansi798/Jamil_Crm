-- Aufträge, To-dos und Nummernkreis – Stufe 1b, Task 2.
--
-- Fachtabellen wie in 007: betrieb_id not null, Row Level Security aktiv UND erzwungen, Richtlinie gegen die
-- Sitzungsvariable app.betrieb_id (leer/fehlend => nichts sichtbar, nichts schreibbar), in USING und WITH CHECK.
-- Querverweise laufen über zusammengesetzte Fremdschlüssel (x_id, betrieb_id): Fremdschlüsselprüfungen umgehen RLS,
-- nur so ist ausgeschlossen, dass ein Auftrag auf den Kunden, ein To-do auf den Benutzer eines anderen Betriebs zeigt.
--
-- Löschen: Ein Kunde mit Aufträgen lässt sich nicht löschen (Fremdschlüssel ohne Kaskade – Aufträge verschwinden nie
-- „nebenbei“). Wird ein Objekt gelöscht, verliert der Auftrag nur den Verweis (objekt_id wird NULL). To-dos eines
-- Auftrags gehören zu ihm und werden mit ihm gelöscht (ein Auftrag ist nur im Status „Anfrage“ löschbar – das prüft
-- der Dienst src/lib/server/auftraege.ts).

-- Ziel der zusammengesetzten Fremdschlüssel auf Benutzer (To-dos hier, Einsätze/Abwesenheiten in 012).
alter table app.benutzer add constraint benutzer_id_betrieb unique (id, betrieb_id);

create table app.auftraege (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	-- Fortlaufend je Betrieb und Jahr (A-2026-0001), vergeben vom Trigger auftrag_nummer (nie von der Anwendung).
	nummer text not null,
	titel text not null,
	kunde_id uuid not null,
	objekt_id uuid,
	status text not null default 'anfrage'
		check (status in ('anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet')),
	beschreibung text,
	geplant_ab date,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	unique (betrieb_id, nummer),
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id),
	-- Objekt gelöscht: nur der Verweis fällt weg (PostgreSQL ≥ 15: SET NULL nur für objekt_id, betrieb_id bleibt).
	foreign key (objekt_id, betrieb_id) references app.objekte (id, betrieb_id) on delete set null (objekt_id),
	constraint auftraege_laengen check (
		char_length(btrim(titel)) between 1 and 200 and char_length(titel) <= 200
		and char_length(beschreibung) <= 4000 and char_length(nummer) <= 40
	)
);
create index auftraege_betrieb_idx on app.auftraege (betrieb_id, angelegt desc);
create index auftraege_kunde_idx on app.auftraege (kunde_id, betrieb_id);
create index auftraege_objekt_idx on app.auftraege (objekt_id, betrieb_id);

-- Nummernkreis je Betrieb und Kalenderjahr (Berliner Zeit). Nur über app.naechste_auftragsnummer erreichbar.
create table app.auftrag_nummern (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	jahr int not null check (jahr between 2000 and 9999),
	letzte int not null check (letzte >= 1),
	primary key (betrieb_id, jahr)
);

-- Nächste Auftragsnummer eines Betriebs, z. B. „A-2026-0001“ (ab 10000 fünfstellig). Sperrsicher: insert … on conflict
-- do update sperrt die Zeile des Betriebs/Jahres bis zum Ende der Transaktion; zwei gleichzeitige Aufträge bekommen
-- so nie dieselbe Nummer. Bricht die Transaktion ab, wird auch der Zähler zurückgerollt (keine Lücke).
-- SECURITY DEFINER (crm), fester search_path; EXECUTE für niemanden – aufgerufen nur aus dem Trigger unten.
create function app.naechste_auftragsnummer(p_betrieb uuid)
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
		raise exception 'naechste_auftragsnummer: Betrieb fehlt' using errcode = '22004';
	end if;
	insert into app.auftrag_nummern as n (betrieb_id, jahr, letzte)
	values (p_betrieb, v_jahr, 1)
	on conflict (betrieb_id, jahr) do update set letzte = n.letzte + 1
	returning letzte into v_nr;
	return 'A-' || v_jahr || '-' || lpad(v_nr::text, greatest(4, length(v_nr::text)), '0');
end;
$$;
revoke execute on function app.naechste_auftragsnummer(uuid) from public, crm_app, crm_admin, crm_auth;

-- Vergibt die Nummer beim Anlegen. SECURITY DEFINER, weil crm_app den Nummernkreis nicht sieht. Schutz gegen
-- Fehlbenutzung wie im Protokoll-Trigger: Ist ein Betriebskontext gesetzt, muss er zum Auftrag passen (sonst würde der
-- Zähler eines fremden Betriebs angefasst – RLS lehnt die Zeile ohnehin ab, aber erst nach dem Trigger).
create function app.auftrag_nummer_setzen()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_kontext text := nullif(current_setting('app.betrieb_id', true), '');
begin
	if v_kontext is not null and v_kontext is distinct from new.betrieb_id::text then
		raise exception 'auftrag_nummer_setzen: Betriebskontext passt nicht' using errcode = '42501';
	end if;
	if new.nummer is null then
		new.nummer := app.naechste_auftragsnummer(new.betrieb_id);
	end if;
	return new;
end;
$$;
revoke execute on function app.auftrag_nummer_setzen() from public, crm_app, crm_admin, crm_auth;

create trigger auftrag_nummer before insert on app.auftraege
	for each row execute function app.auftrag_nummer_setzen();

-- Das Objekt eines Auftrags muss zum Kunden des Auftrags gehören (sonst 23514). Läuft mit den Rechten des Aufrufers:
-- Für crm_app gilt RLS (nur der eigene Betrieb), zusätzlich wird ausdrücklich nach betrieb_id gefiltert. Läuft vor
-- den Fremdschlüsselprüfungen – ein Objekt eines anderen Betriebs fällt deshalb schon hier auf.
create function app.auftrag_objekt_passt()
returns trigger
language plpgsql
as $$
begin
	if new.objekt_id is not null and not exists (
		select 1 from app.objekte o
		where o.id = new.objekt_id and o.betrieb_id = new.betrieb_id and o.kunde_id = new.kunde_id
	) then
		raise exception 'Das Objekt gehört nicht zum Kunden des Auftrags.' using errcode = '23514';
	end if;
	return new;
end;
$$;

create trigger auftrag_objekt_passt before insert or update of kunde_id, objekt_id on app.auftraege
	for each row execute function app.auftrag_objekt_passt();

create table app.todos (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	-- To-do zu einem Auftrag oder allgemein (NULL).
	auftrag_id uuid,
	titel text not null,
	zustaendig_id uuid,
	faellig date,
	erledigt_am timestamptz,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (zustaendig_id, betrieb_id) references app.benutzer (id, betrieb_id),
	constraint todos_laengen check (char_length(btrim(titel)) between 1 and 200 and char_length(titel) <= 200)
);
create index todos_betrieb_idx on app.todos (betrieb_id);
create index todos_auftrag_idx on app.todos (auftrag_id, betrieb_id);
create index todos_zustaendig_idx on app.todos (zustaendig_id, betrieb_id);

create trigger auftraege_geaendert before update on app.auftraege
	for each row execute function app.setze_geaendert();
create trigger todos_geaendert before update on app.todos
	for each row execute function app.setze_geaendert();

-- Rechte. id, betrieb_id, nummer, angelegt und geaendert setzt nie die Anwendung; neue Aufträge beginnen immer mit
-- „Anfrage“ (kein INSERT auf status). Der Auftrag eines To-dos ändert sich nicht.
revoke all on app.auftraege, app.todos, app.auftrag_nummern from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.auftraege, app.todos to crm_app;
grant insert (betrieb_id, titel, kunde_id, objekt_id, beschreibung, geplant_ab) on app.auftraege to crm_app;
grant update (titel, kunde_id, objekt_id, status, beschreibung, geplant_ab) on app.auftraege to crm_app;
grant insert (betrieb_id, auftrag_id, titel, zustaendig_id, faellig, erledigt_am) on app.todos to crm_app;
grant update (titel, zustaendig_id, faellig, erledigt_am) on app.todos to crm_app;

-- Row Level Security (strikt). auftrag_nummern: RLS ohne Richtlinie – für crm_app gäbe es ohnehin keine Zeile.
alter table app.auftraege enable row level security;
alter table app.auftraege force row level security;
alter table app.todos enable row level security;
alter table app.todos force row level security;
alter table app.auftrag_nummern enable row level security;
alter table app.auftrag_nummern force row level security;

create policy auftraege_mandant on app.auftraege
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create policy todos_mandant on app.todos
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll (Migration 006); nur "geaendert" bleibt draußen (Rauschen).
create trigger auftraege_protokoll
	after insert or update or delete on app.auftraege
	for each row execute function app.protokolliere('geaendert');
create trigger todos_protokoll
	after insert or update or delete on app.todos
	for each row execute function app.protokolliere('geaendert');
