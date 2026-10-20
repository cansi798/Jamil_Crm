<script lang="ts">
	import { enhance } from '$app/forms';
	import Karte from '$lib/components/Karte.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import { centAlsEingabe, euro } from '$lib/geld';
	import {
		INTERVALLE,
		INTERVALL_NAMEN,
		jahresbetrag,
		KATEGORIEN,
		KATEGORIE_NAMEN,
		type KostenZeile,
		type MitarbeiterWerte
	} from '$lib/kalkulation';
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
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });

	const firmaFelder = $derived({
		standardTage: zahl(b.standardTage, 1),
		standardStundenTag: zahl(b.standardStundenTag),
		risikoProzent: zahl(b.risikoProzent),
		gewinnProzent: zahl(b.gewinnProzent),
		aktuellerSatz: b.aktuellerSatzCent === null ? '' : centAlsEingabe(b.aktuellerSatzCent)
	});
	const kostenFelder = (z: KostenZeile) => ({
		name: z.name,
		kategorie: z.kategorie,
		betrag: centAlsEingabe(z.betragCent),
		intervall: z.intervall,
		abschreibungMonate: z.abschreibungMonate === null ? '' : String(z.abschreibungMonate),
		aktiv: z.aktiv ? 'true' : 'false'
	});
	const KOSTEN_LEER = { name: '', kategorie: 'fixkosten', betrag: '', intervall: 'monatlich', abschreibungMonate: '', aktiv: 'true' };
	const maFelder = (name: string, benutzerId: string | null, w: MitarbeiterWerte) => ({
		name,
		benutzerId: benutzerId ?? '',
		brutto: centAlsEingabe(w.bruttoCent),
		agArt: w.agArt,
		agProzent: w.agProzent === null ? '' : zahl(w.agProzent),
		agEuro: w.agEuroCent === null ? '' : centAlsEingabe(w.agEuroCent),
		tageJahr: w.tageJahr === null ? '' : zahl(w.tageJahr, 1),
		stundenTag: w.stundenTag === null ? '' : zahl(w.stundenTag)
	});
	const MA_LEER = { name: '', benutzerId: '', brutto: '', agArt: 'prozent', agProzent: '21', agEuro: '', tageJahr: '', stundenTag: '' };

	const VERGLEICH = {
		unter_kosten: ['Euer aktueller Satz deckt die Kosten nicht', 'schlecht'],
		kosten_gedeckt: ['Aktueller Satz deckt die Kosten, Gewinn noch nicht erreicht', 'mittel'],
		mit_gewinn: ['Aktueller Satz bringt Gewinn', 'gut']
	} as const;
	const ohneBeispiel = $derived(!data.kosten.some((z) => z.name === 'Lexoffice'));
	let intervallNeu = $state('monatlich');
	let agArtNeu = $state<string | null>(null);
</script>

<svelte:head>
	<title>Kalkulation – Stundensatz</title>
</svelte:head>

