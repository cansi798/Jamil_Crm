<script lang="ts">
	/**
	 * Baukasten einer Protokoll-Vorlage (Wunsch Jamil, msg 2649): Schritte (Seiten) → Abschnitte → Felder. Felder per
	 * Ziehen und Ablegen oder ↑/↓ sortieren, je Feld Typ, Beschriftung, Hinweis, Pflicht und eine Bedingung („nur
	 * zeigen, wenn …“ bzw. „Pflicht, wenn …“). Rechts die Live-Vorschau (auf dem Handy über „Vorschau“), in der man den
	 * Assistenten samt gesperrtem „Weiter“ ausprobieren kann. Speichern legt eine neue Version an.
	 * Kopf wie jede Vorlagen-Detailseite (Jamil msg 3084): Zurück, Überzeile, Name; oben rechts Duplizieren,
	 * Archivieren/Wiederherstellen und „Vorlage löschen“ mit Rückfrage (msgs 3043, 3091).
	 * Gemeinsam für /einstellungen/protokoll-vorlagen/<id> und /einstellungen/aufmass-vorlagen/<id>.
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto } from '$app/navigation';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import Knopf from '$lib/components/ui/Knopf.svelte';
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
	import { FORMULAR_VORLAGEN, formularVorlagenPfad, type FormularVorlagenArt } from '$lib/formular-vorlagen';
	import Assistent from '$lib/components/protokoll/Assistent.svelte';
	import { AUFMASS_TYPEN, FELD_TYPEN } from '$lib/protokoll-formular';
	// Protokolle ohne Aufmaß-Felder; Aufmaß-Vorlagen mit allen (msg 2842)
	const PROTOKOLL_TYPEN = FELD_TYPEN.filter((t) => !(AUFMASS_TYPEN as readonly string[]).includes(t));
	import FormularBaukasten from '$lib/components/protokoll/FormularBaukasten.svelte';
	import { pruefeSchema, SchemaFehler, type Antworten, type Schema } from '$lib/protokoll-formular';
	type Vorlage = { id: string; name: string; beschreibung: string | null; schema: unknown; version: number; archiviert: boolean; protokolle: number; art: FormularVorlagenArt };
	let {
		data,
		form
	}: {
		data: { vorlage: Vorlage; katalog: { id: string; bezeichnung: string; einheit: string }[] | null };
		form: { fehler?: string; loeschFehler?: boolean } | null;
	} = $props();
	const art = $derived(FORMULAR_VORLAGEN[data.vorlage.art]);
	let loeschenOffen = $state(false);
	const loeschFehler = $derived(form?.loeschFehler ? (form.fehler ?? null) : null);
	const meta = $derived(
		[
			`Version ${data.vorlage.version}`,
			data.vorlage.archiviert ? 'archiviert' : null,
			data.vorlage.protokolle > 0 ? `${data.vorlage.protokolle} ausgefüllte ${data.vorlage.protokolle === 1 ? art.ding : art.mehrere} behalten ihre Version` : null
		]
			.filter(Boolean)
			.join(' · ')
	);

	const kopie = (v: Vorlage) => ({ name: v.name, beschreibung: v.beschreibung ?? '', schema: structuredClone(v.schema) as Schema });
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
			if (b.id !== data.vorlage.id) await goto(formularVorlagenPfad(data.vorlage.art, b.id), { replaceState: true, noScroll: true, keepFocus: true });
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
	<title>{entwurf.name} – {art.einzeln}</title>
</svelte:head>
<svelte:window onbeforeunload={(e) => geaendert && e.preventDefault()} />

<main class="kd-seite breit pb-seite">
	<SeitenKopf ueberzeile={art.einzeln} titel={entwurf.name || 'Ohne Namen'} {meta} zurueck={{ href: formularVorlagenPfad(data.vorlage.art), text: art.titel }}>
		{#snippet aktionen()}
			<form method="POST" action="?/duplizieren" use:enhance>
				<Knopf type="submit" art="sekundaer" symbol="kopieren">Duplizieren</Knopf>
			</form>
			{#if data.vorlage.archiviert}
				<form method="POST" action="?/wiederherstellen" use:enhance>
					<Knopf type="submit" art="sekundaer" symbol="wiederherstellen">Wiederherstellen</Knopf>
				</form>
			{:else}
				<form method="POST" action="?/archivieren" use:enhance>
					<Knopf type="submit" art="sekundaer" symbol="archiv">Archivieren</Knopf>
				</form>
			{/if}
			<LoeschenKnopf ding="Vorlage" bind:offen={loeschenOffen} />
		{/snippet}
	</SeitenKopf>
	<LoeschenPanel ding="Vorlage" bind:offen={loeschenOffen} fehler={loeschFehler}>
		Die Vorlage „{data.vorlage.name}“ wird mit allen Versionen endgültig gelöscht. Das geht nur, solange sie in keinem {art.ding}
		benutzt wird – sonst bitte archivieren.
	</LoeschenPanel>
	{#if form?.fehler && !loeschFehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}

	<Abschnitt titel="Vorlage">
		<div class="pb-namen">
			<label>Name der Vorlage<input type="text" bind:value={entwurf.name} maxlength="200" data-testid="vorlage-name" /></label>
			<label>Beschreibung (optional)<input type="text" bind:value={entwurf.beschreibung} maxlength="1000" /></label>
		</div>
	</Abschnitt>

	<button type="button" class="kd-knopf hell pb-vorschau-knopf" onclick={() => (vorschauMobil = !vorschauMobil)}>
		{vorschauMobil ? 'Zurück zum Bearbeiten' : 'Vorschau'}
	</button>

	<div class="pb-raster" class:zeige-vorschau={vorschauMobil}>
		<FormularBaukasten bind:schema={entwurf.schema} typen={data.vorlage.art === 'aufmass' ? FELD_TYPEN : PROTOKOLL_TYPEN} katalog={data.katalog} hinweisVorgabe={data.vorlage.art === 'aufmass' ? 'Hinweis zum Messen' : 'Text für den Monteur'} />

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
