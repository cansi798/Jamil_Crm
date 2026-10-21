<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	/**
	 * Ein Feld eines Protokolls im Assistenten (und in der Live-Vorschau des Baukastens): passende Eingabe je Feldtyp,
	 * große Tippziele für das Handy (Ja/Nein und Auswahl als Chips, Checkliste als Zeilen, Foto mit Kamera, Unterschrift
	 * mit dem Finger). Werte gehen über `onwert` nach oben; Fotos/Unterschrift über eigene Rückrufe (Server).
	 */
	import { untrack } from 'svelte';
	import Unterschrift from '$lib/components/Unterschrift.svelte';
	import { einheitVon, istBerechnet, istZahlTyp, minFotos, wertText, type Feld, type UnterschriftWert } from '$lib/protokoll-formular';

	let {
		feld,
		wert,
		pflicht,
		problem,
		zeigeFehler = false,
		gesperrt = false,
		onwert,
		fotoUrl,
		onfoto,
		onfotoLoeschen,
		onunterschrift
	}: {
		feld: Feld;
		wert: unknown;
		pflicht: boolean;
		problem: string | null;
		zeigeFehler?: boolean;
		gesperrt?: boolean;
		onwert: (w: unknown) => void;
		fotoUrl: (id: string) => string | null;
		onfoto: (datei: File) => Promise<void>;
		onfotoLoeschen: (id: string) => Promise<void>;
		onunterschrift: (png: Uint8Array, name: string) => Promise<void>;
	} = $props();

	const fid = $derived(`pf-${feld.id}`);
	let laedt = $state(0);
	let fotoFehler = $state<string | null>(null);
	let unterschreiben = $state(false);
	let name = $state('');
	let namenFehler = $state<string | null>(null);

	const liste = $derived(Array.isArray(wert) ? (wert as string[]) : []);
	const umschalten = (o: string) => onwert(liste.includes(o) ? liste.filter((x) => x !== o) : [...liste, o]);
	// Zahlen als Text mit Komma (deutsche Tastatur, „1,8“); ungültige Eingabe zählt als leer
	let zahlText = $state(untrack(() => (typeof wert === 'number' ? String(wert).replace('.', ',') : '')));
	const zahlUngueltig = $derived(zahlText.trim() !== '' && !Number.isFinite(Number(zahlText.trim().replace(',', '.'))));
	const zahl = (e: Event) => {
		zahlText = (e.currentTarget as HTMLInputElement).value;
		const t = zahlText.trim().replace(',', '.');
		const n = Number(t);
		onwert(t === '' || !Number.isFinite(n) ? undefined : n);
	};
	const unterschrift = $derived(wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as UnterschriftWert) : null);

	async function fotosGewaehlt(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const dateien = [...(input.files ?? [])];
		input.value = '';
		fotoFehler = null;
		for (const d of dateien) {
			laedt++;
			try {
				await onfoto(d);
			} catch (err) {
				fotoFehler = err instanceof Error ? err.message : 'Foto konnte nicht gespeichert werden.';
			} finally {
				laedt--;
			}
		}
	}

	async function unterschrieben(png: Uint8Array) {
		if (name.trim() === '') {
			namenFehler = 'Bitte zuerst den Namen eintragen.';
			return;
		}
		namenFehler = null;
		try {
			await onunterschrift(png, name.trim());
			unterschreiben = false;
		} catch (err) {
			namenFehler = err instanceof Error ? err.message : 'Unterschrift konnte nicht gespeichert werden.';
		}
	}
	const zeit = (iso?: string) => (iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : '');
</script>

