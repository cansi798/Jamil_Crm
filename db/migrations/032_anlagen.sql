-- Anlagen an Objekten mit QR-Code (Wünsche Jamil, msgs 2503 + 2505).
--
-- Anlage: Typ (Solar, Wärmepumpe, Gasspeicher, Heizung, Klima, Lüftung, Wallbox, Sonstige) mit typabhängigen
-- Zusatzfeldern (jsonb `extra`, Felddefinition in src/lib/anlagen-typen.ts), Hersteller, Modell, Seriennummer, Baujahr,
-- Einbaudatum, Standort im Objekt, Garantie bis (Erinnerung als To-do), Wartungsintervall (→ wiederkehrendes To-do).
-- Verlauf: Aufträge (auftraege.anlage_id), To-dos (todos.anlage_id) und Störungen; Fotos/Dokumente.
--
-- QR: `qr_token` ist ein zufälliges, nicht erratbares Kürzel (nie die laufende ID) für /a/<token>. Ohne Anmeldung
-- liefert nur die SECURITY-DEFINER-Funktion app.anlage_per_qr den Typ und den Kontakt des Betriebs – keine
-- Kundendaten.

create table app.anlagen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	objekt_id uuid not null,
	typ text not null check (typ in ('solar', 'waermepumpe', 'gasspeicher', 'heizung', 'klima', 'lueftung', 'wallbox', 'sonstige')),
	bezeichnung text not null check (char_length(btrim(bezeichnung)) between 1 and 200),
	hersteller text check (char_length(hersteller) <= 200),
	modell text check (char_length(modell) <= 200),
	seriennummer text check (char_length(seriennummer) <= 100),
	baujahr smallint check (baujahr between 1900 and 2100),
	einbaudatum date,
	standort text check (char_length(standort) <= 200),
	garantie_bis date,
	wartung_regel text check (wartung_regel in ('taeglich', 'woechentlich', 'monatlich', 'jaehrlich')),
	wartung_intervall smallint check (wartung_intervall between 1 and 365),
	extra jsonb not null default '{}' check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 8000),
	notiz text check (char_length(notiz) <= 2000),
	qr_token text not null unique check (qr_token ~ '^[A-Za-z0-9_-]{22,64}$'),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (objekt_id, betrieb_id) references app.objekte (id, betrieb_id) on delete cascade,
	constraint anlagen_wartung_paar check ((wartung_regel is null) = (wartung_intervall is null))
);
create index anlagen_objekt_idx on app.anlagen (objekt_id, betrieb_id);

create table app.anlagen_stoerungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	anlage_id uuid not null,
	titel text not null check (char_length(btrim(titel)) between 1 and 200),
	beschreibung text check (char_length(beschreibung) <= 2000),
	-- intern erfasst; später auch über den QR-Code gemeldet
	quelle text not null default 'intern' check (quelle in ('intern', 'qr')),
	von_benutzer_id uuid,
	behoben_am timestamptz,
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (anlage_id, betrieb_id) references app.anlagen (id, betrieb_id) on delete cascade,
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id)
);
create index anlagen_stoerungen_anlage_idx on app.anlagen_stoerungen (anlage_id, betrieb_id, angelegt desc);

create table app.anlagen_dateien (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	anlage_id uuid not null,
	name text not null check (char_length(btrim(name)) between 1 and 255),
	typ text not null check (char_length(typ) between 1 and 100),
	groesse integer not null check (groesse > 0 and groesse <= 5242880),
	inhalt bytea not null check (octet_length(inhalt) <= 5242880),
	beschreibung text check (char_length(beschreibung) <= 500),
	von_benutzer_id uuid,
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (anlage_id, betrieb_id) references app.anlagen (id, betrieb_id) on delete cascade,
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id)
);
create index anlagen_dateien_anlage_idx on app.anlagen_dateien (anlage_id, betrieb_id, angelegt desc);

