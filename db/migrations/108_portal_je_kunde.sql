-- Portal-Einstellungen gehören zum KUNDEN, nicht zum Auftrag (Jamil, Talk msgs 3423, 3439: „Option A“).
--
-- Schema: Firma (Standard) → Kunde (leer = erbt) → Auftrag nur für wirklich auftragsspezifisches (einzelne Dokumente im Portal,
-- Angebot pausieren – bleibt unverändert).
--
-- * app.kunden_portal: je Kunde die Werte, die bisher je Auftrag standen. NULL = erbt von der Firma.
--     sichtbar          Aufträge dieses Kunden im Portal zeigen (leer = Regel der Firma „alle aktiven“/„nur ausdrücklich“)
--     frei_status       Auftragsstatus zeigen            frei_termine      nächste Termine zeigen
--     frei_mitarbeiter  Namen der Mitarbeiter zeigen     frei_annahme      Angebot online annehmen
--     ab_automatisch    Auftragsbestätigung automatisch erstellen
-- * app.portal_einstellungen.frei_*: Firmen-Standard für die vier Freigaben (Standard: alles an – wie bisher).
-- * Bestehende Werte werden OHNE Datenverlust übernommen: Die Spalten am Auftrag (portal_auftrag.*, auftraege.ab_automatisch)
--   bleiben unverändert stehen, werden aber nicht mehr ausgewertet. Je Kunde gilt die vorsichtigste Auswahl seiner Aufträge:
--     - Freigaben (Status, Termine, Mitarbeiter, Annahme): war bei IRGENDEINEM Auftrag des Kunden etwas ausgeschaltet,
--       ist es beim Kunden aus; sonst erbt er (Standard an).
--     - sichtbar: Regel „nur markierte“ und mindestens ein Auftrag war ausdrücklich im Portal → Kunde ja;
--       Regel „alle aktiven“ und mindestens ein Auftrag war ausdrücklich ausgeblendet, keiner ausdrücklich gezeigt → Kunde nein.
--     - Auftragsbestätigung: Firma an und ein Auftrag war aus → Kunde aus; Firma aus und ein Auftrag war an → Kunde an.
--   Alles andere bleibt leer (erbt).

alter table app.portal_einstellungen
	add column if not exists frei_status boolean not null default true,
	add column if not exists frei_termine boolean not null default true,
	add column if not exists frei_mitarbeiter boolean not null default true,
	add column if not exists frei_annahme boolean not null default true;
grant insert (frei_status, frei_termine, frei_mitarbeiter, frei_annahme) on app.portal_einstellungen to crm_app;
grant update (frei_status, frei_termine, frei_mitarbeiter, frei_annahme) on app.portal_einstellungen to crm_app;

create table app.kunden_portal (
	kunde_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	sichtbar boolean,
	frei_status boolean,
	frei_termine boolean,
	frei_mitarbeiter boolean,
	frei_annahme boolean,
	ab_automatisch boolean,
	geaendert timestamptz not null default now(),
	id uuid not null unique default gen_random_uuid(),
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id) on delete cascade
);

revoke all on app.kunden_portal from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.kunden_portal to crm_app;
grant insert (kunde_id, betrieb_id, sichtbar, frei_status, frei_termine, frei_mitarbeiter, frei_annahme, ab_automatisch) on app.kunden_portal to crm_app;
grant update (sichtbar, frei_status, frei_termine, frei_mitarbeiter, frei_annahme, ab_automatisch) on app.kunden_portal to crm_app;
alter table app.kunden_portal enable row level security;
alter table app.kunden_portal force row level security;
create policy kunden_portal_mandant on app.kunden_portal for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create trigger kunden_portal_geaendert before update on app.kunden_portal for each row execute function app.setze_geaendert();
create trigger kunden_portal_protokoll after insert or update or delete on app.kunden_portal
	for each row execute function app.protokolliere('geaendert');

-- Übernahme der bisherigen Werte (siehe oben)
with je_kunde as (
	select a.kunde_id, a.betrieb_id,
		coalesce(e.standard, 'alle_aktiven') as regel,
		coalesce(e.ab_automatisch, true) as firma_ab,
		bool_or(pa.sichtbar is true) as sicht_ja,
		bool_or(pa.sichtbar is false) as sicht_nein,
		bool_or(pa.status is false) as status_aus,
		bool_or(pa.termine is false) as termine_aus,
		bool_or(pa.mitarbeiter is false) as mitarbeiter_aus,
		bool_or(pa.annahme is false) as annahme_aus,
		bool_or(a.ab_automatisch is true) as ab_an,
		bool_or(a.ab_automatisch is false) as ab_aus
	from app.auftraege a
	left join app.portal_auftrag pa on pa.auftrag_id = a.id and pa.betrieb_id = a.betrieb_id
	left join app.portal_einstellungen e on e.betrieb_id = a.betrieb_id
	where a.kunde_id is not null
	group by a.kunde_id, a.betrieb_id, e.standard, e.ab_automatisch
), werte as (
	select kunde_id, betrieb_id,
		case when regel = 'nur_markierte' and sicht_ja then true
			when regel = 'alle_aktiven' and sicht_nein and not sicht_ja then false end as sichtbar,
		case when status_aus then false end as frei_status,
		case when termine_aus then false end as frei_termine,
		case when mitarbeiter_aus then false end as frei_mitarbeiter,
		case when annahme_aus then false end as frei_annahme,
		case when firma_ab and ab_aus then false when not firma_ab and ab_an then true end as ab_automatisch
	from je_kunde
)
insert into app.kunden_portal (kunde_id, betrieb_id, sichtbar, frei_status, frei_termine, frei_mitarbeiter, frei_annahme, ab_automatisch)
select kunde_id, betrieb_id, sichtbar, frei_status, frei_termine, frei_mitarbeiter, frei_annahme, ab_automatisch from werte
where coalesce(sichtbar, frei_status, frei_termine, frei_mitarbeiter, frei_annahme, ab_automatisch) is not null
on conflict (kunde_id) do nothing;
