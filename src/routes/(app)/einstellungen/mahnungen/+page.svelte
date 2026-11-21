<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { rueckfrage } from '$lib/rueckfrage';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Karte from '$lib/components/Karte.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import { ZUWEISUNG_NAMEN, ZUWEISUNGEN } from '$lib/nachfassen';
	import { MAHNSTUFE_NAMEN } from '$lib/rechnungen';
	import { euro } from '$lib/geld';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Stufe = PageData['stufen'][number];
	const fehlerIn = (b: string) => (form && 'bereich' in form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const wert = (b: string, feld: string, gespeichert: string) =>
		form && 'bereich' in form && form.bereich === b && 'werte' in form && form.werte && 'fehler' in form ? ((form.werte as Record<string, string>)[feld] ?? '') : gespeichert;
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const vorlagen = $derived(data.vorlagen.filter((v) => v.zweck === 'zahlungserinnerung' || v.zweck === 'mahnung'));
	const vorlageName = (id: string | null) => data.vorlagen.find((v) => v.id === id)?.name ?? '–';
	const komma = (c: number) => (c / 100).toFixed(2).replace('.', ',');
</script>

<svelte:head>
	<title>Mahnungen</title>
</svelte:head>

<main class="kd-seite nf-seite">
	<h1>Zahlungserinnerung und Mahnungen</h1>
	<p class="kd-info">
		Nach der Fälligkeit (aus Lexware) legt das CRM je Rechnung die fällige Stufe genau einmal an: Erinnerung als Aufgabe mit fertiger Mail,
		Mahnungen zusätzlich in Lexware (mit PDF). Gesendet wird auf Klick in der Rechnung. Sobald gezahlt ist, stoppt alles; pausieren geht an der
		Rechnung, „kein Nachfassen“ beim Kunden. Verzugszinsen erscheinen nur als Hinweis. <InfoFenster id="mahnungen.seite" />
	</p>

	<Karte>
		{#snippet titel()}Mahnstufen{/snippet}
		{#if data.stufen.length === 0}
			<form method="POST" action="?/standard" use:enhance class="nf-standard">
				{#if fehlerIn('standard')}<p role="alert" class="kd-fehler">{fehlerIn('standard')}</p>{/if}
				<p class="kd-info">Vorschlag: Erinnerung nach 3 Tagen, 1. Mahnung nach 17, 2. Mahnung nach 45 (Zinshinweis, 40 € Pauschale bei Firmen), 3. Mahnung nach 60 Tagen nur nach Freigabe.</p>
				<button type="submit" class="kd-knopf hell" data-testid="mahn-standard">Vorschlag übernehmen</button>
			</form>
		{/if}
		<ol class="nf-stufen" aria-label="Mahnstufen">
			{#each data.stufen as s, i (s.id)}
				<li class:aus={!s.aktiv}>
					<details open={!!fehlerIn(`stufe-${s.id}`)}>
						<summary>
							<span class="nf-nr">{i + 1}</span>
							<span class="nf-tag">{s.tage} Tag{s.tage === 1 ? '' : 'e'} nach Fälligkeit</span>
							<span class="nf-was">
								{MAHNSTUFE_NAMEN[s.mahnstufe ?? 0]}{s.mail ? ` · Mail „${vorlageName(s.mailVorlageId)}“` : ''}
								<span class="kd-info">{s.gebuehrCent ? ` · Gebühr ${euro(s.gebuehrCent)}` : ''}{s.pauschaleFirma ? ' · 40 € Pauschale (Firmen)' : ''}{s.zinsenHinweis ? ' · Zinshinweis' : ''}{s.freigabe ? ' · nur nach Freigabe' : ''}{s.aktiv ? '' : ' · aus'}</span>
							</span>
						</summary>
						{@render formular(s)}
						<form method="POST" action="?/stufeLoeschen" use:enhance class="nf-loeschen">
							<input type="hidden" name="id" value={s.id} />
							<button type="submit" class="kd-knopf gefahr" use:rueckfrage={'Stufe wirklich löschen?'}>Stufe löschen</button>
						</form>
					</details>
				</li>
			{/each}
		</ol>
		<AddPanel label="Stufe hinzufügen" offen={!!fehlerIn('stufe-neu')}>
			{#snippet children(schliessen)}{@render formular(null, schliessen)}{/snippet}
		</AddPanel>
	</Karte>

	<Karte>
		{#snippet titel()}Basiszins und Zahlungsziel <InfoFenster id="mahnungen.konfig" />{/snippet}
		<form method="POST" action="?/konfig" use:enhance={ohneReset} class="kd-formular nf-raster">
			{#if fehlerIn('konfig')}<p role="alert" class="kd-fehler">{fehlerIn('konfig')}</p>{/if}
			<label>Basiszinssatz in % (Bundesbank)<input type="text" name="basiszins" value={wert('konfig', 'basiszins', komma(data.konfig.basiszinsHundertstel))} /></label>
			<label>Zahlungsziel neuer Rechnungen (Tage)<input type="number" name="zahlungszielTage" min="0" max="120" value={wert('konfig', 'zahlungszielTage', String(data.konfig.zahlungszielTage))} /></label>
			<div class="nf-knoepfe"><button type="submit" class="kd-knopf">Speichern</button></div>
		</form>
	</Karte>

	<Karte>
		{#snippet titel()}Texte{/snippet}
		<p class="kd-info">Die Mailtexte (Zweck „Zahlungserinnerung“ und „Mahnung“) stehen unter <a href="/einstellungen/mail-vorlagen">Einstellungen → E-Mail-Vorlagen</a>. Platzhalter z. B. {'{{rechnung.nummer}}'}, {'{{offen}}'}, {'{{zinsen}}'}, {'{{gebuehr}}'}.</p>
		{#if data.darfVorlagen}<a class="kd-knopf hell" href="/einstellungen/mail-vorlagen">E-Mail-Vorlagen öffnen</a>{/if}
	</Karte>
</main>

{#snippet formular(s: Stufe | null, schliessen?: () => void)}
	{@const b = s ? `stufe-${s.id}` : 'stufe-neu'}
	<form method="POST" action="?/stufe" use:enhance={ohneReset} class="kd-formular nf-formular">
		{#if fehlerIn(b)}<p role="alert" class="kd-fehler">{fehlerIn(b)}</p>{/if}
		{#if s}<input type="hidden" name="id" value={s.id} />{/if}
		<div class="nf-raster">
			<label>Stufe
				<Auswahl name="mahnstufe">
					{#each MAHNSTUFE_NAMEN as n, m (m)}<option value={String(m)} selected={wert(b, 'mahnstufe', String(s?.mahnstufe ?? 0)) === String(m)}>{n}</option>{/each}
				</Auswahl>
			</label>
			<label>Tage nach Fälligkeit<input type="number" name="tage" min="0" max="365" required value={wert(b, 'tage', s ? String(s.tage) : '')} /></label>
			<label>Mahngebühr (€)<input type="text" inputmode="decimal" name="gebuehr" value={wert(b, 'gebuehr', s ? komma(s.gebuehrCent) : '0,00')} /></label>
			<label>Aufgabe fällig nach (Tagen)<input type="number" name="faelligVersatz" min="0" max="60" value={wert(b, 'faelligVersatz', s ? String(s.faelligVersatz) : '0')} /></label>
		</div>
		<div class="nf-aktionen">
			<label class="kd-haken"><input type="checkbox" name="pauschaleFirma" checked={s?.pauschaleFirma ?? false} /><span>40 € Verzugspauschale bei Firmenkunden (§ 288 Abs. 5 BGB)</span></label>
			<label class="kd-haken"><input type="checkbox" name="zinsenHinweis" checked={s?.zinsenHinweis ?? false} /><span>Hinweis auf Verzugszinsen</span></label>
			<label class="kd-haken"><input type="checkbox" name="freigabe" checked={s?.freigabe ?? false} /><span>Nur nach Freigabe</span></label>
			<label class="kd-haken"><input type="checkbox" name="mail" checked={wert(b, 'mail', s ? (s.mail ? 'on' : '') : 'on') !== ''} /><span>Mail vorbereiten</span></label>
			<label>Mail-Vorlage
				<Auswahl name="mailVorlageId">
					<option value="">– keine –</option>
					{#each vorlagen as v (v.id)}<option value={v.id} selected={wert(b, 'mailVorlageId', s?.mailVorlageId ?? '') === v.id}>{v.name}{v.istStandard ? ' (Standard)' : ''}</option>{/each}
				</Auswahl>
			</label>
			<input type="hidden" name="todo" value="on" />
			<label>Aufgaben-Titel (optional, Platzhalter erlaubt)<input type="text" name="todoTitel" maxlength="300" value={wert(b, 'todoTitel', s?.todoTitel ?? '')} /></label>
		</div>
		<div class="nf-raster">
			<label>Zuständig
				<Auswahl name="zuweisung">
					{#each ZUWEISUNGEN as z (z)}<option value={z} selected={wert(b, 'zuweisung', s?.zuweisung ?? 'zustaendig') === z}>{ZUWEISUNG_NAMEN[z]}</option>{/each}
				</Auswahl>
			</label>
			<div class="ui-feld">Mitarbeiter (bei „fest“)
				<PersonWahl name="benutzerId" label="Mitarbeiter" leerText="Niemand" personen={data.mitarbeiter} wert={wert(b, 'benutzerId', s?.benutzerId ?? '')} />
			</div>
			<label>Rolle (bei „Rolle“)
				<Auswahl name="rolleId">
					<option value="">–</option>
					{#each data.rollen as r (r.id)}<option value={r.id} selected={wert(b, 'rolleId', s?.rolleId ?? '') === r.id}>{r.name}</option>{/each}
				</Auswahl>
			</label>
		</div>
		{#if s}
			<label class="kd-haken"><input type="checkbox" name="aktiv" value="true" checked={s.aktiv} /><span>Stufe aktiv</span></label>
			<input type="hidden" name="aktiv" value="false" />
		{/if}
		<div class="nf-knoepfe">
			{#if schliessen}<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>{/if}
			<button type="submit" class="kd-knopf">{s ? 'Speichern' : 'Stufe hinzufügen'}</button>
		</div>
	</form>
{/snippet}

<style>
	.nf-seite {
		max-width: none;
	}
	.nf-stufen {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
	}
	.nf-stufen:empty {
		display: none;
	}
	.nf-stufen > li + li {
		border-top: 1px solid var(--m365-rand);
	}
	.nf-stufen summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.6rem 0.75rem;
		cursor: pointer;
	}
	.nf-stufen li.aus {
		opacity: 0.6;
	}
	.nf-nr {
		font-weight: 700;
	}
	.nf-raster {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.75rem;
	}
	.nf-aktionen {
		display: grid;
		gap: 0.5rem;
	}
	.nf-knoepfe {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
	.nf-formular,
	.nf-loeschen {
		padding: 0 0.75rem 0.75rem;
	}
</style>
