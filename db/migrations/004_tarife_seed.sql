-- Start-Tarife (idempotent: Upsert über den Schlüssel).
-- Namen und Grenzen sind Platzhalter – Can legt die endgültigen Werte fest (Pflichtenheft 9.3).
-- Module: kunden, auftraege, plantafel, katalog, angebote, ki_angebote, sprache, zeiterfassung,
--         protokolle, kundenportal, lexware, nextcloud.

insert into app.tarife (schluessel, name, module, grenzen) values
	(
		'test',
		'Test',
		array['kunden', 'auftraege', 'plantafel', 'katalog', 'angebote', 'ki_angebote', 'sprache',
			'zeiterfassung', 'protokolle', 'kundenportal', 'lexware', 'nextcloud'],
		'{"benutzer": 50, "ki_pro_monat": 2000}'::jsonb
	),
	(
		'basis',
		'Basis',
		array['kunden', 'auftraege', 'plantafel', 'katalog', 'angebote'],
		'{"benutzer": 3, "ki_pro_monat": 0}'::jsonb
	),
	(
		'profi',
		'Profi',
		array['kunden', 'auftraege', 'plantafel', 'katalog', 'angebote', 'ki_angebote', 'sprache',
			'zeiterfassung', 'protokolle'],
		'{"benutzer": 10, "ki_pro_monat": 300}'::jsonb
	),
	(
		'premium',
		'Premium',
		array['kunden', 'auftraege', 'plantafel', 'katalog', 'angebote', 'ki_angebote', 'sprache',
			'zeiterfassung', 'protokolle', 'kundenportal', 'lexware', 'nextcloud'],
		'{"benutzer": 30, "ki_pro_monat": 1500}'::jsonb
	)
on conflict (schluessel) do update
	set name = excluded.name,
		module = excluded.module,
		grenzen = excluded.grenzen;