{#if feld.typ === 'hinweis'}
	<div class="pf-hinweis">
		<strong>{feld.label}</strong>
		{#if feld.hilfe}<p>{feld.hilfe}</p>{/if}
	</div>
{:else}
	<div class="pf-feld" class:pf-problem={zeigeFehler && !!problem} data-feld={feld.id}>
		<div class="pf-kopf">
			<label for={fid} id={`${fid}-label`}>{feld.label}{#if pflicht}<span class="pf-pflicht" aria-label="Pflicht">*</span>{/if}</label>
			{#if feld.typ === 'foto' && pflicht}<span class="pf-zusatz">mind. {minFotos(feld)}</span>{/if}
		</div>
		{#if feld.hilfe}<p class="pf-hilfe">{feld.hilfe}</p>{/if}

		{#if feld.typ === 'text'}
			<input id={fid} type="text" value={(wert as string) ?? ''} disabled={gesperrt} maxlength="5000" oninput={(e) => onwert(e.currentTarget.value)} />
		{:else if feld.typ === 'textlang'}
			<textarea id={fid} rows="4" disabled={gesperrt} maxlength="20000" value={(wert as string) ?? ''} oninput={(e) => onwert(e.currentTarget.value)}></textarea>
		{:else if istBerechnet(feld)}
			<!-- Aufmaß (msg 2842): berechnet aus der Formel, nicht eintippbar -->
			<output id={fid} class="pf-berechnet" aria-live="polite">{typeof wert === 'number' ? wertText(feld, wert) : '– (fehlende Angaben)'}</output>
		{:else if istZahlTyp(feld.typ)}
			<div class="pf-zahl">
				<input id={fid} type="text" inputmode="decimal" autocomplete="off" disabled={gesperrt} value={zahlText} oninput={zahl} />
				{#if einheitVon(feld)}<span class="pf-einheit">{einheitVon(feld)}</span>{/if}
			</div>
			{#if zahlUngueltig}<p class="pf-meldung">Bitte eine Zahl eingeben (z. B. 1,8).</p>{/if}
		{:else if feld.typ === 'janein'}
			<div class="pf-chips" role="radiogroup" aria-labelledby={`${fid}-label`} id={fid}>
				{#each [true, false] as w (w)}
					<button
						type="button"
						class="pf-chip"
						class:an={wert === w}
						role="radio"
						aria-checked={wert === w}
						disabled={gesperrt}
						onclick={() => onwert(wert === w ? undefined : w)}>{w ? 'Ja' : 'Nein'}</button
					>
				{/each}
			</div>
		{:else if feld.typ === 'auswahl'}
			<div class="pf-chips" role="radiogroup" aria-labelledby={`${fid}-label`} id={fid}>
				{#each feld.optionen ?? [] as o (o)}
					<button type="button" class="pf-chip" class:an={wert === o} role="radio" aria-checked={wert === o} disabled={gesperrt} onclick={() => onwert(wert === o ? undefined : o)}
						>{o}</button
					>
				{/each}
			</div>
		{:else if feld.typ === 'mehrfach'}
			<div class="pf-chips" role="group" aria-labelledby={`${fid}-label`} id={fid}>
				{#each feld.optionen ?? [] as o (o)}
					<button type="button" class="pf-chip" class:an={liste.includes(o)} aria-pressed={liste.includes(o)} disabled={gesperrt} onclick={() => umschalten(o)}>{o}</button>
				{/each}
			</div>
		{:else if feld.typ === 'checkliste'}
			<ul class="pf-checkliste" id={fid} aria-labelledby={`${fid}-label`}>
				{#each feld.optionen ?? [] as o (o)}
					<li>
						<label class:an={liste.includes(o)}>
							<input type="checkbox" checked={liste.includes(o)} disabled={gesperrt} onchange={() => umschalten(o)} />
							<span>{o}</span>
						</label>
					</li>
				{/each}
			</ul>
		{:else if feld.typ === 'datum'}
			<input id={fid} type="date" disabled={gesperrt} value={(wert as string) ?? ''} oninput={(e) => onwert(e.currentTarget.value || undefined)} />
		{:else if feld.typ === 'uhrzeit'}
			<input id={fid} type="time" disabled={gesperrt} value={(wert as string) ?? ''} oninput={(e) => onwert(e.currentTarget.value || undefined)} />
		{:else if feld.typ === 'foto'}
			<div class="pf-fotos" id={fid}>
				{#each liste as id (id)}
					<figure class="pf-foto">
						{#if fotoUrl(id)}<img src={fotoUrl(id)} alt={`${feld.label}`} loading="lazy" />{:else}<span class="pf-foto-platz">Foto</span>{/if}
						{#if !gesperrt}
							<button use:rueckfrage={{ frage: 'Foto wirklich entfernen?', ja: 'Entfernen' }} type="button" class="pf-foto-weg" aria-label="Foto entfernen" onclick={() => onfotoLoeschen(id)}>×</button>
						{/if}
					</figure>
				{/each}
				{#if laedt > 0}<div class="pf-foto pf-foto-laedt" role="status">wird hochgeladen …</div>{/if}
			</div>
			{#if !gesperrt}
				<div class="pf-foto-knoepfe">
					<label class="kd-knopf pf-datei">
						<input type="file" accept="image/*" capture="environment" multiple onchange={fotosGewaehlt} data-testid={`foto-${feld.id}`} />
						<svg viewBox="0 0 24 24" aria-hidden="true" class="knopf-symbol"><path d="M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
						Foto aufnehmen
					</label>
					<label class="kd-knopf hell pf-datei">
						<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onchange={fotosGewaehlt} />
						Aus Galerie
					</label>
				</div>
			{/if}
			{#if fotoFehler}<p class="kd-fehler" role="alert">{fotoFehler}</p>{/if}
		{:else if feld.typ === 'unterschrift'}
			{#if unterschrift && !unterschreiben}
				<div class="pf-unterschrift" id={fid}>
					{#if fotoUrl(unterschrift.dateiId)}<img src={fotoUrl(unterschrift.dateiId)} alt={`Unterschrift ${unterschrift.name ?? ''}`} />{/if}
					<span class="kd-info">{unterschrift.name}{unterschrift.zeit ? ` · ${zeit(unterschrift.zeit)}` : ''}</span>
					{#if !gesperrt}<button type="button" class="knopf-subtil klein" onclick={() => ((unterschreiben = true), (name = unterschrift?.name ?? ''))}>Neu unterschreiben</button>{/if}
				</div>
			{:else if !gesperrt}
				<div class="pf-unterschreiben" id={fid}>
					<label class="pf-name">
						Name {feld.wer === 'monteur' ? 'des Monteurs' : 'des Kunden'}
						<input type="text" bind:value={name} maxlength="200" autocomplete="name" data-testid={`name-${feld.id}`} />
					</label>
					<p class="pf-hilfe">Mit dem Finger im Feld unterschreiben, dann „Fertig“.</p>
					<Unterschrift onunterschrift={unterschrieben} />
					{#if namenFehler}<p class="kd-fehler" role="alert">{namenFehler}</p>{/if}
				</div>
			{:else}
				<p class="kd-info">– nicht unterschrieben –</p>
			{/if}
		{/if}

		{#if zeigeFehler && problem}<p class="pf-meldung" role="alert">{problem}</p>{/if}
	</div>
{/if}

<style>
	.pf-berechnet {
		display: block;
		padding: 0.5rem 0.75rem;
		border-radius: var(--ui-radius);
		background: var(--ui-grau-hell);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.pf-hinweis {
		padding: var(--ui-a3) var(--ui-a4);
		border-left: 3px solid var(--ui-akzent);
		border-radius: var(--ui-radius);
		background: var(--ui-akzent-zart);
	}
	.pf-hinweis p {
		margin: 0.25rem 0 0;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-m);
		line-height: 1.5;
	}
	.pf-feld {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: var(--ui-a2) 0;
	}
	.pf-feld.pf-problem :global(input:not([type='checkbox'])),
	.pf-feld.pf-problem textarea {
		border-color: var(--ui-gefahr);
	}
	.pf-kopf {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--ui-a2);
	}
	.pf-kopf label {
		font-weight: 600;
		font-size: var(--ui-schrift-l);
		color: var(--ui-text);
	}
	.pf-pflicht {
		margin-left: 0.2rem;
		color: var(--ui-gefahr);
	}
	.pf-zusatz {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.pf-hilfe {
		margin: 0;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
		line-height: 1.5;
	}
	.pf-meldung {
		margin: 0;
		color: var(--ui-gefahr);
		font-size: var(--ui-schrift-s);
		font-weight: 600;
	}
	.pf-zahl {
		display: flex;
		align-items: center;
		gap: var(--ui-a2);
		max-width: 16rem;
	}
	.pf-einheit {
		color: var(--ui-text-leise);
		font-weight: 600;
		white-space: nowrap;
	}
	.pf-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
	}
	.pf-chip {
		min-height: 44px;
		min-width: 5rem;
		padding: 0.4rem 1rem;
		border: 1px solid var(--ui-rand-stark);
		border-radius: var(--ui-chip-radius);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.pf-chip:hover:not(:disabled) {
		border-color: var(--ui-akzent);
	}
	.pf-chip.an {
		border-color: var(--ui-akzent);
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
	}
	.pf-chip:disabled {
		cursor: default;
		opacity: 0.8;
	}
	.pf-checkliste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--ui-a1);
	}
	.pf-checkliste label {
		display: flex;
		align-items: center;
		gap: var(--ui-a3);
		min-height: 48px;
		padding: 0.5rem var(--ui-a3);
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		cursor: pointer;
	}
	.pf-checkliste label.an {
		border-color: var(--ui-gruen);
		background: var(--ui-gruen-hell);
	}
	.pf-checkliste input {
		width: 1.4rem !important;
		height: 1.4rem !important;
		min-width: 1.4rem !important;
		min-height: 1.4rem !important;
		accent-color: var(--ui-gruen) !important;
	}
	.pf-fotos {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
		gap: var(--ui-a2);
	}
	.pf-fotos:empty {
		display: none;
	}
	.pf-foto {
		position: relative;
		margin: 0;
		aspect-ratio: 4 / 3;
		border-radius: var(--ui-radius);
		overflow: hidden;
		background: var(--ui-grau-hell);
		display: grid;
		place-items: center;
	}
	.pf-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.pf-foto-platz,
	.pf-foto-laedt {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		text-align: center;
	}
	.pf-foto-weg {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
	}
	.pf-foto-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
	}
	.pf-datei {
		position: relative;
		overflow: hidden;
	}
	.pf-datei input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
		min-height: 0 !important;
	}
	.pf-unterschrift {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--ui-a2);
	}
	.pf-unterschrift img {
		max-width: 18rem;
		max-height: 8rem;
		border-bottom: 1px solid var(--ui-rand-stark);
		background: #fff;
	}
	.pf-unterschreiben {
		display: flex;
		flex-direction: column;
		gap: var(--ui-a2);
	}
	.pf-name {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: var(--ui-schrift-m);
		max-width: 24rem;
	}
</style>
