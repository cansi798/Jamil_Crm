<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { querySchluessel } from '$lib/ansichten';

	/**
	 * Gespeicherte Ansichten (Jamil msgs 2830, 2921) – Knopf „Ansichten“ in der Filterleiste: aktuelle Filter unter einem
	 * Namen speichern, mit einem Klick öffnen, umbenennen, als Standard (öffnet die Seite beim ersten Besuch je Sitzung
	 * damit), fürs Team teilen (Chef/Büro), mit den aktuellen Filtern überschreiben, löschen.
	 * Enthält bewusst kein <form>: Die Filterleiste ist selbst ein GET-Formular.
	 */
	type Ansicht = { id: string; name: string; query: string; istStandard: boolean; geteilt: boolean; eigene: boolean; von: string | null };
	let { seite }: { seite: string } = $props();

	let offen = $state(false);
	let liste = $state<Ansicht[]>([]);
	let fehler = $state<string | null>(null);
	let neuName = $state('');
	let neuStandard = $state(false);
	let neuTeilen = $state(false);
	let speichernOffen = $state(false);
	let umbenennen = $state<string | null>(null);
	let umbenennenName = $state('');
	let knopf = $state<HTMLButtonElement>();
	let feld = $state<HTMLInputElement>();
	const darfTeilen = $derived(!!(page.data as { ansichtenTeilen?: boolean }).ansichtenTeilen);

	// Aktuelle Filter (ohne leere Werte und ohne „heute“-Parameter), sortiert verglichen
	const jetzt = $derived(querySchluessel(seite, page.url.search));
	const aktiv = $derived(liste.find((a) => querySchluessel(seite, a.query) === jetzt) ?? null);

	async function laden() {
		try {
			const r = await fetch(`/api/ansichten?seite=${encodeURIComponent(seite)}`);
			if (r.ok) liste = await r.json();
		} catch {
			// ohne Netz: Liste bleibt leer
		}
	}

	onMount(async () => {
		await laden();
		// Standard-Ansicht beim ersten Besuch der Seite je Sitzung (nur ohne eigene Filter in der Adresse)
		const std = liste.find((a) => a.istStandard);
		const schluessel = `crm-ansicht-std:${seite}`;
		let schonGesehen = true;
		try {
			schonGesehen = sessionStorage.getItem(schluessel) === '1';
			sessionStorage.setItem(schluessel, '1');
		} catch {
			schonGesehen = true;
		}
		if (std && !schonGesehen && page.url.search === '' && std.query) await goto(`?${std.query}`, { replaceState: true, keepFocus: true, noScroll: true });
	});

	async function senden(methode: 'POST' | 'PATCH' | 'DELETE', pfad: string, daten?: Record<string, unknown>): Promise<boolean> {
		fehler = null;
		try {
			const r = await fetch(pfad, { method: methode, headers: daten ? { 'content-type': 'application/json' } : {}, body: daten ? JSON.stringify(daten) : undefined });
			if (!r.ok) {
				fehler = ((await r.json().catch(() => null)) as { fehler?: string } | null)?.fehler ?? 'Das hat nicht geklappt.';
				return false;
			}
			await laden();
			return true;
		} catch {
			fehler = 'Keine Verbindung.';
			return false;
		}
	}

	async function speichern() {
		if (!neuName.trim()) {
			fehler = 'Bitte einen Namen eingeben.';
			return;
		}
		if (await senden('POST', '/api/ansichten', { seite, name: neuName, query: page.url.search, istStandard: neuStandard, geteilt: neuTeilen })) {
			neuName = '';
			neuStandard = false;
			neuTeilen = false;
			speichernOffen = false;
		}
	}
	const oeffne = (a: Ansicht) => {
		offen = false;
		goto(a.query ? `?${a.query}` : page.url.pathname, { keepFocus: true, noScroll: true });
	};
	// Enter in den Feldern darf das GET-Formular der Filterleiste nicht absenden
	const enter = (fn: () => void) => (e: KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			fn();
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			offen = false;
			knopf?.focus();
		}
	};
	async function speichernZeigen() {
		speichernOffen = true;
		await tick();
		feld?.focus();
	}
</script>

