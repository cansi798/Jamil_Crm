-- Statuswechsel der Angebote auch in der Datenbank absichern (Gesamtprüfung 1c, Befund 4). Erlaubt sind nur
-- entwurf → versendet und versendet → angenommen | abgelehnt | entwurf (wie src/lib/angebot-status.ts); alles andere
-- endet mit 23514 „Statuswechsel nicht erlaubt“ – auch für den Superuser. Ein Update ohne Statusänderung ist erlaubt.

create function app.angebot_statuswechsel()
returns trigger
language plpgsql
as $$
begin
	if new.status is distinct from old.status and not (
		(old.status = 'entwurf' and new.status = 'versendet')
		or (old.status = 'versendet' and new.status in ('angenommen', 'abgelehnt', 'entwurf'))
	) then
		raise exception 'Statuswechsel nicht erlaubt' using errcode = '23514';
	end if;
	return new;
end;
$$;

create trigger angebote_statuswechsel before update of status on app.angebote
	for each row execute function app.angebot_statuswechsel();
