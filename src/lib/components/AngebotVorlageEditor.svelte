<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import KatalogSuche, { type KatalogTreffer } from '$lib/components/KatalogSuche.svelte';
	import PositionenEditor, { neuerSchluessel, type EditorZeile } from '$lib/components/PositionenEditor.svelte';
	import { centAlsEingabe, mengeText } from '$lib/geld';

	type Position = {
		katalogPositionId: string | null;
		bezeichnung: string;
		beschreibung: string | null;
		menge: number;
		einheit: string;
		einzelpreisCent: number | null;
		katalogPreisCent: number | null;
	};
	type Vorlage = { id: string; name: string; einleitung: string | null; schluss: string | null; positionen: Position[] };

	/**
	 * Editor einer Angebots-Vorlage (Neu und Bearbeiten): Name, Einleitung, Positionen (aus dem Katalog oder frei),
	 * Schlusstext. Katalogpositionen haben keinen eigenen Preis (`katalogPreisFest`) – beim Einfügen ins Angebot gilt der
	 * dann aktuelle Katalogpreis. Gespeichert wird über die API (`POST`/`PUT /api/angebot-vorlagen`).
	 */
	let { vorlage = null }: { vorlage?: Vorlage | null } = $props();

	// Anfangszustand einmal aus den Seitendaten (die Seite baut den Editor je Vorlage neu: {#key})
	const anfang = untrack(() => vorlage);
	let name = $state(anfang?.name ?? '');
	let einleitung = $state(anfang?.einleitung ?? '');
	let schluss = $state(anfang?.schluss ?? '');
	let zeilen = $state<EditorZeile[]>(
		(anfang?.positionen ?? []).map((p) => ({
			schluessel: neuerSchluessel(),
			katalogPositionId: p.katalogPositionId,
			bezeichnung: p.bezeichnung,
			beschreibung: p.beschreibung ?? '',
			menge: mengeText(p.menge).replaceAll('.', ''),
			einheit: p.einheit,
			einzelpreis: centAlsEingabe((p.katalogPositionId ? p.katalogPreisCent : p.einzelpreisCent) ?? 0)
		}))
	);
	let katalogOffen = $state(false);
	let zuletztHinzu = $state<string | null>(null);
	let fehler = $state<string | null>(null);
	let meldung = $state<string | null>(null);
	let arbeitet = $state(false);

	function ausKatalog(t: KatalogTreffer) {
		zeilen = [
			...zeilen,
			{
				schluessel: neuerSchluessel(),
				katalogPositionId: t.id,
				bezeichnung: t.bezeichnung,
				beschreibung: t.beschreibung ?? '',
				menge: '1',
				einheit: t.einheit,
				einzelpreis: centAlsEingabe(t.einzelpreisCent ?? 0)
			}
		];
		zuletztHinzu = t.bezeichnung;
	}

	function freiePosition() {
		zeilen = [
			...zeilen,
			{ schluessel: neuerSchluessel(), katalogPositionId: null, bezeichnung: '', beschreibung: '', menge: '1', einheit: 'Stk', einzelpreis: '' }
		];
	}

	async function api(methode: string, url: string, koerper?: unknown) {
		const r = await fetch(url, {
			method: methode,
			headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
			body: koerper === undefined ? undefined : JSON.stringify(koerper)
		});
		const text = await r.text();
		const json = text ? JSON.parse(text) : null;
		if (!r.ok) throw new Error(json?.fehler ?? 'Das hat nicht geklappt. Bitte erneut versuchen.');
		return json;
	}

	async function speichern() {
		if (arbeitet) return;
		arbeitet = true;
		fehler = null;
		meldung = null;
		try {
			const koerper = {
				name,
				einleitung,
				schluss,
				positionen: zeilen.map((z) => ({
					katalogPositionId: z.katalogPositionId,
					bezeichnung: z.bezeichnung,
					beschreibung: z.beschreibung,
					menge: z.menge,
					einheit: z.einheit,
					// Katalogpositionen: Preis kommt beim Einfügen aus dem Katalog
					...(z.katalogPositionId ? {} : { einzelpreis: z.einzelpreis })
				}))
			};
			if (vorlage) {
				await api('PUT', `/api/angebot-vorlagen/${vorlage.id}`, koerper);
				meldung = 'Gespeichert.';
			} else {
				const neu = await api('POST', '/api/angebot-vorlagen', koerper);
				await goto(`/angebot-vorlagen/${neu.id}?gespeichert=1`);
			}
		} catch (e) {
			fehler = (e as Error).message;
		} finally {
			arbeitet = false;
		}
	}
</script>

<section aria-label="Angaben" class="kd-formular">
	<label>Name * <input type="text" bind:value={name} maxlength="100" required placeholder="z. B. Bad komplett" /></label>
	<label>Einleitung (optional) <textarea bind:value={einleitung} maxlength="2000" rows="2"></textarea></label>
</section>

<h2>Positionen</h2>
<PositionenEditor bind:zeilen katalogPreisFest />

<div class="av-hinzu">
	<button type="button" class="kd-knopf hell" onclick={() => (katalogOffen = !katalogOffen)} aria-expanded={katalogOffen}>+ Aus Katalog</button>
	<button type="button" class="kd-knopf hell" onclick={freiePosition}>+ Freie Position</button>
</div>
{#if katalogOffen}
	<section class="an-katalog" aria-label="Aus Katalog wählen">
		<h3>Aus Katalog wählen</h3>
		{#if zuletztHinzu}<p role="status" class="kd-info">Hinzugefügt: {zuletztHinzu}</p>{/if}
		<KatalogSuche onwaehle={ausKatalog} onschliessen={() => (katalogOffen = false)} />
	</section>
{/if}

<label class="av-schluss">Schlusstext (optional) <textarea bind:value={schluss} maxlength="2000" rows="2"></textarea></label>

<p class="kd-info">
	Positionen aus dem Katalog bekommen beim Einfügen ins Angebot immer den dann aktuellen Katalogpreis. Freie Positionen behalten
	ihren Preis. Im Angebot ist danach alles änderbar.
</p>

{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
{#if meldung}<p role="status" class="kt-hinweis ok">{meldung}</p>{/if}

<div class="av-aktionen">
	<button type="button" class="kd-knopf" onclick={speichern} disabled={arbeitet}>{vorlage ? 'Speichern' : 'Vorlage anlegen'}</button>
	<a href="/angebot-vorlagen" class="kd-knopf hell">Zurück</a>
</div>

<style>
	.av-hinzu {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0.75rem 0;
	}
	.av-schluss {
		display: grid;
		gap: 0.25rem;
		margin: 0.75rem 0;
	}
	.av-aktionen {
		display: grid;
		gap: 0.5rem;
		margin: 1rem 0 2rem;
	}
	.an-katalog {
		padding: 0.75rem;
		border: 1px solid var(--primaer);
		border-radius: 0.5rem;
		background: var(--primaer-hell);
	}
	.an-katalog h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	@media (min-width: 700px) {
		.av-hinzu,
		.av-aktionen {
			display: flex;
			flex-wrap: wrap;
		}
	}
</style>