<div class="ga">
	<button type="button" class="ga-knopf" bind:this={knopf} aria-expanded={offen} aria-haspopup="true" onclick={() => (offen = !offen)}>
		<span aria-hidden="true">★</span> {aktiv ? aktiv.name : 'Ansichten'}{liste.length ? ` (${liste.length})` : ''}
	</button>
	{#if offen}
		<div class="ga-menue" role="dialog" aria-label="Gespeicherte Ansichten">
			<!-- Jamil msg 3063: „Komplettansicht“ (alle, ohne Filter) ist immer wählbar und nicht löschbar -->
			<ul class="ga-liste">
				<li class:aktiv={jetzt === ''}>
					<button type="button" class="ga-name" onclick={() => { offen = false; goto(page.url.pathname, { keepFocus: true, noScroll: true }); }}>Komplettansicht <small class="ga-marke">alle</small></button>
				</li>
			</ul>
			{#if liste.length === 0}
				<p class="ga-leer">Noch keine gespeicherten Ansichten. Filter wählen und hier speichern.</p>
			{:else}
				<ul class="ga-liste">
					{#each liste as a (a.id)}
						<li class:aktiv={aktiv?.id === a.id}>
							{#if umbenennen === a.id}
								<div class="ga-zeile">
									<input aria-label="Neuer Name" bind:value={umbenennenName} maxlength="80" onkeydown={enter(async () => { if (await senden('PATCH', `/api/ansichten/${a.id}`, { name: umbenennenName })) umbenennen = null; })} />
									<button type="button" class="ga-klein" onclick={async () => { if (await senden('PATCH', `/api/ansichten/${a.id}`, { name: umbenennenName })) umbenennen = null; }}>OK</button>
								</div>
							{:else}
								<button type="button" class="ga-name" onclick={() => oeffne(a)}>
									{a.name}
									{#if a.istStandard}<small class="ga-marke">Standard</small>{/if}
									{#if a.geteilt}<small class="ga-marke">{a.eigene ? 'Team' : `von ${a.von ?? '–'}`}</small>{/if}
								</button>
								{#if a.eigene}
									<!-- Jamil msg 3062: Löschen direkt sichtbar (im ⋯-Menü wurde es bei kurzer Liste abgeschnitten) -->
									<button type="button" class="ga-weg" aria-label={`Ansicht „${a.name}“ löschen`} title="Ansicht löschen" onclick={() => { if (confirm(`Ansicht „${a.name}“ löschen?`)) senden('DELETE', `/api/ansichten/${a.id}`); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5" /></svg></button>
									<details class="ga-mehr">
										<summary aria-label={`Ansicht „${a.name}“ bearbeiten`}>⋯</summary>
										<div class="ga-aktionen">
											<button type="button" onclick={() => senden('PATCH', `/api/ansichten/${a.id}`, { istStandard: !a.istStandard })}>{a.istStandard ? 'Kein Standard mehr' : 'Als Standard'}</button>
											{#if darfTeilen}<button type="button" onclick={() => senden('PATCH', `/api/ansichten/${a.id}`, { geteilt: !a.geteilt })}>{a.geteilt ? 'Nicht mehr teilen' : 'Fürs Team teilen'}</button>{/if}
											<button type="button" onclick={() => senden('PATCH', `/api/ansichten/${a.id}`, { query: page.url.search })}>Mit aktuellen Filtern überschreiben</button>
											<button type="button" onclick={() => { umbenennen = a.id; umbenennenName = a.name; }}>Umbenennen</button>
											<button type="button" class="ga-gefahr" onclick={() => { if (confirm(`Ansicht „${a.name}“ löschen?`)) senden('DELETE', `/api/ansichten/${a.id}`); }}>Löschen</button>
										</div>
									</details>
								{:else if darfTeilen && a.geteilt}
									<button type="button" class="ga-weg" aria-label={`Team-Ansicht „${a.name}“ für alle löschen`} title="Für alle löschen" onclick={() => { if (confirm(`Team-Ansicht „${a.name}“ von ${a.von ?? '–'} für alle löschen?`)) senden('DELETE', `/api/ansichten/${a.id}`); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5" /></svg></button>
									<details class="ga-mehr">
										<summary aria-label={`Ansicht „${a.name}“ bearbeiten`}>⋯</summary>
										<div class="ga-aktionen">
											<button type="button" class="ga-gefahr" onclick={() => { if (confirm(`Team-Ansicht „${a.name}“ von ${a.von ?? '–'} für alle löschen?`)) senden('DELETE', `/api/ansichten/${a.id}`); }}>Für alle löschen</button>
										</div>
									</details>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if speichernOffen}
				<div class="ga-neu">
					<input bind:this={feld} bind:value={neuName} maxlength="80" placeholder="Name, z. B. „Nur Hornbach, diese Woche“" aria-label="Name der Ansicht" onkeydown={enter(speichern)} />
					<label class="ga-haken"><input type="checkbox" bind:checked={neuStandard} /> Als Standard</label>
					{#if darfTeilen}<label class="ga-haken"><input type="checkbox" bind:checked={neuTeilen} /> Fürs Team teilen</label>{/if}
					<div class="ga-zeile">
						<button type="button" class="kd-knopf klein" onclick={speichern}>Speichern</button>
						<button type="button" class="kd-knopf hell klein" onclick={() => (speichernOffen = false)}>Abbrechen</button>
					</div>
				</div>
			{:else}
				<button type="button" class="ga-speichern" onclick={speichernZeigen}>+ Aktuelle Filter speichern</button>
			{/if}
			{#if fehler}<p class="ga-fehler" role="alert">{fehler}</p>{/if}
		</div>
	{/if}
</div>

<style>
	.ga {
		position: relative;
		display: inline-block;
	}
	.ga-knopf {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: var(--ui-knopf-hoehe, 44px);
		padding: 0 0.85rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-knopf-radius, var(--ui-radius));
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ga-knopf[aria-expanded='true'] {
		border-color: var(--ui-akzent);
	}
	.ga-menue {
		position: absolute;
		right: 0;
		top: calc(100% + 0.35rem);
		z-index: 30;
		width: min(22rem, calc(100vw - 2rem));
		max-height: 70vh;
		overflow: auto;
		display: grid;
		gap: 0.5rem;
		padding: 0.6rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte, var(--ui-radius));
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten-hoch);
	}
	@media (max-width: 40rem) {
		.ga-menue {
			position: fixed;
			left: 1rem;
			right: 1rem;
			top: auto;
			bottom: 5rem;
			width: auto;
		}
	}
	.ga-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.15rem;
	}
	.ga-liste li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-radius: var(--ui-radius);
	}
	.ga-liste li.aktiv {
		background: var(--ui-akzent-zart);
	}
	.ga-name {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		padding: 0 0.5rem;
		border: none;
		background: none;
		color: var(--ui-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.ga-marke {
		font-size: var(--ui-schrift-xs);
		padding: 0 0.4rem;
		border-radius: var(--ui-chip-radius);
		background: var(--ui-grau-hell);
		color: var(--ui-text-leise);
	}
	.ga-mehr {
		position: relative;
	}
	.ga-weg {
		display: grid;
		place-items: center;
		flex: none;
		width: 44px;
		height: 44px;
		border: none;
		border-radius: var(--ui-radius);
		background: none;
		color: var(--ui-text-leise);
		cursor: pointer;
	}
	.ga-weg:hover {
		background: color-mix(in srgb, var(--ui-rot) 10%, white);
		color: var(--ui-rot);
	}
	.ga-weg svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ga-mehr summary {
		list-style: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		cursor: pointer;
		border-radius: var(--ui-radius);
	}
	.ga-mehr summary::-webkit-details-marker {
		display: none;
	}
	.ga-aktionen {
		position: absolute;
		right: 0;
		z-index: 31;
		display: grid;
		min-width: 15rem;
		padding: 0.3rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten-hoch);
	}
	.ga-aktionen button,
	.ga-speichern {
		min-height: 44px;
		padding: 0 0.6rem;
		border: none;
		background: none;
		color: var(--ui-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		border-radius: var(--ui-radius);
	}
	.ga-aktionen button:hover,
	.ga-speichern:hover,
	.ga-name:hover {
		background: var(--ui-grau-hell);
	}
	.ga-speichern {
		color: var(--ui-akzent-text);
		font-weight: 600;
	}
	.ga-gefahr {
		color: var(--ui-gefahr) !important;
	}
	.ga-neu {
		display: grid;
		gap: 0.4rem;
	}
	.ga-neu input:not([type='checkbox']),
	.ga-zeile input {
		min-height: var(--ui-feld-hoehe);
		min-width: 0;
		width: 100%;
	}
	.ga-zeile {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		width: 100%;
	}
	.ga-haken {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2rem;
		font-size: var(--ui-schrift-s);
	}
	.ga-klein {
		min-height: var(--ui-feld-hoehe);
	}
	.ga-leer,
	.ga-fehler {
		margin: 0;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.ga-fehler {
		color: var(--ui-gefahr);
	}
</style>
