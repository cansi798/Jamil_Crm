-- Eigenes Recht für die Sprachsteuerung (Wunsch Jamil, Talk msg 3011): `sprache.nutzen` („Sprachsteuerung nutzen“).
-- Ohne das Recht kein Mikrofon-Knopf und 403 an allen Sprach-Endpunkten (Vorschau, Ausführen, mehrere Schritte).
-- Standard: Chef und Büro ja (Rollen aus diesen Vorlagen bzw. mit „Einstellungen verwalten“), Monteur und andere
-- Rollen nein. In „Einstellungen → Rollen“ je Rolle änderbar.
update app.rollen set rechte = array_append(rechte, 'sprache.nutzen')
where (vorlage in ('chef', 'buero') or 'einstellungen' = any (rechte)) and not ('sprache.nutzen' = any (rechte));
