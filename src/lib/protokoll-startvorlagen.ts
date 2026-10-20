import type { Schema } from './protokoll-formular';

/**
 * Beispiel-Vorlagen für Protokolle (Wunsch Jamil, Talk msg 2649): „Abdichtungsprotokoll Bad“ (Foto der Abdichtung als
 * Pflicht-Schritt, Mängel nur bei „ja“, Unterschrift des Kunden am Ende) und „Abnahmeprotokoll“ (Foto der Mängel nur
 * Pflicht, wenn Mängel vorhanden). Der Seed legt sie für den Testbetrieb an; jeder Betrieb kann sie unter
 * Einstellungen → Protokoll-Vorlagen übernehmen und frei ändern.
 */

export type Startvorlage = { schluessel: string; name: string; beschreibung: string; schema: Schema };

export const STARTVORLAGEN: Startvorlage[] = [
	{
		schluessel: 'abdichtung-bad',
		name: 'Abdichtungsprotokoll Bad',
		beschreibung: 'Verbundabdichtung im Bad (DIN 18534): Untergrund, Ausführung, Pflicht-Foto der Abdichtung, Unterschrift.',
		schema: {
			seiten: [
				{
					id: 's_untergrund',
					titel: 'Untergrund',
					abschnitte: [
						{
							id: 'a_untergrund',
							titel: 'Vor der Abdichtung',
							felder: [
								{ id: 'hinweis_start', typ: 'hinweis', label: 'Abdichtung nach DIN 18534', hilfe: 'Bitte jeden Schritt vor Ort ausfüllen. Weiter geht es erst, wenn alle Pflichtfelder erledigt sind.' },
								{ id: 'datum', typ: 'datum', label: 'Datum der Abdichtung', pflicht: true },
								{
									id: 'untergrund',
									typ: 'auswahl',
									label: 'Untergrund',
									pflicht: true,
									optionen: ['Zementestrich', 'Anhydritestrich', 'Gipskarton', 'Mauerwerk / Putz', 'Altfliesen']
								},
								{ id: 'restfeuchte', typ: 'messwert', label: 'Restfeuchte Estrich', einheit: 'CM-%', min: 0, max: 10, hilfe: 'Zementestrich höchstens 2,0 CM-%, Anhydrit höchstens 0,5 CM-%.' },
								{ id: 'tragfaehig', typ: 'janein', label: 'Untergrund tragfähig, sauber und trocken?', pflicht: true }
							]
						}
					]
				},
				{
					id: 's_abdichtung',
					titel: 'Abdichtung',
					abschnitte: [
						{
							id: 'a_system',
							titel: 'System',
							felder: [
								{ id: 'system', typ: 'auswahl', label: 'Abdichtungssystem', pflicht: true, optionen: ['Flüssigabdichtung', 'Dichtbahn', 'Dichtschlämme'] },
								{ id: 'produkt', typ: 'text', label: 'Hersteller / Produkt' },
								{ id: 'schichtdicke', typ: 'messwert', label: 'Schichtdicke (trocken)', einheit: 'mm', min: 0, max: 10 }
							]
						},
						{
							id: 'a_ausfuehrung',
							titel: 'Ausführung',
							felder: [
								{
									id: 'ausfuehrung',
									typ: 'checkliste',
									label: 'Ausführung geprüft',
									pflicht: true,
									optionen: ['Grundierung aufgetragen', 'Dichtband in Ecken und Übergängen', 'Manschetten an Durchdringungen', 'Bodenablauf eingebunden', 'Zwei Schichten aufgetragen']
								}
							]
						}
					]
				},
				{
					id: 's_fotos',
					titel: 'Fotos',
					abschnitte: [
						{
							id: 'a_fotos',
							felder: [
								{ id: 'foto_abdichtung', typ: 'foto', label: 'Foto der Abdichtung', pflicht: true, minFotos: 1, hilfe: 'Gesamtansicht – ohne Foto geht es nicht weiter.' },
								{ id: 'foto_details', typ: 'foto', label: 'Detailfotos (Ecken, Durchdringungen)' }
							]
						}
					]
				},
				{
					id: 's_maengel',
					titel: 'Mängel',
					abschnitte: [
						{
							id: 'a_maengel',
							felder: [
								{ id: 'mangel', typ: 'janein', label: 'Mangel festgestellt?', pflicht: true },
								{
									id: 'mangel_text',
									typ: 'textlang',
									label: 'Beschreibung des Mangels',
									pflicht: true,
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' }
								},
								{
									id: 'mangel_foto',
									typ: 'foto',
									label: 'Foto des Mangels',
									pflicht: true,
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' }
								}
							]
						}
					]
				},
				{
					id: 's_abschluss',
					titel: 'Unterschrift',
					abschnitte: [
						{
							id: 'a_abschluss',
							felder: [
								{ id: 'bemerkung', typ: 'textlang', label: 'Bemerkung' },
								{ id: 'unterschrift_kunde', typ: 'unterschrift', label: 'Unterschrift Kunde', wer: 'kunde', pflicht: true },
								{ id: 'unterschrift_monteur', typ: 'unterschrift', label: 'Unterschrift Monteur', wer: 'monteur' }
							]
						}
					]
				}
			]
		}
	},
	{
		schluessel: 'abnahme',
		name: 'Abnahmeprotokoll',
		beschreibung: 'Abnahme der Leistung mit Begehung, Mängeln (Foto nur Pflicht bei Mängeln) und Unterschrift des Kunden.',
		schema: {
			seiten: [
				{
					id: 's_abnahme',
					titel: 'Abnahme',
					abschnitte: [
						{
							id: 'a_abnahme',
							felder: [
								{ id: 'datum', typ: 'datum', label: 'Datum der Abnahme', pflicht: true },
								{ id: 'uhrzeit', typ: 'uhrzeit', label: 'Uhrzeit' },
								{ id: 'art', typ: 'auswahl', label: 'Art der Abnahme', pflicht: true, optionen: ['Gesamtabnahme', 'Teilabnahme'] },
								{
									id: 'teil',
									typ: 'text',
									label: 'Welcher Teil wird abgenommen?',
									pflicht: true,
									bedingung: { feld: 'art', op: 'gleich', wert: 'Teilabnahme', wirkung: 'zeigen' }
								},
								{ id: 'leistungen', typ: 'textlang', label: 'Abgenommene Leistungen' }
							]
						}
					]
				},
				{
					id: 's_pruefung',
					titel: 'Begehung',
					abschnitte: [
						{
							id: 'a_begehung',
							felder: [
								{
									id: 'begehung',
									typ: 'checkliste',
									label: 'Begehung',
									optionen: ['Arbeiten vollständig ausgeführt', 'Baustelle sauber übergeben', 'Unterlagen / Anleitungen übergeben', 'Bedienung und Wartung erklärt']
								},
								{ id: 'mangel', typ: 'janein', label: 'Mängel vorhanden?', pflicht: true },
								{
									id: 'maengel',
									typ: 'textlang',
									label: 'Mängel',
									pflicht: true,
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' }
								},
								{
									id: 'mangel_foto',
									typ: 'foto',
									label: 'Fotos der Mängel',
									hilfe: 'Pflicht, sobald Mängel vorhanden sind.',
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'pflicht' }
								},
								{
									id: 'frist',
									typ: 'datum',
									label: 'Frist zur Mängelbeseitigung',
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' }
								}
							]
						}
					]
				},
				{
					id: 's_fotos',
					titel: 'Fotos',
					abschnitte: [{ id: 'a_fotos', felder: [{ id: 'foto_fertig', typ: 'foto', label: 'Foto der fertigen Arbeit', pflicht: true }] }]
				},
				{
					id: 's_unterschrift',
					titel: 'Unterschrift',
					abschnitte: [
						{
							id: 'a_unterschrift',
							felder: [
								{
									id: 'hinweis_abnahme',
									typ: 'hinweis',
									label: 'Erklärung',
									hilfe: 'Mit seiner Unterschrift bestätigt der Auftraggeber die Abnahme der oben genannten Leistungen – vorbehaltlich der aufgeführten Mängel.'
								},
								{ id: 'unterschrift_kunde', typ: 'unterschrift', label: 'Unterschrift Auftraggeber', wer: 'kunde', pflicht: true },
								{ id: 'unterschrift_monteur', typ: 'unterschrift', label: 'Unterschrift Auftragnehmer', wer: 'monteur' }
							]
						}
					]
				}
			]
		}
	}
];