<main class="kd-seite kk-seite">
	<h1>Kalkulation / Stundensatz</h1>
	<p class="kd-info">
		Alle Kosten des Betriebs geteilt durch die produktiven Stunden ergibt den Kosten-Stundensatz; mit Wagnis und Gewinn den
		Verrechnungssatz.
	</p>

	<section class="kk-kacheln" aria-label="Ergebnis">
		<div class="kk-kachel">
			<span class="kk-label">Kosten pro Monat</span>
			<strong>{euro(u.monatskostenCent)}</strong>
			<span class="kk-label">{euro(u.gesamtkostenCent)} pro Jahr</span>
		</div>
		<div class="kk-kachel">
			<span class="kk-label">Produktive Stunden / Jahr</span>
			<strong>{zahl(u.produktiveStunden)} h</strong>
			<span class="kk-label">{u.mitarbeiter.length} Mitarbeiter</span>
		</div>
		<div class="kk-kachel">
			<span class="kk-label">Kosten-Stundensatz (kostendeckend)</span>
			<strong aria-label="Kosten-Stundensatz">{satz(u.kostendeckendCent)}</strong>
		</div>
		<div class="kk-kachel kk-haupt">
			<span class="kk-label">Verrechnungssatz (+ {zahl(u.aufschlagProzent)} % Wagnis und Gewinn)</span>
			<strong aria-label="Verrechnungssatz">{satz(u.empfohlenCent)}</strong>
		</div>
	</section>
	{#if u.vergleich && b.aktuellerSatzCent !== null}
		<p><span class={`kk-badge ${VERGLEICH[u.vergleich][1]}`}>{VERGLEICH[u.vergleich][0]} ({euro(b.aktuellerSatzCent)}/h)</span></p>
	{/if}
	{#each u.warnungen as w (w)}<p class="kt-hinweis warnung">{w}</p>{/each}

	{#if ohneBeispiel}
		<form method="POST" action="?/beispiel" use:enhance class="kk-beispiel">
			<p class="kd-info">
				Beispiel aus deiner Excel „Gewinnkalkulation“ übernehmen (13 Kostenzeilen pro Monat, 210 Tage × 7 Stunden; Mitarbeiter nur,
				wenn noch keine erfasst sind). Bestehende Zeilen bleiben, eine alte Gemeinkosten-Summe wird ausgeschaltet.
			</p>
			<button type="submit" class="kd-knopf hell">Beispiel aus der Excel laden</button>
		</form>
	{/if}

	<Karte>
		{#snippet titel()}Kosten{/snippet}
		{#if fehlerIn('beispiel')}<p role="alert" class="kd-fehler">{fehlerIn('beispiel')}</p>{/if}
		{#if data.kosten.length === 0}
			<p class="kd-leer">Noch keine Kosten erfasst – z. B. Miete, Software, Fahrzeuge, Versicherungen.</p>
		{:else}
			<ul class="kk-kosten" aria-label="Kostenzeilen">
				{#each data.kosten as z (z.id)}
					<li class:aus={!z.aktiv}>
						<details open={form?.bereich === `ko-${z.id}`}>
							<summary>
								<span class="kk-kname">{z.name}</span>
								<span class="kk-kat">{KATEGORIE_NAMEN[z.kategorie]}</span>
								<span class="kk-betrag">
									{euro(z.betragCent)} {INTERVALL_NAMEN[z.intervall]}{#if z.intervall === 'einmalig'} ({z.abschreibungMonate} Mon.){/if}
								</span>
								<span class="kk-jahr">{z.aktiv ? `${euro(jahresbetrag(z))}/Jahr` : 'ausgeschaltet'}</span>
							</summary>
							{@render kostenFormular('?/kostenAendern', `ko-${z.id}`, kostenFelder(z), z.id)}
							<form method="POST" action="?/kostenLoeschen" use:enhance class="kk-loeschen">
								<input type="hidden" name="id" value={z.id} />
								<button type="submit" class="kd-knopf hell">Zeile löschen</button>
							</form>
						</details>
					</li>
				{/each}
			</ul>
			<table class="kk-tabelle kk-summen" aria-label="Kosten nach Kategorie">
				<tbody>
					{#each u.kategorien as k (k.kategorie)}
						<tr><td>{KATEGORIE_NAMEN[k.kategorie]}</td><td>{euro(k.jahresCent)}/Jahr</td></tr>
					{/each}
					<tr class="kk-summe"><td>Summe Kostenzeilen</td><td>{euro(u.kostenzeilenCent)}/Jahr</td></tr>
				</tbody>
			</table>
		{/if}
		<AddPanel label="Kostenzeile hinzufügen" offen={form?.bereich === 'kosten-neu'}>
			{#snippet children(schliessen)}
				{@render kostenFormular('?/kostenNeu', 'kosten-neu', KOSTEN_LEER, null, schliessen)}
			{/snippet}
		</AddPanel>
	</Karte>

	<Karte>
		{#snippet titel()}Mitarbeiter (produktive Stunden){/snippet}
		{#if u.mitarbeiter.length === 0}
			<p class="kd-leer">Noch keine Mitarbeiter erfasst.</p>
		{/if}
		<ul class="kk-kosten" aria-label="Mitarbeiter">
			{#each u.mitarbeiter as m (m.id)}
				{@const ma = data.mitarbeiter.find((x) => x.id === m.id)!}
				<li>
					<details open={form?.bereich === `ma-${m.id}`}>
						<summary aria-label={`Ergebnis ${m.name}`}>
							<span class="kk-kname">{m.name}</span>
							<span class="kk-kat">{zahl(m.tage, 1)} Tage × {zahl(m.stundenTag)} h</span>
							<span class="kk-betrag">{zahl(m.stunden)} h/Jahr</span>
							<span class="kk-jahr">{m.personalkostenCent > 0 ? `${euro(m.personalkostenCent)}/Jahr` : 'Lohn als Kostenzeile'}</span>
						</summary>
						{@render mitarbeiterFormular('?/mitarbeiterAendern', `ma-${m.id}`, maFelder(ma.name, ma.benutzerId, ma.werte), m.id)}
						<form method="POST" action="?/mitarbeiterLoeschen" use:enhance class="kk-loeschen">
							<input type="hidden" name="id" value={m.id} />
							<button type="submit" class="kd-knopf hell">Mitarbeiter entfernen</button>
						</form>
					</details>
				</li>
			{/each}
		</ul>
		<AddPanel label="Mitarbeiter hinzufügen" offen={form?.bereich === 'neu'}>
			{#snippet children(schliessen)}
				{@render mitarbeiterFormular('?/mitarbeiterNeu', 'neu', MA_LEER, null, schliessen)}
			{/snippet}
		</AddPanel>
	</Karte>

	<Karte>
		{#snippet titel()}Arbeitszeit, Wagnis und Gewinn{/snippet}
		<form method="POST" action="?/firma" use:enhance={ohneReset} class="kd-formular kk-firma">
			{#if fehlerIn('firma')}<p role="alert" class="kd-fehler">{fehlerIn('firma')}</p>{/if}
			<div class="kk-raster">
				<label>
					Produktive Tage im Jahr (Standard)
					<input type="text" inputmode="decimal" name="standardTage" required value={wert('firma', 'standardTage', firmaFelder.standardTage)} />
				</label>
				<label>
					Effektive Stunden pro Tag (Standard)
					<input type="text" inputmode="decimal" name="standardStundenTag" required value={wert('firma', 'standardStundenTag', firmaFelder.standardStundenTag)} />
				</label>
				<label>Wagnis (%) <input type="text" inputmode="decimal" name="risikoProzent" required value={wert('firma', 'risikoProzent', firmaFelder.risikoProzent)} /></label>
				<label>Gewinn (%) <input type="text" inputmode="decimal" name="gewinnProzent" required value={wert('firma', 'gewinnProzent', firmaFelder.gewinnProzent)} /></label>
				<label>
					Aktueller Stundensatz (€, optional)
					<input type="text" inputmode="decimal" name="aktuellerSatz" value={wert('firma', 'aktuellerSatz', firmaFelder.aktuellerSatz)} />
				</label>
			</div>
			<button type="submit" class="kd-knopf">Speichern</button>
		</form>
		<p class="kd-info">Tage und Stunden lassen sich je Mitarbeiter überschreiben. Gehälter sieht nur, wer „Preise sehen“ und „Einstellungen“ hat.</p>
	</Karte>

	<details class="kk-rechnung">
		<summary>So wird gerechnet</summary>
		<table class="kk-tabelle">
			<tbody>
				<tr><td>Kostenzeilen pro Jahr (aktive)</td><td>{euro(u.kostenzeilenCent)}</td></tr>
				<tr><td>+ Personalkosten (Brutto + Arbeitgeber-Anteil)</td><td>{euro(u.personalkostenCent)}</td></tr>
				<tr class="kk-summe"><td>= Kosten pro Jahr</td><td>{euro(u.gesamtkostenCent)}</td></tr>
				<tr><td>÷ produktive Stunden (Σ Tage × Stunden je Mitarbeiter)</td><td>{zahl(u.produktiveStunden)} h</td></tr>
				<tr class="kk-summe"><td>= Kosten-Stundensatz</td><td>{satz(u.kostendeckendCent)}</td></tr>
				<tr><td>× (1 + {zahl(b.risikoProzent)} % Wagnis + {zahl(b.gewinnProzent)} % Gewinn)</td><td></td></tr>
				<tr class="kk-summe"><td>= Verrechnungssatz</td><td><strong>{satz(u.empfohlenCent)}</strong></td></tr>
			</tbody>
		</table>
	</details>
</main>

{#snippet kostenFormular(aktion: string, bereich: string, start: Record<string, string>, id: string | null, schliessen?: () => void)}
	{@const intervall = id ? wert(bereich, 'intervall', start.intervall) : intervallNeu}
	<form method="POST" action={aktion} use:enhance={ohneReset} class="kd-formular kk-ma-formular">
		{#if fehlerIn(bereich)}<p role="alert" class="kd-fehler">{fehlerIn(bereich)}</p>{/if}
		{#if id}<input type="hidden" name="id" value={id} />{/if}
		<div class="kk-raster">
			<label>Bezeichnung <input type="text" name="name" maxlength="200" required value={wert(bereich, 'name', start.name)} placeholder="z. B. Miete" /></label>
			<label>
				Kategorie
				<select name="kategorie">
					{#each KATEGORIEN as k (k)}<option value={k} selected={wert(bereich, 'kategorie', start.kategorie) === k}>{KATEGORIE_NAMEN[k]}</option>{/each}
				</select>
			</label>
			<label>Betrag netto (€) <input type="text" inputmode="decimal" name="betrag" required value={wert(bereich, 'betrag', start.betrag)} /></label>
			<label>
				Intervall
				<select name="intervall" onchange={(ev) => !id && (intervallNeu = ev.currentTarget.value)}>
					{#each INTERVALLE as i (i)}<option value={i} selected={intervall === i}>{INTERVALL_NAMEN[i]}</option>{/each}
				</select>
			</label>
			<label>
				Abschreibung in Monaten (nur einmalig)
				<input type="number" name="abschreibungMonate" min="1" max="600" value={wert(bereich, 'abschreibungMonate', start.abschreibungMonate)} placeholder="z. B. 72" />
			</label>
			{#if id}
				<label class="kd-haken">
					<input type="checkbox" name="aktiv" value="true" checked={wert(bereich, 'aktiv', start.aktiv) !== 'false'} />
					<span>zählt mit (aktiv)</span>
				</label>
				<input type="hidden" name="aktiv" value="false" />
			{/if}
		</div>
		<div class="kk-knoepfe">
			<button type="submit" class="kd-knopf">{id ? 'Speichern' : 'Kostenzeile hinzufügen'}</button>
			{#if schliessen}<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>{/if}
		</div>
	</form>
{/snippet}

{#snippet mitarbeiterFormular(aktion: string, bereich: string, start: Record<string, string>, id: string | null, schliessen?: () => void)}
	{@const agArt = bereich === 'neu' && agArtNeu ? agArtNeu : wert(bereich, 'agArt', start.agArt)}
	<form method="POST" action={aktion} use:enhance={ohneReset} class="kd-formular kk-ma-formular">
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
			<label>
				Bruttojahresgehalt (€, optional)
				<input type="text" inputmode="decimal" name="brutto" value={wert(bereich, 'brutto', start.brutto)} placeholder="leer, wenn der Lohn als Kostenzeile steht" />
			</label>
			<fieldset class="kk-puffer">
				<legend>Arbeitgeber-Anteil</legend>
				<div class="kk-zwei">
					<select name="agArt" aria-label="Arbeitgeber-Anteil in" onchange={(ev) => bereich === 'neu' && (agArtNeu = ev.currentTarget.value)}>
						<option value="prozent" selected={agArt === 'prozent'}>Prozent vom Brutto</option>
						<option value="euro" selected={agArt === 'euro'}>Euro pro Jahr</option>
					</select>
					{#if agArt === 'prozent'}
						<input type="text" inputmode="decimal" name="agProzent" aria-label="Arbeitgeber-Anteil in Prozent" placeholder="z. B. 21" value={wert(bereich, 'agProzent', start.agProzent)} />
					{:else}
						<input type="text" inputmode="decimal" name="agEuro" aria-label="Arbeitgeber-Anteil in Euro" placeholder="z. B. 9.000" value={wert(bereich, 'agEuro', start.agEuro)} />
					{/if}
				</div>
			</fieldset>
			<label>
				Produktive Tage im Jahr
				<input type="text" inputmode="decimal" name="tageJahr" placeholder={`Standard: ${zahl(b.standardTage, 1)}`} value={wert(bereich, 'tageJahr', start.tageJahr)} />
			</label>
			<label>
				Effektive Stunden pro Tag
				<input type="text" inputmode="decimal" name="stundenTag" placeholder={`Standard: ${zahl(b.standardStundenTag)}`} value={wert(bereich, 'stundenTag', start.stundenTag)} />
			</label>
		</div>
		<div class="kk-knoepfe">
			<button type="submit" class="kd-knopf">{id ? 'Speichern' : 'Mitarbeiter hinzufügen'}</button>
			{#if schliessen}<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>{/if}
		</div>
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
	.kk-rechnung summary {
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
	.kk-tabelle td {
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
	.kk-summe td {
		font-weight: 600;
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
	.kk-kosten {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
	}
	.kk-kosten li + li {
		border-top: 1px solid var(--m365-rand);
	}
	.kk-kosten summary {
		display: grid;
		grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.2fr);
		gap: 0.25rem 0.75rem;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.4rem 0.75rem;
		cursor: pointer;
		list-style: none;
	}
	.kk-kosten summary::-webkit-details-marker {
		display: none;
	}
	.kk-kosten summary:hover {
		background: var(--m365-flaeche-hover);
	}
	.kk-kosten details[open] {
		padding-bottom: 0.75rem;
	}
	.kk-kosten details[open] > form {
		padding: 0.5rem 0.75rem 0;
	}
	.kk-kname {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.kk-kat,
	.kk-betrag {
		color: var(--m365-text-leise);
		font-size: 0.875rem;
	}
	.kk-jahr {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.kk-kosten li.aus .kk-kname,
	.kk-kosten li.aus .kk-jahr {
		color: var(--m365-text-leise);
		text-decoration: line-through;
	}
	@media (max-width: 40rem) {
		.kk-kosten summary {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.kk-kat {
			grid-column: 1;
		}
		.kk-betrag {
			display: none;
		}
	}
	.kk-summen {
		margin-bottom: 0.75rem;
	}
	.kk-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.kk-loeschen {
		padding: 0.5rem 0.75rem 0;
	}
	.kk-beispiel {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
		margin: 0 0 1rem;
		padding: 0.75rem 1rem;
		border: 1px dashed var(--m365-rand-stark);
		border-radius: var(--m365-radius);
	}
	.kk-beispiel p {
		margin: 0;
	}
	.kk-rechnung {
		margin: 1rem 0;
	}
</style>
