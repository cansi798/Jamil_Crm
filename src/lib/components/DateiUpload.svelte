<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	/**
	 * Datei-Upload-Komponente: Datei per Ziehen ablegen oder auswählen (Bilder/PDFs),
	 * Hochladen mit Fortschritt, Liste der Dateien mit Löschen.
	 */

	import type { Snippet } from 'svelte';

	let {
		auftragId,
		dateien = $bindable([]),
		zusatz
	}: {
		auftragId: string;
		dateien: Array<{ id: string; name: string; typ: string; beschreibung: string | null }>;
		/** Zusatz je Datei vor „Löschen“ (z. B. Schalter „im Kundenportal anzeigen“) */
		zusatz?: Snippet<[{ id: string; name: string }]>;
	} = $props();

	let laedt = $state(false);
	let fehler = $state<string | null>(null);
	let dropAktiv = $state(false);
	let dateiEingabe = $state<HTMLInputElement | null>(null);

	async function hochladenDatei(datei: File) {
		laedt = true;
		fehler = null;
		try {
			const form = new FormData();
			form.append('auftragId', auftragId);
			form.append('datei', datei);
			const res = await fetch('/api/dateien', { method: 'POST', body: form });
			if (!res.ok) {
				const body = await res.json();
				throw new Error(body.fehler || 'Upload fehlgeschlagen');
			}
			const erg = await res.json();
			dateien = [erg, ...dateien];
			if (dateiEingabe) dateiEingabe.value = '';
		} catch (e) {
			fehler = e instanceof Error ? e.message : 'Upload fehlgeschlagen';
		} finally {
			laedt = false;
		}
	}

	async function hochladen(e: Event) {
		const input = e.target as HTMLInputElement;
		const datei = input.files?.[0];
		if (!datei) return;
		await hochladenDatei(datei);
	}

	function drop(e: DragEvent) {
		e.preventDefault();
		dropAktiv = false;
		const datei = e.dataTransfer?.files?.[0];
		if (datei) hochladenDatei(datei);
	}

	async function loeschen(id: string) {
		const res = await fetch(`/api/dateien/${id}`, { method: 'DELETE' });
		if (res.ok) {
			dateien = dateien.filter((d) => d.id !== id);
		}
	}
</script>

<div class="datei-upload">
	<div
		class="drop-zone"
		class:drop-aktiv={dropAktiv}
		role="button"
		tabindex="0"
		aria-label="Datei hochladen: hierher ziehen oder klicken zum Auswählen"
		ondragover={(e) => {
			e.preventDefault();
			dropAktiv = true;
		}}
		ondragleave={() => (dropAktiv = false)}
		ondrop={drop}
		onclick={() => dateiEingabe?.click()}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				dateiEingabe?.click();
			}
		}}
	>
		<p class="drop-titel">{laedt ? 'Wird hochgeladen…' : 'Datei hierher ziehen'}</p>
		<p class="drop-hinweis">oder klicken zum Auswählen · JPEG, PNG, WebP, PDF, DOCX, XLSX</p>
		<input
			type="file"
			accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx"
			bind:this={dateiEingabe}
			onchange={hochladen}
			disabled={laedt}
			style="display: none;"
		/>
	</div>
	{#if fehler}
		<p class="fehler">{fehler}</p>
	{/if}
	{#if dateien.length > 0}
		<ul class="datei-liste">
			{#each dateien as datei (datei.id)}
				<li>
					<span>{datei.name}</span>
					{#if zusatz}{@render zusatz(datei)}{/if}
					<button use:rueckfrage={'Datei wirklich löschen?'} type="button" class="knopf-gefahr" onclick={() => loeschen(datei.id)}>Löschen</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.datei-upload {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.drop-zone {
		display: grid;
		place-items: center;
		gap: 0.25rem;
		min-height: 8rem;
		padding: 1.25rem;
		border: 2px dashed var(--m365-rand);
		border-radius: var(--m365-radius-gross);
		background: var(--m365-hintergrund);
		color: var(--m365-text);
		text-align: center;
		cursor: pointer;
		transition: border-color 150ms, background 150ms;
	}
	.drop-zone:hover,
	.drop-aktiv {
		border-color: var(--m365-primaer);
		background: var(--m365-primaer-hell);
	}
	.drop-titel {
		margin: 0;
		font-weight: 600;
	}
	.drop-hinweis {
		margin: 0;
		color: var(--m365-text-leise);
		font-size: 0.875rem;
	}
	.fehler {
		color: var(--m365-fehler);
		margin: 0;
	}
	.datei-liste {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.datei-liste li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
</style>