-- Bezüge: Auftrag zu einer Anlage, To-do zu einer Anlage (Wartung, Garantie-Erinnerung)
alter table app.auftraege add column anlage_id uuid;
alter table app.auftraege add constraint auftraege_anlage_fk foreign key (anlage_id, betrieb_id)
	references app.anlagen (id, betrieb_id) on delete set null (anlage_id);
create index auftraege_anlage_idx on app.auftraege (anlage_id, betrieb_id);
grant insert (anlage_id) on app.auftraege to crm_app;
grant update (anlage_id) on app.auftraege to crm_app;

alter table app.todos add column anlage_id uuid;
alter table app.todos add constraint todos_anlage_fk foreign key (anlage_id, betrieb_id)
	references app.anlagen (id, betrieb_id) on delete set null (anlage_id);
create index todos_anlage_idx on app.todos (anlage_id, betrieb_id);
grant insert (anlage_id) on app.todos to crm_app;

create trigger anlagen_geaendert before update on app.anlagen
	for each row execute function app.setze_geaendert();

revoke all on app.anlagen, app.anlagen_stoerungen, app.anlagen_dateien from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.anlagen, app.anlagen_stoerungen, app.anlagen_dateien to crm_app;
grant insert (betrieb_id, objekt_id, typ, bezeichnung, hersteller, modell, seriennummer, baujahr, einbaudatum, standort,
	garantie_bis, wartung_regel, wartung_intervall, extra, notiz, qr_token) on app.anlagen to crm_app;
grant update (typ, bezeichnung, hersteller, modell, seriennummer, baujahr, einbaudatum, standort, garantie_bis,
	wartung_regel, wartung_intervall, extra, notiz) on app.anlagen to crm_app;
grant insert (betrieb_id, anlage_id, titel, beschreibung, quelle, von_benutzer_id) on app.anlagen_stoerungen to crm_app;
grant update (behoben_am) on app.anlagen_stoerungen to crm_app;
grant insert (betrieb_id, anlage_id, name, typ, groesse, inhalt, beschreibung, von_benutzer_id) on app.anlagen_dateien to crm_app;

alter table app.anlagen enable row level security;
alter table app.anlagen force row level security;
alter table app.anlagen_stoerungen enable row level security;
alter table app.anlagen_stoerungen force row level security;
alter table app.anlagen_dateien enable row level security;
alter table app.anlagen_dateien force row level security;

create policy anlagen_mandant on app.anlagen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy anlagen_stoerungen_mandant on app.anlagen_stoerungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy anlagen_dateien_mandant on app.anlagen_dateien for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger anlagen_protokoll after insert or update or delete on app.anlagen
	for each row execute function app.protokolliere('geaendert');
create trigger anlagen_stoerungen_protokoll after insert or update or delete on app.anlagen_stoerungen
	for each row execute function app.protokolliere();
create trigger anlagen_dateien_protokoll after insert or update or delete on app.anlagen_dateien
	for each row execute function app.protokolliere('inhalt');

-- QR ohne Anmeldung: nur Typ der Anlage und Kontakt des Betriebs (Briefkopf) – keine Kunden- oder Objektdaten.
-- Läuft als Eigentümer (umgeht RLS) und ist nur für crm_auth (systemAbfrage) aufrufbar.
create function app.anlage_per_qr(p_token text)
returns table (anlage_id uuid, betrieb_id uuid, typ text, firmenname text, telefon text, email text, web text)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select a.id, a.betrieb_id, a.typ, p.firmenname, p.telefon, p.email, p.web
	from app.anlagen a
	left join app.betrieb_profil p on p.betrieb_id = a.betrieb_id
	join app.betriebe b on b.id = a.betrieb_id
	where p_token ~ '^[A-Za-z0-9_-]{22,64}$' and a.qr_token = p_token
$$;
revoke execute on function app.anlage_per_qr(text) from public, crm_app, crm_admin;
grant execute on function app.anlage_per_qr(text) to crm_auth;
