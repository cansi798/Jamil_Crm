<script module lang="ts">
	export type KatalogTreffer = {
		id: string;
		gewerk: string | null;
		nummer: string | null;
		bezeichnung: string;
		beschreibung: string | null;
		einheit: string;
		einzelpreisCent?: number;
		materialCent?: number;
		arbeitMinuten?: number | null;
	};
</script>

<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { euro } from '$lib/geld';
	import { GEWERKE, GEWERK_NAMEN } from '$lib/katalog-werte';

	/** Auswahl aus dem Leistungskatalog (aktive Positionen) mit Suche und Gewerk-Filter – lädt über `/api/katalog`. */

	let { onwaehle, onschliessen }: { onwaehle: (p: KatalogTreffer) => void; onschliessen?: () => void } = $props();

	let suche = $state('');
	let gewerk = $state('');
	let treffer = $state<KatalogTreffer[]>([]);
	let laedt = $state(false);
	let fehler = $state<string | null>(null);
	let zaehler = 0;

	async function lade() {
		const nr = ++zaehler;
		laedt = true;
		fehler = null;
		try {
			const p = new URLSearchParams({ nurAktive: '1' });
			if (suche.trim()) p.set('suche', suche.trim());
			if (gewerk) p.set('gewerk', gewerk);
			const r = await fetch(`/api/katalog?${p}`);
			const daten = await r.json();
			if (nr !== zaehler) return;
			if (!r.ok) throw new Error(daten?.fehler ?? 'Katalog konnte nicht geladen werden.');
			treffer = daten;
		} catch (e) {
			if (nr === zaehler) fehler = (e as Error).message;
		} finally {
			if (nr === zaehler) laedt = false;
		}
	}

	let zeitgeber: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		void suche;
		void gewerk;
		clearTimeout(zeitgeber);
		zeitgeber = setTimeout(lade, 200);
		return () => clearTimeout(zeitgeber);
	});
</script>

<div class="ks">
	<div class="ks-kopf">
		<input type="search" bind:value={suche} placeholder="Katalog durchsuchen" aria-label="Katalog durchsuchen" autocomplete="off" />
		<Auswahl bind:value={gewerk} aria-label="Gewerk">
			<option value="">Alle Gewerke</option>
			{#each GEWERKE as g (g)}
				<option value={g}>{GEWERK_NAMEN[g]}</option>
			{/each}
		</Auswahl>
	</div>
	{#if fehler}
		<p role="alert" class="kd-fehler">{fehler}</p>
	{/if}
	<ul class="ks-liste" aria-busy={laedt}>
		{#each treffer as t (t.id)}
			<li>
				<button type="button" onclick={() => onwaehle(t)}>
					<span class="ks-name">{t.nummer ? `${t.nummer} · ` : ''}{t.bezeichnung}</span>
					<span class="kd-info">
						{t.einheit}{t.gewerk ? ` · ${GEWERK_NAMEN[t.gewerk as keyof typeof GEWERK_NAMEN] ?? ''}` : ''}
						{#if t.einzelpreisCent !== undefined}
							· {t.einzelpreisCent === 0 ? 'Preis fehlt' : euro(t.einzelpreisCent)}
						{/if}
					</span>
				</button>
			</li>
		{:else}
			<li class="kd-leer">{laedt ? 'Lädt …' : 'Keine passenden Positionen.'}</li>
		{/each}
	</ul>
	{#if onschliessen}
		<button type="button" class="kd-knopf hell" onclick={onschliessen}>Schließen</button>
	{/if}
</div>

<style>
	.ks {
		display: grid;
		gap: 0.5rem;
	}
	.ks-kopf {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
	}
	@media (min-width: 40rem) {
		.ks-kopf {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		}
	}
	.ks-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
		max-height: 22rem;
		overflow-y: auto;
	}
	.ks-liste button {
		display: grid;
		gap: 0.1rem;
		width: 100%;
		min-height: 2.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		background: #fff;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	.ks-liste button:hover {
		border-color: var(--primaer);
	}
	.ks-name {
		font-weight: 600;
	}
</style>
