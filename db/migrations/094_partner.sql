-- Partner-Verwaltung (Wunsch Jamil, Talk msgs 2854/2856), schlank:
-- * app.partner: Auftraggeber (Baumärkte/Plattformen), Subunternehmer, Lieferanten – Kontaktdaten, unsere Kunden-/
--   Lieferantennummer, Portal-Link mit Notiz (nie Passwörter), Konditionen (Provision, Rabatt, Zahlungsziel), Notizen.
-- * app.partner_kontakte: mehrere Ansprechpartner je Partner.
-- * app.partner_nachweise: Meisterbrief, Versicherung, Freistellungsbescheinigung § 48b … mit Datei und „gültig bis“;
--   vor dem Ablauf eine Aufgabe mit Erinnerung für Chef/Büro (bestehende Erinnerungs-Technik).
-- * Auftrag: Auftraggeber-Partner (vorbelegt über die Auftragsquelle), Subunternehmer, Fremdleistungen (Beträge
--   fließen in die Nachkalkulation).
-- Neues Recht `partner.verwalten` (Chef, Büro und alle mit „Einstellungen“). Kein Partner-Zugang (später).

create table app.partner (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	art text not null check (art in ('auftraggeber', 'subunternehmer', 'lieferant')),
	name text not null check (char_length(btrim(name)) between 1 and 200),
	nummer text check (char_length(nummer) <= 60),
	strasse text check (char_length(strasse) <= 200),
	plz text check (char_length(plz) <= 20),
	ort text check (char_length(ort) <= 200),
	telefon text check (char_length(telefon) <= 50),
	email text check (char_length(email) <= 200),
	web text check (char_length(web) <= 300),
	portal_url text check (char_length(portal_url) <= 2000 and portal_url ~ '^https?://[^\s<>"''`\\]+$'),
	portal_notiz text check (char_length(portal_notiz) <= 500),
	notizen text check (char_length(notizen) <= 5000),
	provision_prozent numeric(5, 2) check (provision_prozent between 0 and 100),
	rabatt_prozent numeric(5, 2) check (rabatt_prozent between 0 and 100),
	zahlungsziel_tage smallint check (zahlungsziel_tage between 0 and 365),
	aktiv boolean not null default true,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id)
);
create index partner_betrieb_idx on app.partner (betrieb_id, art, name);

create table app.partner_kontakte (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null,
	partner_id uuid not null,
	name text not null check (char_length(btrim(name)) between 1 and 200),
	rolle text check (char_length(rolle) <= 100),
	telefon text check (char_length(telefon) <= 50),
	email text check (char_length(email) <= 200),
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (partner_id, betrieb_id) references app.partner (id, betrieb_id) on delete cascade
);
create index partner_kontakte_idx on app.partner_kontakte (partner_id, betrieb_id);

create table app.partner_nachweise (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null,
	partner_id uuid not null,
	art text not null check (art in ('meisterbrief', 'versicherung', 'freistellung_48b', 'sonstiges')),
	bezeichnung text check (char_length(bezeichnung) <= 200),
	gueltig_bis date,
	datei_name text check (char_length(datei_name) <= 200),
	datei_typ text check (datei_typ in ('application/pdf', 'image/jpeg', 'image/png')),
	groesse integer check (groesse between 1 and 10485760),
	inhalt bytea,
	todo_id uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	check ((inhalt is null) = (datei_name is null) and (inhalt is null) = (datei_typ is null)),
	foreign key (partner_id, betrieb_id) references app.partner (id, betrieb_id) on delete cascade,
	foreign key (todo_id, betrieb_id) references app.todos (id, betrieb_id) on delete set null (todo_id)
);
create index partner_nachweise_idx on app.partner_nachweise (partner_id, betrieb_id);
create index partner_nachweise_ablauf_idx on app.partner_nachweise (betrieb_id, gueltig_bis) where gueltig_bis is not null;

-- Auftraggeber über die Auftragsquelle (z. B. „Hornbach“ → Partner Hornbach)
alter table app.auftrag_quellen add column partner_id uuid,
	add constraint auftrag_quellen_partner_fk foreign key (partner_id, betrieb_id) references app.partner (id, betrieb_id) on delete set null (partner_id);
alter table app.auftraege add column auftraggeber_id uuid,
	add constraint auftraege_auftraggeber_fk foreign key (auftraggeber_id, betrieb_id) references app.partner (id, betrieb_id) on delete set null (auftraggeber_id);
create index auftraege_auftraggeber_idx on app.auftraege (auftraggeber_id, betrieb_id) where auftraggeber_id is not null;

