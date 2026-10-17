<script lang="ts">
	/**
	 * Datei-Upload-Komponente: Datei-Auswahl (Bilder/PDFs), Hochladen mit Fortschritt, Liste der Dateien mit Löschen.
	 */

	let {
		auftragId,
		dateien = $bindable([])
	}: {
		auftragId: string;
		dateien: Array<{ id: string; name: string; typ: string; beschreibung: string | null }>;
	} = $props();

	let laedt = $state(false);
	let fehler = $state<string | null>(null);

	async function hochladen(e: Event) {
		const input = e.target as HTMLInputElement;
		const datei = input.files?.[0];
		if (!datei) return;
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
			input.value = '';
		} catch (e) {
			fehler = e instanceof Error ? e.message : 'Upload fehlgeschlagen';
		} finally {
			laedt = false;
		}
	}

	async function loeschen(id: string) {
		const res = await fetch(`/api/dateien/${id}`, { method: 'DELETE' });
		if (res.ok) {
			dateien = dateien.filter((d) => d.id !== id);
		}
	}
</script>

<div class="datei-upload">
	<label class="upload-button">
		{laedt ? 'Wird hochgeladen…' : 'Datei auswählen'}
		<input
			type="file"
			accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx"
			onchange={hochladen}
			disabled={laedt}
			style="display: none;"
		/>
	</label>
	{#if fehler}
		<p class="fehler">{fehler}</p>
	{/if}
	{#if dateien.length > 0}
		<ul class="datei-liste">
			{#each dateien as datei (datei.id)}
				<li>
					<span>{datei.name}</span>
					<button type="button" onclick={() => loeschen(datei.id)}>Löschen</button>
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
	.upload-button {
		display: inline-block;
		padding: 0.5rem 1rem;
		background: var(--farbe-primaer, #05346b);
		color: #fff;
		border-radius: 4px;
		cursor: pointer;
		text-align: center;
	}
	.upload-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.fehler {
		color: #c00;
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
	li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.25rem 0.5rem;
		border: 1px solid #eee;
		border-radius: 4px;
	}
	li button {
		padding: 0.25rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
	}
</style>