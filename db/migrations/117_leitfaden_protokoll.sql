-- Leitfaden, zweite Stufe (Jamil, Talk msg 4353):
--
-- * Schritt „Protokoll ausfüllen“: Das Protokoll selbst liegt wie gewohnt in app.protokolle (Kennung je Schritt in
--   leitfaden_durchlaeufe.ergebnis.protokolle). Unterschriften kommen – wie Fotos – über den Ausgang des Handys und
--   brauchen deshalb eine eigene Art in app.leitfaden_eingaben (idempotent über opId).
-- * Hinweis ans Büro, wenn ein Termin mit Leitfaden vorbei ist und der Leitfaden nicht abgeschlossen wurde: EINMAL je
--   Termin (app.leitfaden_verpasst merkt sich die gemeldeten Termine). Der Hintergrund-Dienst ruft jede Minute
--   app.leitfaden_verpasst_melden() auf (als crm_auth, ohne Betriebskontext – deshalb SECURITY DEFINER). Gemeldet wird nur
--   für Termine, die in den letzten 2 Tagen geendet haben und nach dem Anlegen des Leitfadens liegen (kein Schwall alter
--   Hinweise beim Einschalten). Empfänger wie beim Abschluss mit Begründung: alle aktiven Benutzer mit „Alle Aufträge
--   ansehen“ (Glocke + Push nach ihren Einstellungen).

alter table app.leitfaden_eingaben drop constraint leitfaden_eingaben_art_check;
alter table app.leitfaden_eingaben add constraint leitfaden_eingaben_art_check check (art in ('eingabe', 'foto', 'unterschrift', 'abschluss'));

create table app.leitfaden_verpasst (
	einsatz_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	gemeldet_am timestamptz not null default now(),
	foreign key (einsatz_id, betrieb_id) references app.einsaetze (id, betrieb_id) on delete cascade
);
revoke all on app.leitfaden_verpasst from public, crm_app, crm_admin, crm_auth;
grant select on app.leitfaden_verpasst to crm_app;
alter table app.leitfaden_verpasst enable row level security;
alter table app.leitfaden_verpasst force row level security;
create policy leitfaden_verpasst_mandant on app.leitfaden_verpasst for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create function app.leitfaden_verpasst_melden(p_limit integer default 200) returns integer
language plpgsql security definer set search_path = app, pg_temp as $$
declare z record; u record; n integer := 0;
begin
	for z in
		select e.id, e.betrieb_id, e.auftrag_id, a.nummer, a.titel, b.name as person
		from app.einsaetze e
		join app.leitfaden_vorlagen v on v.betrieb_id = e.betrieb_id and v.aktiv
		join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
		join app.benutzer b on b.id = e.benutzer_id and b.betrieb_id = e.betrieb_id
		where e.ende < now() and e.ende > now() - interval '2 days' and e.ende > v.angelegt
			and (e.art = any (v.arten) or e.terminart_id = any (v.terminarten))
			and not exists (select 1 from app.leitfaden_durchlaeufe d where d.einsatz_id = e.id and d.status <> 'offen')
			and not exists (select 1 from app.leitfaden_verpasst x where x.einsatz_id = e.id)
		order by e.ende
		limit greatest(1, least(coalesce(p_limit, 200), 1000))
	loop
		insert into app.leitfaden_verpasst (einsatz_id, betrieb_id) values (z.id, z.betrieb_id) on conflict do nothing;
		if not found then continue; end if;
		for u in
			select b.id from app.benutzer b join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
			where b.betrieb_id = z.betrieb_id and b.aktiv and 'auftraege.alle_lesen' = any (r.rechte)
		loop
			perform app.benachrichtige(z.betrieb_id, u.id, 'termin', 'leitfaden-verpasst:' || z.id,
				'Leitfaden nicht abgeschlossen: ' || z.nummer || ' ' || z.titel,
				'Der Termin von ' || z.person || ' ist vorbei – der Leitfaden wurde nicht abgeschlossen.',
				'/auftraege/' || z.auftrag_id || '#leitfaden');
		end loop;
		n := n + 1;
	end loop;
	return n;
end $$;
revoke all on function app.leitfaden_verpasst_melden(integer) from public;
grant execute on function app.leitfaden_verpasst_melden(integer) to crm_auth;