create table app.auftrag_subunternehmer (
	betrieb_id uuid not null,
	auftrag_id uuid not null,
	partner_id uuid not null,
	leistung text check (char_length(leistung) <= 300),
	angelegt timestamptz not null default now(),
	primary key (auftrag_id, partner_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (partner_id, betrieb_id) references app.partner (id, betrieb_id) on delete cascade
);
create index auftrag_subunternehmer_partner_idx on app.auftrag_subunternehmer (partner_id, betrieb_id);

create table app.auftrag_fremdleistungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null,
	auftrag_id uuid not null,
	partner_id uuid,
	bezeichnung text not null check (char_length(btrim(bezeichnung)) between 1 and 200),
	betrag_cent bigint not null check (betrag_cent between 0 and 10000000000),
	rechnungsnummer text check (char_length(rechnungsnummer) <= 60),
	datum date,
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (partner_id, betrieb_id) references app.partner (id, betrieb_id) on delete set null (partner_id)
);
create index auftrag_fremdleistungen_idx on app.auftrag_fremdleistungen (auftrag_id, betrieb_id);
create index auftrag_fremdleistungen_partner_idx on app.auftrag_fremdleistungen (partner_id, betrieb_id) where partner_id is not null;

create trigger partner_geaendert before update on app.partner for each row execute function app.setze_geaendert();
create trigger partner_nachweise_geaendert before update on app.partner_nachweise for each row execute function app.setze_geaendert();

revoke all on app.partner, app.partner_kontakte, app.partner_nachweise, app.auftrag_subunternehmer, app.auftrag_fremdleistungen
	from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.partner, app.partner_kontakte, app.partner_nachweise, app.auftrag_subunternehmer, app.auftrag_fremdleistungen to crm_app;
grant insert (betrieb_id, art, name, nummer, strasse, plz, ort, telefon, email, web, portal_url, portal_notiz, notizen,
	provision_prozent, rabatt_prozent, zahlungsziel_tage, aktiv) on app.partner to crm_app;
grant update (art, name, nummer, strasse, plz, ort, telefon, email, web, portal_url, portal_notiz, notizen,
	provision_prozent, rabatt_prozent, zahlungsziel_tage, aktiv) on app.partner to crm_app;
grant insert (betrieb_id, partner_id, name, rolle, telefon, email), update (name, rolle, telefon, email) on app.partner_kontakte to crm_app;
grant insert (betrieb_id, partner_id, art, bezeichnung, gueltig_bis, datei_name, datei_typ, groesse, inhalt, todo_id),
	update (art, bezeichnung, gueltig_bis, datei_name, datei_typ, groesse, inhalt, todo_id) on app.partner_nachweise to crm_app;
grant insert (betrieb_id, auftrag_id, partner_id, leistung), update (leistung) on app.auftrag_subunternehmer to crm_app;
grant insert (betrieb_id, auftrag_id, partner_id, bezeichnung, betrag_cent, rechnungsnummer, datum) on app.auftrag_fremdleistungen to crm_app;
grant insert (partner_id), update (partner_id) on app.auftrag_quellen to crm_app;
grant insert (auftraggeber_id), update (auftraggeber_id) on app.auftraege to crm_app;

do $$
declare t text;
begin
	foreach t in array array['partner', 'partner_kontakte', 'partner_nachweise', 'auftrag_subunternehmer', 'auftrag_fremdleistungen'] loop
		execute format('alter table app.%I enable row level security', t);
		execute format('alter table app.%I force row level security', t);
		execute format($p$create policy %I on app.%I for all to crm_app
			using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
			with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)$p$, t || '_mandant', t);
	end loop;
end $$;

-- Auftraggeber automatisch aus der Auftragsquelle: beim Anlegen, wenn keiner gesetzt ist; beim Wechsel der Quelle,
-- solange der Auftraggeber noch der der alten Quelle (bzw. leer) ist – eine Handauswahl bleibt stehen.
create function app.auftraggeber_aus_quelle() returns trigger language plpgsql as $$
declare neu uuid; alt uuid;
begin
	if new.quelle_id is not null then
		select partner_id into neu from app.auftrag_quellen where id = new.quelle_id and betrieb_id = new.betrieb_id;
	end if;
	if tg_op = 'INSERT' then
		if new.auftraggeber_id is null then new.auftraggeber_id := neu; end if;
	elsif new.quelle_id is distinct from old.quelle_id and new.auftraggeber_id is not distinct from old.auftraggeber_id then
		if old.quelle_id is not null then
			select partner_id into alt from app.auftrag_quellen where id = old.quelle_id and betrieb_id = old.betrieb_id;
		end if;
		if old.auftraggeber_id is null or old.auftraggeber_id is not distinct from alt then new.auftraggeber_id := neu; end if;
	end if;
	return new;
end $$;
create trigger auftraege_auftraggeber before insert or update of quelle_id on app.auftraege
	for each row execute function app.auftraggeber_aus_quelle();

-- Verlauf (Änderungen an Partnern und am Auftrag); Dateiinhalt der Nachweise nie ins Protokoll
create trigger partner_protokoll after insert or update or delete on app.partner for each row execute function app.protokolliere('geaendert');
create trigger partner_nachweise_protokoll after insert or update or delete on app.partner_nachweise for each row execute function app.protokolliere('geaendert', 'inhalt');
create trigger auftrag_fremdleistungen_protokoll after insert or update or delete on app.auftrag_fremdleistungen for each row execute function app.protokolliere('geaendert');

update app.rollen set rechte = array_append(rechte, 'partner.verwalten')
where (vorlage in ('chef', 'buero') or 'einstellungen' = any (rechte)) and not ('partner.verwalten' = any (rechte));
