<script lang="ts">
	/**
	 * Baukasten einer Protokoll-Vorlage (Wunsch Jamil, msg 2649): Schritte (Seiten) → Abschnitte → Felder. Felder per
	 * Ziehen und Ablegen oder ↑/↓ sortieren, je Feld Typ, Beschriftung, Hinweis, Pflicht und eine Bedingung („nur
	 * zeigen, wenn …“ bzw. „Pflicht, wenn …“). Rechts die Live-Vorschau (auf dem Handy über „Vorschau“), in der man den
	 * Assistenten samt gesperrtem „Weiter“ ausprobieren kann. Speichern legt eine neue Version an.
	 */
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import '$lib/stil/kunden.css';
	import Assistent from '$lib/components/protokoll/Assistent.svelte';
	import FormularBaukasten from '$lib/components/protokoll/FormularBaukasten.svelte';
	import { pruefeSchema, SchemaFehler, type Antworten, type Schema } from '$lib/protokoll-formular';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const kopie = (v: PageData['vorlage']) => ({ name: v.name, beschreibung: v.beschreibung ?? '', schema: structuredClone(v.schema) as Schema });
	let entwurf = $state(untrack(() => kopie(data.vorlage)));
	let gespeichertStand = $state(untrack(() => JSON.stringify(kopie(data.vorlage))));
	const geaendert = $derived(JSON.stringify(entwurf) !== gespeichertStand);

	let meldung = $state<string | null>(null);
	let fehler = $state<string | null>(null);
	let speichert = $state(false);
	let vorschauMobil = $state(false);

	// Vorschau: eigene Antworten, Fotos/Unterschrift nur als Platzhalter
	let vorschauAntworten = $state<Antworten>({});
	let vorschauSchritt = $state(0);
	let platzhalter = 0;

	const pruefung = $derived.by(() => {
		try {
			pruefeSchema($state.snapshot(entwurf.schema));
			return null;
		} catch (e) {
			return e instanceof SchemaFehler ? e.message : 'Ungültige Vorlage';
		}
	});

	// ---------- Speichern ----------
	async function speichern() {
		fehler = null;
		meldung = null;
		if (pruefung) {
			fehler = pruefung;
			return;
		}
		speichert = true;
		try {
			const res = await fetch(`/api/protokoll-vorlagen/${data.vorlage.id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: entwurf.name, beschreibung: entwurf.beschreibung, schema: $state.snapshot(entwurf.schema) })
			});
			const b = await res.json();
			if (!res.ok) {
				fehler = b.fehler ?? 'Speichern fehlgeschlagen.';
				return;
			}
			gespeichertStand = JSON.stringify(kopie(b));
			entwurf = kopie(b);
			meldung = b.version === data.vorlage.version ? 'Keine Änderungen.' : `Gespeichert als Version ${b.version}.`;
			if (b.id !== data.vorlage.id) await goto(`/einstellungen/protokoll-vorlagen/${b.id}`, { replaceState: true, noScroll: true, keepFocus: true });
		} catch {
			fehler = 'Keine Verbindung – bitte erneut versuchen.';
		} finally {
			speichert = false;
		}
	}

	beforeNavigate((n) => {
		if (geaendert && n.type !== 'goto' && !confirm('Ungespeicherte Änderungen verwerfen?')) n.cancel();
	});
</script>

<svelte:head>
	<title>{entwurf.name} – Protokoll-Vorlage</title>
</svelte:head>
<svelte:window onbeforeunload={(e) => geaendert && e.preventDefault()} />

<main class="kd-seite breit pb-seite">
	<a href="/einstellungen/protokoll-vorlagen" class="kd-zurueck">← Protokoll-Vorlagen</a>
	<header class="pb-kopf">
		<div class="pb-namen">
			<label>Name der Vorlage<input type="text" bind:value={entwurf.name} maxlength="200" data-testid="vorlage-name" /></label>
			<label>Beschreibung (optional)<input type="text" bind:value={entwurf.beschreibung} maxlength="1000" /></label>
			<p class="kd-info">
				Version {data.vorlage.version}{data.vorlage.archiviert ? ' · archiviert' : ''}{data.vorlage.protokolle > 0
					? ` · ${data.vorlage.protokolle} ausgefüllte Protokolle behalten ihre Version`
					: ''}
			</p>
		</div>
	</header>

	<button type="button" class="kd-knopf hell pb-vorschau-knopf" onclick={() => (vorschauMobil = !vorschauMobil)}>
		{vorschauMobil ? 'Zurück zum Bearbeiten' : 'Vorschau'}
	</button>

	<div class="pb-raster" class:zeige-vorschau={vorschauMobil}>
		<FormularBaukasten bind:schema={entwurf.schema} />

		<aside class="pb-vorschau" aria-label="Live-Vorschau">
			<div class="pb-handy">
				<p class="pb-vorschau-titel">Vorschau – so sieht es der Monteur</p>
				{#if pruefung}
					<p class="kd-fehler">{pruefung}</p>
				{:else}
					<Assistent
						schema={entwurf.schema}
						antworten={vorschauAntworten}
						bind:schritt={vorschauSchritt}
						onwert={(id, w) => (w === undefined || w === '' || (Array.isArray(w) && w.length === 0) ? delete vorschauAntworten[id] : (vorschauAntworten[id] = w))}
						fotoUrl={() => null}
						onfoto={async (id) => {
							vorschauAntworten[id] = [...((vorschauAntworten[id] as string[]) ?? []), `vorschau-${++platzhalter}`];
						}}
						onfotoLoeschen={async (id, d) => {
							vorschauAntworten[id] = ((vorschauAntworten[id] as string[]) ?? []).filter((x) => x !== d);
						}}
						onunterschrift={async (id, _png, name) => {
							vorschauAntworten[id] = { dateiId: 'vorschau', name, zeit: new Date().toISOString() };
						}}
						onabschliessen={async () => {
							alert('Vorschau: Hier würde das Protokoll abgeschlossen.');
						}}
					/>
					<button type="button" class="knopf-subtil klein" onclick={() => ((vorschauAntworten = {}), (vorschauSchritt = 0))}>Vorschau zurücksetzen</button>
				{/if}
			</div>
		</aside>
	</div>

	<div class="pb-leiste" role="region" aria-label="Speichern">
		{#if fehler}<p class="kd-fehler" role="alert">{fehler}</p>{:else if meldung}<p class="pb-ok" role="status">{meldung}</p>{:else if geaendert}<p class="kd-info">Ungespeicherte Änderungen</p>{/if}
		<button type="button" class="kd-knopf" disabled={speichert || !geaendert} onclick={speichern} data-testid="vorlage-speichern">
			{speichert ? 'Speichert …' : 'Speichern (neue Version)'}
		</button>
	</div>
</main>

<style>
	.pb-namen {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: var(--ui-a2) var(--ui-a3);
		width: 100%;
	}
	.pb-namen label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: var(--ui-schrift-s);
		font-weight: 600;
		color: var(--ui-text-leise);
	}
	.pb-namen p {
		grid-column: 1 / -1;
		margin: 0;
	}
	.pb-raster {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(20rem, 1fr);
		gap: var(--ui-a5);
		align-items: start;
		margin-top: var(--ui-a4);
	}
	.pb-vorschau {
		position: sticky;
		top: var(--ui-a4);
	}
	.pb-handy {
		max-height: calc(100vh - 8rem);
		overflow: auto;
		padding: var(--ui-a4);
		border: 8px solid #1f2430;
		border-radius: 28px;
		background: var(--ui-hintergrund);
		box-shadow: var(--ui-schatten-hoch);
	}
	.pb-vorschau-titel {
		margin: 0 0 var(--ui-a3);
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ui-text-leise);
	}
	.pb-vorschau-knopf {
		display: none;
	}
	.pb-leiste {
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--ui-a3);
		margin-top: var(--ui-a4);
		padding: var(--ui-a3) 0 calc(var(--ui-a3) + env(safe-area-inset-bottom, 0px));
		background: linear-gradient(to bottom, transparent, var(--ui-hintergrund) 25%);
	}
	.pb-leiste p {
		margin: 0;
	}
	.pb-ok {
		color: #17603f;
		font-weight: 600;
	}
	@media (max-width: 960px) {
		.pb-raster {
			grid-template-columns: minmax(0, 1fr);
		}
		.pb-vorschau {
			display: none;
			position: static;
		}
		.pb-raster.zeige-vorschau .pb-vorschau {
			display: block;
		}
		.pb-raster.zeige-vorschau :global(.pb-editor) {
			display: none;
		}
		.pb-vorschau-knopf {
			display: inline-flex;
			margin-top: var(--ui-a2);
		}
		.pb-handy {
			max-height: none;
			border-width: 0;
			border-radius: var(--ui-radius-karte);
			padding: var(--ui-a2);
		}
		.pb-namen {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
