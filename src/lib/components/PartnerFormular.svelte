<script lang="ts">
	import { enhance } from '$app/forms';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import { PARTNER_ART_NAMEN, PARTNER_ARTEN } from '$lib/partner';

	/**
	 * Stammdaten und Konditionen eines Partners (Jamil msg 2856). Portal-Link nur als Adresse mit Notiz – Zugangsdaten
	 * gehören nicht ins CRM.
	 */
	type Werte = Record<string, unknown>;
	let { werte, action, knopf, fehler = null, mitAktiv = false }: { werte: Werte; action: string; knopf: string; fehler?: string | null; mitAktiv?: boolean } = $props();
	const w = (k: string) => (werte[k] === null || werte[k] === undefined ? '' : String(werte[k]).replace('.', k.endsWith('Prozent') ? ',' : '.'));
</script>

<form method="POST" {action} use:enhance={() => async ({ update }) => update({ reset: false })} class="kd-formular pf-form">
	{#if fehler}<p class="kd-fehler" role="alert">{fehler}</p>{/if}
	<div class="pf-raster">
		<label>Art
			<Auswahl name="art" required>
				{#each PARTNER_ARTEN as a (a)}<option value={a} selected={werte.art === a}>{PARTNER_ART_NAMEN[a]}</option>{/each}
			</Auswahl>
		</label>
		<label>Name <input name="name" required maxlength="200" value={w('name')} /></label>
		<label>Unsere Kunden-/Lieferantennummer <input name="nummer" maxlength="60" value={w('nummer')} /></label>
		<label>Telefon <input name="telefon" type="tel" maxlength="50" value={w('telefon')} /></label>
		<label>E-Mail <input name="email" type="email" maxlength="200" value={w('email')} /></label>
		<label>Website <input name="web" maxlength="300" value={w('web')} /></label>
		<label>Straße <input name="strasse" maxlength="200" value={w('strasse')} /></label>
		<label>PLZ <input name="plz" maxlength="20" value={w('plz')} /></label>
		<label>Ort <input name="ort" maxlength="200" value={w('ort')} /></label>
	</div>
	<fieldset>
		<legend>Partner-Portal</legend>
		<div class="pf-raster">
			<label>Adresse des Portals <input name="portalUrl" inputmode="url" maxlength="2000" placeholder="https://partner.example.de" value={w('portalUrl')} /></label>
			<label>Notiz <input name="portalNotiz" maxlength="500" placeholder="z. B. Zugang hat das Büro" value={w('portalNotiz')} /></label>
		</div>
		<p class="kd-info">Bitte keine Passwörter speichern.</p>
	</fieldset>
	<fieldset>
		<legend>Konditionen</legend>
		<div class="pf-raster">
			<label>Provision % <input name="provisionProzent" inputmode="decimal" maxlength="6" value={w('provisionProzent')} /></label>
			<label>Rabatt % <input name="rabattProzent" inputmode="decimal" maxlength="6" value={w('rabattProzent')} /></label>
			<label>Zahlungsziel (Tage) <input name="zahlungszielTage" inputmode="numeric" maxlength="3" value={w('zahlungszielTage')} /></label>
		</div>
	</fieldset>
	<label>Notizen <textarea name="notizen" rows="3" maxlength="5000">{w('notizen')}</textarea></label>
	{#if mitAktiv}<Schalter name="aktiv" label="Aktiv" an={werte.aktiv !== false} hinweis="Inaktive erscheinen nicht mehr in Auswahlen" />{/if}
	<div class="af-fuss"><button type="submit" class="kd-knopf">{knopf}</button></div>
</form>

<style>
	.pf-raster {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
	}
</style>
