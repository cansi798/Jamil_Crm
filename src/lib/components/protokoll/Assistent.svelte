<script lang="ts">
	/**
	 * Schritt-für-Schritt-Assistent eines Protokolls (Monteur, Handy zuerst) – auch die Live-Vorschau im Baukasten.
	 * Fortschritt oben, Felder des Schritts, unten „Zurück“ / „Weiter“. „Weiter“ ist gesperrt, solange sichtbare
	 * Pflichtfelder des Schritts fehlen (z. B. das Foto der Abdichtung); darunter steht, was noch offen ist. Im letzten
	 * Schritt „Abschließen“. `alles`: alle Schritte untereinander (abgeschlossenes Protokoll, nur lesen).
	 */
	import FeldEingabe from './FeldEingabe.svelte';
	import { auswerten, fehlendeFelder, feldProblem, type Antworten, type Schema } from '$lib/protokoll-formular';

	let {
		schema,
		antworten,
		schritt = $bindable(0),
		gesperrt = false,
		alles = false,
		onwert,
		fotoUrl,
		onfoto,
		onfotoLoeschen,
		onunterschrift,
		onabschliessen,
		abschliessenText = 'Abschließen'
	}: {
		schema: Schema;
		antworten: Antworten;
		schritt?: number;
		gesperrt?: boolean;
		alles?: boolean;
		onwert: (feldId: string, w: unknown) => void;
		fotoUrl: (id: string) => string | null;
		onfoto: (feldId: string, datei: File) => Promise<void>;
		onfotoLoeschen: (feldId: string, id: string) => Promise<void>;
		onunterschrift: (feldId: string, png: Uint8Array, name: string) => Promise<void>;
		onabschliessen?: () => Promise<void>;
		abschliessenText?: string;
	} = $props();

	const anzahl = $derived(schema.seiten.length);
	const aktuell = $derived(Math.min(Math.max(0, schritt), anzahl - 1));
	const zustand = $derived(auswerten(schema, antworten));
	const offenSchritt = $derived(fehlendeFelder(schema, antworten, aktuell));
	const offenGesamt = $derived(fehlendeFelder(schema, antworten));
	const letzter = $derived(aktuell === anzahl - 1);
	/** Bis zu welchem Schritt man springen darf: alle davor müssen frei sein. */
	const erreichbar = $derived.by(() => {
		let i = 0;
		while (i < anzahl - 1 && !offenGesamt.some((f) => f.seite === i)) i++;
		return i;
	});
	let schliesst = $state(false);
	let abschlussFehler = $state<string | null>(null);
	let zeigeFehler = $state(false);
	let oben: HTMLElement | undefined = $state();

	function gehe(n: number) {
		schritt = Math.min(Math.max(0, n), anzahl - 1);
		zeigeFehler = false;
		oben?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	function zeige(feldId: string) {
		zeigeFehler = true;
		document.querySelector<HTMLElement>(`[data-feld="${feldId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
	async function abschliessen() {
		if (!onabschliessen) return;
		schliesst = true;
		abschlussFehler = null;
		try {
			await onabschliessen();
		} catch (e) {
			abschlussFehler = e instanceof Error ? e.message : 'Abschließen fehlgeschlagen.';
		} finally {
			schliesst = false;
		}
	}
</script>

{#snippet seiteInhalt(si: number)}
	{#each schema.seiten[si].abschnitte as a (a.id)}
		<section class="pa-abschnitt">
			{#if a.titel}<h3>{a.titel}</h3>{/if}
			{#each a.felder as f (f.id)}
				{#if zustand.get(f.id)?.sichtbar}
					<FeldEingabe
						feld={f}
						wert={antworten[f.id]}
						pflicht={zustand.get(f.id)?.pflicht ?? false}
						problem={feldProblem(f, antworten[f.id], zustand.get(f.id)?.pflicht ?? false)}
						zeigeFehler={zeigeFehler && !gesperrt}
						{gesperrt}
						onwert={(w) => onwert(f.id, w)}
						{fotoUrl}
						onfoto={(d) => onfoto(f.id, d)}
						onfotoLoeschen={(id) => onfotoLoeschen(f.id, id)}
						onunterschrift={(png, name) => onunterschrift(f.id, png, name)}
					/>
				{/if}
			{/each}
		</section>
	{/each}
{/snippet}

<div class="pa" bind:this={oben}>
	{#if alles}
		{#each schema.seiten as s, si (s.id)}
			<div class="pa-seite">
				<h2 class="pa-titel">{s.titel}</h2>
				{@render seiteInhalt(si)}
			</div>
		{/each}
	{:else}
		<nav class="pa-fortschritt" aria-label="Fortschritt">
			<p class="pa-stand">Schritt {aktuell + 1} von {anzahl}</p>
			<ol>
				{#each schema.seiten as s, si (s.id)}
					<li class:fertig={si < aktuell} class:aktiv={si === aktuell}>
						<button type="button" disabled={si > erreichbar || si === aktuell} onclick={() => gehe(si)} aria-current={si === aktuell ? 'step' : undefined}>
							<span class="pa-punkt">{si + 1}</span><span class="pa-name">{s.titel}</span>
						</button>
					</li>
				{/each}
			</ol>
		</nav>

		<div class="pa-seite">
			<h2 class="pa-titel">{schema.seiten[aktuell].titel}</h2>
			{@render seiteInhalt(aktuell)}
		</div>

		<div class="pa-fuss">
			{#if (letzter ? offenGesamt : offenSchritt).length > 0}
				<div class="pa-offen" role="status" data-testid="noch-offen">
					<strong>Noch offen:</strong>
					{#each letzter ? offenGesamt : offenSchritt as o (o.feldId)}
						<button type="button" class="pa-offen-punkt" onclick={() => (o.seite === aktuell ? zeige(o.feldId) : gehe(o.seite))}>{o.label} – {o.grund}</button>
					{/each}
				</div>
			{/if}
			{#if abschlussFehler}<p class="kd-fehler" role="alert">{abschlussFehler}</p>{/if}
			<div class="pa-knoepfe">
				<button type="button" class="kd-knopf hell" disabled={aktuell === 0} onclick={() => gehe(aktuell - 1)}>Zurück</button>
				{#if !letzter}
					<button type="button" class="kd-knopf" disabled={offenSchritt.length > 0} onclick={() => gehe(aktuell + 1)} data-testid="weiter">Weiter</button>
				{:else if onabschliessen && !gesperrt}
					<button type="button" class="kd-knopf" disabled={offenGesamt.length > 0 || schliesst} onclick={abschliessen} data-testid="abschliessen">
						{schliesst ? 'Wird abgeschlossen …' : abschliessenText}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.pa {
		display: flex;
		flex-direction: column;
		gap: var(--ui-a4);
		scroll-margin-top: 4rem;
	}
	.pa-fortschritt ol {
		display: flex;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pa-fortschritt li {
		flex: 1 1 0;
		min-width: 0;
	}
	.pa-fortschritt li button {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ui-text-leise);
		font: inherit;
		font-size: var(--ui-schrift-xs);
		text-align: left;
		cursor: pointer;
	}
	.pa-fortschritt li button:disabled {
		cursor: default;
	}
	.pa-punkt {
		display: block;
		height: 6px;
		border-radius: 999px;
		background: var(--ui-grau-hell);
		font-size: 0;
	}
	.fertig .pa-punkt {
		background: var(--ui-gruen);
	}
	.aktiv .pa-punkt {
		background: var(--ui-akzent);
	}
	.aktiv button {
		color: var(--ui-text) !important;
		font-weight: 600;
	}
	.pa-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pa-stand {
		margin: 0 0 0.35rem;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
		font-weight: 600;
	}
	.pa-titel {
		margin: 0 0 var(--ui-a2);
		font-size: var(--ui-schrift-xl);
	}
	.pa-seite {
		display: flex;
		flex-direction: column;
		gap: var(--ui-a2);
	}
	.pa-abschnitt {
		display: flex;
		flex-direction: column;
		gap: var(--ui-a2);
		padding: var(--ui-a3) var(--ui-a4);
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
	}
	.pa-abschnitt h3 {
		margin: 0;
		font-size: var(--ui-schrift-m);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ui-text-leise);
	}
	.pa-fuss {
		position: sticky;
		bottom: 0;
		display: flex;
		flex-direction: column;
		gap: var(--ui-a2);
		padding: var(--ui-a3) 0 calc(var(--ui-a3) + env(safe-area-inset-bottom, 0px));
		background: linear-gradient(to bottom, transparent, var(--ui-hintergrund) 18%);
	}
	.pa-offen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.5rem;
		padding: var(--ui-a2) var(--ui-a3);
		border-radius: var(--ui-radius);
		background: var(--ui-orange-hell);
		font-size: var(--ui-schrift-s);
	}
	.pa-offen-punkt {
		padding: 0.2rem 0.6rem;
		border: 1px solid #f1c48a;
		border-radius: var(--ui-chip-radius);
		background: #fff;
		color: var(--ui-text);
		font: inherit;
		cursor: pointer;
	}
	.pa-knoepfe {
		display: grid;
		grid-template-columns: 1fr 2fr;
		gap: var(--ui-a2);
	}
	.pa-knoepfe :global(.kd-knopf) {
		min-height: 48px;
	}
</style>
