<script lang="ts">
	import { enhance } from '$app/forms';
	import Karte from '$lib/components/Karte.svelte';
	import { centAlsEingabe, euro } from '$lib/geld';
	import type { MitarbeiterWerte } from '$lib/kalkulation';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const b = $derived(data.betrieb);
	const u = $derived(data.uebersicht);
	const zahl = (n: number, stellen = 2) => n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: stellen });
	const satz = (c: number | null) => (c === null ? '–' : `${euro(c)}/h`);
	const fehlerIn = (bereich: string) => (form?.bereich === bereich ? form.fehler : null);
	// Bei Fehlern die Eingaben behalten, sonst die gespeicherten Werte
	const wert = (bereich: string, feld: string, gespeichert: string) =>
		form?.bereich === bereich && form.werte ? ((form.werte as Record<string, string>)[feld] ?? '') : gespeichert;

	const firmaFelder = $derived({
		jahr: String(b.jahr),
		gemeinkosten: centAlsEingabe(b.gemeinkostenCent),
		anzahlProduktiv: zahl(b.anzahlProduktiv),
		feiertage: zahl(b.feiertage, 1),
		pufferArt: b.pufferArt,
		pufferWert: zahl(b.pufferWert),
		gewinnProzent: zahl(b.gewinnProzent),
		risikoProzent: zahl(b.risikoProzent),
		aktuellerSatz: b.aktuellerSatzCent === null ? '' : centAlsEingabe(b.aktuellerSatzCent)
	});

	const maFelder = (name: string, benutzerId: string | null, w: MitarbeiterWerte) => ({
		name,
		benutzerId: benutzerId ?? '',
		brutto: centAlsEingabe(w.bruttoCent),
		agArt: w.agArt,
		agProzent: w.agProzent === null ? '' : zahl(w.agProzent),
		agEuro: w.agEuroCent === null ? '' : centAlsEingabe(w.agEuroCent),
		wochenstunden: zahl(w.wochenstunden),
		urlaubstage: zahl(w.urlaubstage, 1),
		krankheitstage: zahl(w.krankheitstage, 1)
	});
	const LEER = { name: '', benutzerId: '', brutto: '', agArt: 'prozent', agProzent: '21', agEuro: '', wochenstunden: '40', urlaubstage: '30', krankheitstage: '10' };

	const VERGLEICH = {
		unter_kosten: ['Aktueller Satz deckt die Kosten nicht', 'schlecht'],
		kosten_gedeckt: ['Aktueller Satz deckt die Kosten, Gewinn noch nicht erreicht', 'mittel'],
		mit_gewinn: ['Aktueller Satz bringt Gewinn', 'gut']
	} as const;

	let agArtNeu = $state<string | null>(null);
	let pufferArt = $state<string | null>(null);
	const pufferAktuell = $derived(pufferArt ?? wert('firma', 'pufferArt', firmaFelder.pufferArt));
</script>

<svelte:head>
	<title>Kalkulation – Stundensatz</title>
</svelte:head>

