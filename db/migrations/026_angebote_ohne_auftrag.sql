-- Wunsch Jamil (19.10.2026, Antwort 1 auf den Plan): Angebote auch OHNE Auftrag erstellen und nachträglich einem
-- Kunden oder Auftrag zuordnen; bestehende Angebote einem Auftrag zuordnen.
--
-- auftrag_id darf leer sein. kunde_id nur, solange das Angebot keinen Auftrag hat (mit Auftrag gilt dessen Kunde).
-- Zuordnen ist auch nach dem Versenden erlaubt – aber nur, solange das Angebot noch keinem Auftrag zugeordnet ist;
-- ein Angebot, das schon an einem Auftrag hängt, wandert wie bisher nur als Entwurf (Nachvollziehbarkeit).

alter table app.angebote alter column auftrag_id drop not null;
alter table app.angebote add column kunde_id uuid;
alter table app.angebote
	add constraint angebote_kunde_fk foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id),
	add constraint angebote_kunde_oder_auftrag check (auftrag_id is null or kunde_id is null);
create index angebote_kunde_idx on app.angebote (kunde_id, betrieb_id);

grant insert (kunde_id) on app.angebote to crm_app;
grant update (auftrag_id, kunde_id) on app.angebote to crm_app;

create or replace function app.angebot_nur_entwurf()
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
		new.datum is distinct from old.datum
		or new.gueltig_bis is distinct from old.gueltig_bis or new.mwst_satz is distinct from old.mwst_satz
		or new.einleitung is distinct from old.einleitung or new.schluss is distinct from old.schluss
		or new.vorgaenger_id is distinct from old.vorgaenger_id
		-- Zuordnung: nur ein noch nicht zugeordnetes Angebot (old.auftrag_id leer) darf Auftrag/Kunde bekommen
		or ((new.auftrag_id is distinct from old.auftrag_id or new.kunde_id is distinct from old.kunde_id)
			and old.auftrag_id is not null)
	) then
		raise exception 'Angebot ist nicht mehr änderbar' using errcode = '55000';
	end if;
	return new;
end;
$$;