<main class="kd-seite kk-seite">
	<h1>Kalkulation / Stundensatz</h1>
	<p class="kd-info">
		Was muss jeder Mitarbeiter pro Stunde einbringen, damit die Kosten gedeckt sind – und was, damit Gewinn bleibt? Rechnung für das
		Jahr {b.jahr}.
	</p>

	<section class="kk-kacheln" aria-label="Firmenschnitt">
		<div class="kk-kachel">
			<span class="kk-label">Fakturierbare Stunden / Jahr (alle)</span>
			<strong>{zahl(u.fakturierbareStunden)} h</strong>
		</div>
		<div class="kk-kachel">
			<span class="kk-label">Kostendeckend (Ø Firma)</span>
			<strong>{satz(u.kostendeckendCent)}</strong>
		</div>
		<div class="kk-kachel kk-haupt">
			<span class="kk-label">Empfohlen inkl. Gewinn (Ø Firma)</span>
			<strong>{satz(u.empfohlenCent)}</strong>
		</div>
	</section>
	{#each u.hinweise as h (h)}<p class="kt-hinweis warnung">{h}</p>{/each}

	<h2>Mitarbeiter</h2>
	{#if u.mitarbeiter.length === 0}
		<p class="kd-leer">Noch keine Mitarbeiter erfasst. Unten „+ Mitarbeiter“ wählen.</p>
	{/if}
	<div class="kk-liste">
		{#each u.mitarbeiter as zeile (zeile.id)}
			{@const e = zeile.ergebnis}
			{@const ma = data.mitarbeiter.find((m) => m.id === zeile.id)!}
			<Karte>
				{#snippet titel()}{zeile.name}{/snippet}
				<div class="kk-werte" aria-label={`Ergebnis ${zeile.name}`}>
					<div>
						<span class="kk-label">Fakturierbare Stunden</span>
						<strong>{zahl(e.fakturierbareStunden)} h/Jahr</strong>
					</div>
					<div>
						<span class="kk-label">Untergrenze (kostendeckend)</span>
						<strong>{satz(e.kostendeckendCent)}</strong>
					</div>
					<div class="kk-haupt">
						<span class="kk-label">Empfohlen (inkl. {zahl(e.aufschlagProzent)} %)</span>
						<strong>{satz(e.empfohlenCent)}</strong>
					</div>
				</div>
				<div class="kk-badges">
					{#if zeile.lage}
						<span class={`kk-badge ${zeile.lage === 'ueber' ? 'mittel' : 'gut'}`}>
							{zeile.lage === 'ueber' ? 'über' : 'unter'} dem Firmenschnitt
						</span>
					{/if}
					{#if e.vergleich}
						<span class={`kk-badge ${VERGLEICH[e.vergleich][1]}`}>{VERGLEICH[e.vergleich][0]} ({euro(b.aktuellerSatzCent!)}/h)</span>
					{/if}
				</div>
				{#each e.warnungen as w (w)}<p class="kt-hinweis warnung">{w}</p>{/each}

				<details class="kk-rechnung">
					<summary>So wird gerechnet</summary>
					<table class="kk-tabelle">
						<tbody>
							<tr class="kk-schritt"><th colspan="2">1. Gesamtkosten pro Jahr</th></tr>
							<tr><td>Bruttojahresgehalt</td><td>{euro(e.bruttoCent)}</td></tr>
							<tr>
								<td>+ Arbeitgeber-Anteil{ma.werte.agArt === 'prozent' ? ` (${zahl(ma.werte.agProzent ?? 0)} %)` : ''}</td>
								<td>{euro(e.agAnteilCent)}</td>
							</tr>
							<tr>
								<td>+ Anteil Gemeinkosten ({euro(b.gemeinkostenCent)} ÷ {zahl(b.anzahlProduktiv)})</td>
								<td>{e.gemeinkostenAnteilCent === null ? '–' : euro(e.gemeinkostenAnteilCent)}</td>
							</tr>
							<tr class="kk-summe"><td>= Gesamtkosten</td><td>{e.gesamtkostenCent === null ? '–' : euro(e.gesamtkostenCent)}</td></tr>
							<tr class="kk-schritt"><th colspan="2">2. Fakturierbare Stunden</th></tr>
							<tr><td>Tage im Jahr {b.jahr}</td><td>{e.tageImJahr}</td></tr>
							<tr><td>− Wochenenden</td><td>{e.wochenendTage}</td></tr>
							<tr><td>− Feiertage</td><td>{zahl(e.feiertage, 1)}</td></tr>
							<tr><td>− Urlaub</td><td>{zahl(e.urlaubstage, 1)}</td></tr>
							<tr><td>− Krankheit</td><td>{zahl(e.krankheitstage, 1)}</td></tr>
							<tr class="kk-summe"><td>= Arbeitstage</td><td>{zahl(e.arbeitstage, 1)}</td></tr>
							<tr><td>× Stunden pro Tag ({zahl(ma.werte.wochenstunden)} h ÷ 5)</td><td>{zahl(e.stundenProTag)} h</td></tr>
							<tr><td>= Anwesenheit</td><td>{zahl(e.anwesenheitsStunden)} h</td></tr>
							<tr>
								<td>− Puffer für interne Zeiten ({b.pufferArt === 'prozent' ? `${zahl(b.pufferWert)} %` : `${zahl(b.pufferWert)} h/Jahr`})</td>
								<td>{zahl(e.pufferStunden)} h</td>
							</tr>
							<tr class="kk-summe"><td>= Fakturierbare Stunden</td><td>{zahl(e.fakturierbareStunden)} h</td></tr>
							<tr class="kk-schritt"><th colspan="2">3. Stundensätze</th></tr>
							<tr><td>Kostendeckend = Gesamtkosten ÷ fakturierbare Stunden</td><td>{satz(e.kostendeckendCent)}</td></tr>
							<tr>
								<td>Empfohlen = kostendeckend × (1 + {zahl(b.gewinnProzent)} % Gewinn + {zahl(b.risikoProzent)} % Risiko)</td>
								<td><strong>{satz(e.empfohlenCent)}</strong></td>
							</tr>
						</tbody>
					</table>
				</details>

				<details class="kk-bearbeiten" open={form?.bereich === `ma-${zeile.id}`}>
					<summary>Bearbeiten</summary>
					{@render mitarbeiterFormular('?/mitarbeiterAendern', `ma-${zeile.id}`, maFelder(ma.name, ma.benutzerId, ma.werte), zeile.id)}
					<form method="POST" action="?/mitarbeiterLoeschen" use:enhance>
						<input type="hidden" name="id" value={zeile.id} />
						<button type="submit" class="kd-knopf gefahr">Mitarbeiter entfernen</button>
					</form>
				</details>
			</Karte>
		{/each}
	</div>

	<details class="kk-neu" open={form?.bereich === 'neu' || u.mitarbeiter.length === 0}>
		<summary class="kd-knopf">+ Mitarbeiter</summary>
		{@render mitarbeiterFormular('?/mitarbeiterNeu', 'neu', LEER, null)}
	</details>

	<h2>Firmenwerte</h2>
	<form method="POST" action="?/firma" use:enhance class="kd-formular kk-firma">
		{#if fehlerIn('firma')}<p role="alert" class="kd-fehler">{fehlerIn('firma')}</p>{/if}
		<div class="kk-raster">
			<label>Jahr <input type="number" name="jahr" min="2000" max="2100" required value={wert('firma', 'jahr', firmaFelder.jahr)} /></label>
			<label>
				Gemeinkosten pro Jahr (€)
				<input type="text" inputmode="decimal" name="gemeinkosten" required value={wert('firma', 'gemeinkosten', firmaFelder.gemeinkosten)} />
				<span class="kd-info">Miete, Fahrzeuge, Software, Versicherungen, Marketing …</span>
			</label>
			<label>
				Anzahl produktiver Mitarbeiter
				<input type="text" inputmode="decimal" name="anzahlProduktiv" required value={wert('firma', 'anzahlProduktiv', firmaFelder.anzahlProduktiv)} />
				<span class="kd-info">auf sie werden die Gemeinkosten verteilt</span>
			</label>
			<label>
				Feiertage (auf Werktagen)
				<input type="text" inputmode="decimal" name="feiertage" required value={wert('firma', 'feiertage', firmaFelder.feiertage)} />
			</label>
			<fieldset class="kk-puffer">
				<legend>Puffer für interne Zeiten (Meetings, Weiterbildung …)</legend>
				<div class="kk-zwei">
					<select name="pufferArt" aria-label="Puffer in" onchange={(ev) => (pufferArt = ev.currentTarget.value)}>
						<option value="prozent" selected={pufferAktuell === 'prozent'}>Prozent</option>
						<option value="stunden" selected={pufferAktuell === 'stunden'}>Stunden pro Jahr</option>
					</select>
					<input type="text" inputmode="decimal" name="pufferWert" aria-label="Puffer" required value={wert('firma', 'pufferWert', firmaFelder.pufferWert)} />
				</div>
			</fieldset>
			<label>Gewinnaufschlag (%) <input type="text" inputmode="decimal" name="gewinnProzent" required value={wert('firma', 'gewinnProzent', firmaFelder.gewinnProzent)} /></label>
			<label>Wagnis-/Risikoaufschlag (%) <input type="text" inputmode="decimal" name="risikoProzent" required value={wert('firma', 'risikoProzent', firmaFelder.risikoProzent)} /></label>
			<label>
				Aktueller Stundensatz (€, optional)
				<input type="text" inputmode="decimal" name="aktuellerSatz" value={wert('firma', 'aktuellerSatz', firmaFelder.aktuellerSatz)} />
				<span class="kd-info">zum Vergleich je Mitarbeiter</span>
			</label>
		</div>
		<button type="submit" class="kd-knopf">Firmenwerte speichern</button>
	</form>
	<p class="kd-info">
		Wochenenden werden für das gewählte Jahr genau gezählt ({b.jahr}: Samstage und Sonntage im Kalender). Gehälter sieht nur, wer
		„Preise sehen“ und „Einstellungen“ hat.
	</p>
</main>

{#snippet mitarbeiterFormular(aktion: string, bereich: string, start: Record<string, string>, id: string | null)}
	{@const agArt = bereich === 'neu' && agArtNeu ? agArtNeu : wert(bereich, 'agArt', start.agArt)}
	<form method="POST" action={aktion} use:enhance class="kd-formular kk-ma-formular">
		{#if fehlerIn(bereich)}<p role="alert" class="kd-fehler">{fehlerIn(bereich)}</p>{/if}
		{#if id}<input type="hidden" name="id" value={id} />{/if}
		<div class="kk-raster">
			<label>Name <input type="text" name="name" maxlength="200" required value={wert(bereich, 'name', start.name)} /></label>
			<label>
				Benutzer der Software (optional)
				<select name="benutzerId">
					<option value="">– keiner –</option>
					{#each data.benutzer as nutzer (nutzer.id)}
						<option value={nutzer.id} selected={wert(bereich, 'benutzerId', start.benutzerId) === nutzer.id}>{nutzer.name}</option>
					{/each}
				</select>
			</label>
			<label>Bruttojahresgehalt (€) <input type="text" inputmode="decimal" name="brutto" required value={wert(bereich, 'brutto', start.brutto)} /></label>
			<fieldset class="kk-puffer">
				<legend>Arbeitgeber-Anteil / Lohnnebenkosten</legend>
				<div class="kk-zwei">
					<select name="agArt" aria-label="Arbeitgeber-Anteil in" onchange={(ev) => bereich === 'neu' && (agArtNeu = ev.currentTarget.value)}>
						<option value="prozent" selected={agArt === 'prozent'}>Prozent vom Brutto</option>
						<option value="euro" selected={agArt === 'euro'}>Euro pro Jahr</option>
					</select>
					<input type="text" inputmode="decimal" name="agProzent" aria-label="Arbeitgeber-Anteil in Prozent" placeholder="z. B. 21" value={wert(bereich, 'agProzent', start.agProzent)} />
					<input type="text" inputmode="decimal" name="agEuro" aria-label="Arbeitgeber-Anteil in Euro" placeholder="z. B. 9.000" value={wert(bereich, 'agEuro', start.agEuro)} />
				</div>
				<span class="kd-info">Je nach Auswahl zählt das Feld „Prozent“ oder „Euro“.</span>
			</fieldset>
			<label>Wochenarbeitszeit (h) <input type="text" inputmode="decimal" name="wochenstunden" required value={wert(bereich, 'wochenstunden', start.wochenstunden)} /></label>
			<label>Urlaubstage / Jahr <input type="text" inputmode="decimal" name="urlaubstage" required value={wert(bereich, 'urlaubstage', start.urlaubstage)} /></label>
			<label>Krankheitstage / Jahr (geschätzt) <input type="text" inputmode="decimal" name="krankheitstage" required value={wert(bereich, 'krankheitstage', start.krankheitstage)} /></label>
		</div>
		<button type="submit" class="kd-knopf">{id ? 'Speichern' : 'Mitarbeiter hinzufügen'}</button>
	</form>
{/snippet}

<style>
	.kk-seite {
		max-width: 64rem;
	}
	.kk-kacheln {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
		margin: 1rem 0;
	}
	.kk-kachel {
		display: grid;
		gap: 0.25rem;
		padding: 0.9rem 1rem;
		border-radius: var(--m365-radius-karte);
		background: var(--m365-flaeche);
		box-shadow: var(--m365-schatten);
	}
	.kk-kachel strong {
		font-size: 1.5rem;
		font-weight: 600;
	}
	.kk-haupt strong {
		color: var(--m365-primaer);
	}
	.kk-label {
		font-size: 0.8125rem;
		color: var(--m365-text-leise);
	}
	.kk-liste {
		display: grid;
		gap: 0.75rem;
	}
	.kk-werte {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.75rem;
	}
	.kk-werte > div {
		display: grid;
		gap: 0.15rem;
	}
	.kk-werte strong {
		font-size: 1.25rem;
		font-weight: 600;
	}
	.kk-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.6rem 0 0;
	}
	.kk-badge {
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		background: var(--m365-flaeche-hover);
	}
	.kk-badge.gut {
		background: var(--m365-erfolg-hell);
		color: var(--m365-erfolg);
	}
	.kk-badge.mittel {
		background: var(--m365-warnung-hell);
		color: var(--m365-text);
	}
	.kk-badge.schlecht {
		background: var(--m365-fehler-hell);
		color: var(--m365-fehler);
	}
	.kk-rechnung summary,
	.kk-bearbeiten summary {
		display: inline-flex;
		align-items: center;
		min-height: var(--tippziel, 44px);
		color: var(--m365-primaer);
		cursor: pointer;
	}
	.kk-tabelle {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	.kk-tabelle td,
	.kk-tabelle th {
		padding: 0.3rem 0.25rem;
		border-bottom: 1px solid var(--m365-rand);
		text-align: left;
		vertical-align: top;
	}
	.kk-tabelle td:last-child {
		text-align: right;
		white-space: nowrap;
		padding-left: 0.75rem;
	}
	.kk-schritt th {
		padding-top: 0.75rem;
		font-weight: 600;
		color: var(--m365-primaer-dunkel);
	}
	.kk-summe td {
		font-weight: 600;
	}
	.kk-neu {
		margin: 1rem 0 1.5rem;
	}
	.kk-neu > summary {
		list-style: none;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}
	.kk-raster {
		display: grid;
		gap: 0.75rem;
	}
	@media (min-width: 700px) {
		.kk-raster {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.kk-puffer {
		border: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.25rem;
	}
	.kk-puffer legend {
		padding: 0;
		margin-bottom: 0.25rem;
	}
	.kk-zwei {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: 0.5rem;
	}
	.kk-firma {
		margin-bottom: 0.75rem;
	}
</style>
