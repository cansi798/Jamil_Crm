<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { STUFEN, STUFE_NAMEN } from '$lib/stufen';
	import Segmente from './ui/Segmente.svelte';
	import KundeWahl, { type KundeTreffer } from './ui/KundeWahl.svelte';
	import PersonWahl from './ui/PersonWahl.svelte';
	import Auswahl from './ui/Auswahl.svelte';
	import FormFuss from './ui/FormFuss.svelte';
	import Avatar from './ui/Avatar.svelte';

	type Kunde = { id: string; name: string; adresse?: string | null };
	type Objekt = { id: string; bezeichnung: string; adresse: string };
	type Vorlage = { id: string; name: string };
	type Todo = { titel: string; beschreibung: string; lautstaerke: string; schmutz: string };

	/**
	 * Formular für Aufträge (Neu und Bearbeiten). Kunde: vorbelegt (z. B. aus `?kunde=` oder beim Bearbeiten) oder über
	 * die Kundensuche (`/api/kunden`, braucht „Kunden ansehen“) wählbar; danach stehen die Objekte dieses Kunden zur Wahl.
	 * Gesendet wird nur die Kunden-ID – geprüft wird alles serverseitig.
	 */
	let {
		aktion,
		werte,
		kunde = null,
		objekte = [],
		kundenSuche = true,
		vorlagen = [],
		todosZusaetzlich = false,
		mitarbeiter = [],
		zustaendige = [],
		anlage = null,
		quellen = [],
		quellePflicht = false,
		fehler = null,
		knopf,
		abbrechen
	}: {
		aktion: string;
		werte: Record<string, string>;
		kunde?: Kunde | null;
		objekte?: Objekt[];
		kundenSuche?: boolean;
		vorlagen?: Vorlage[];
		/** Bearbeiten: Aufgaben aus der Vorlage kommen zu den vorhandenen Aufgaben des Auftrags dazu. */
		todosZusaetzlich?: boolean;
		/** Aktive Mitarbeiter zur Auswahl „Zuständig“ und die schon gewählten IDs. */
		mitarbeiter?: { id: string; name: string }[];
		zustaendige?: string[];
		/** Neuer Auftrag von einer Anlage aus („+ Auftrag zu dieser Anlage“) – gilt, solange ihr Objekt gewählt ist. */
		anlage?: { id: string; bezeichnung: string; typName: string; objektId: string } | null;
		/** Auftragsquellen (Wunsch Jamil msg 2593); bei neuen Aufträgen Pflicht. */
		quellen?: { id: string; name: string; aktiv: boolean }[];
		quellePflicht?: boolean;
		fehler?: string | null;
		knopf: string;
		abbrechen: string;
	} = $props();

	let gewaehlt = $state<{ kunde: Kunde; objekte: Objekt[] } | null>(null);
	let zustaendigWahl = $state<string[]>(untrack(() => [...zustaendige]));
	// Kunde aus der Kundendatenbank, Einmal-Kunde (nur am Auftrag) oder ohne Kunde (Phase 3)
	let kundeArtWahl = $state<string | null>(null);
	const kundeArt = $derived(kundeArtWahl ?? (werte.kundeArt || 'kunde'));
	let aendern = $state(false);
	let objektWahl = $state<string | null>(null);
	let todos = $state<Todo[]>([]);
	let vorlageWahl = $state<string>('');
	let todosGeladen = $state(false);

	const aktKunde = $derived(gewaehlt ? gewaehlt.kunde : kunde);
	const aktObjekte = $derived(gewaehlt ? gewaehlt.objekte : objekte);
	const sucheOffen = $derived(aendern || !aktKunde);
	const objektWert = $derived(objektWahl ?? werte.objektId ?? '');

	const adresse = (o: { strasse?: string | null; plz?: string | null; ort?: string | null }) =>
		[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');

	async function waehle(k: Kunde | KundeTreffer) {
		let liste: Objekt[] = [];
		try {
			const r = await fetch(`/api/kunden/${k.id}/objekte`);
			if (r.ok) {
				const roh: { id: string; bezeichnung: string; strasse: string | null; plz: string | null; ort: string | null }[] =
					await r.json();
				liste = roh.map((o) => ({ id: o.id, bezeichnung: o.bezeichnung, adresse: adresse(o) }));
			}
		} catch {
			// ohne Objekte weiter – der Auftrag braucht keins
		}
		gewaehlt = { kunde: { id: k.id, name: k.name, adresse: k.adresse ?? null }, objekte: liste };
		// Hat der Kunde genau ein Objekt, ist es vorausgewählt (änderbar)
		objektWahl = liste.length === 1 ? liste[0].id : '';
		aendern = false;
	}

	async function ladeVorlage() {
		if (!vorlageWahl) {
			todos = [];
			todosGeladen = false;
			return;
		}
		try {
			const r = await fetch(`/api/auftrag-vorlagen/${vorlageWahl}`);
			if (r.ok) {
				const daten = await r.json();
				todos = daten.todos.map((t: { titel: string; beschreibung: string | null; lautstaerke: number | null; schmutz: number | null }) => ({
					titel: t.titel,
					beschreibung: t.beschreibung ?? '',
					lautstaerke: t.lautstaerke ? String(t.lautstaerke) : '',
					schmutz: t.schmutz ? String(t.schmutz) : ''
				}));
				todosGeladen = true;
			}
		} catch {
			// Fehler ignorieren – Todos bleiben leer
		}
	}

	function todoHinzufuegen() {
		todos = [...todos, { titel: '', beschreibung: '', lautstaerke: '', schmutz: '' }];
	}

	function todoEntfernen(index: number) {
		todos = todos.filter((_, i) => i !== index);
	}

	function todoVerschieben(index: number, richtung: -1 | 1) {
		const ziel = index + richtung;
		if (ziel < 0 || ziel >= todos.length) return;
		const neu = [...todos];
		[neu[index], neu[ziel]] = [neu[ziel], neu[index]];
		todos = neu;
	}
</script>

<form method="POST" action={aktion} use:enhance class="kd-formular af-formular">
	{#if fehler}
		<p role="alert" class="kd-fehler">{fehler}</p>
	{/if}

	<div class="af-block">
		<span class="af-label" id="af-kunde-label">Kunde *</span>
		<Segmente
			name="kundeArt"
			label="Kunde"
			voll
			wert={kundeArt}
			optionen={[
				{ wert: 'kunde', text: 'Bestandskunde' },
				{ wert: 'einmal', text: 'Einmal-Kunde' },
				{ wert: 'ohne', text: 'Ohne Kunde' }
			]}
			onchange={(w) => (kundeArtWahl = w)}
		/>

		{#if kundeArt === 'einmal'}
			<div class="af-einmal">
				<p class="kd-info">Wird nur an diesem Auftrag gespeichert, nicht in der Kundendatenbank. Später übernehmbar.</p>
				<div class="kd-zwei">
					<label>Name * <input type="text" name="einmalName" maxlength="200" required value={werte.einmalName ?? ''} /></label>
					<label>Telefon <input type="tel" name="einmalTelefon" maxlength="50" value={werte.einmalTelefon ?? ''} /></label>
				</div>
				<div class="kd-zwei">
					<label>E-Mail <input type="email" name="einmalEmail" maxlength="200" value={werte.einmalEmail ?? ''} /></label>
					<label>Straße <input type="text" name="einmalStrasse" maxlength="200" value={werte.einmalStrasse ?? ''} /></label>
				</div>
				<div class="kd-zwei">
					<label>PLZ <input type="text" name="einmalPlz" maxlength="20" value={werte.einmalPlz ?? ''} /></label>
					<label>Ort <input type="text" name="einmalOrt" maxlength="200" value={werte.einmalOrt ?? ''} /></label>
				</div>
			</div>
		{:else if kundeArt === 'ohne'}
			<p class="kd-info">Der Auftrag bekommt keinen Kunden – z. B. für interne Arbeiten. Ein Kunde lässt sich später eintragen.</p>
		{:else}
			<input type="hidden" name="kundeId" value={aktKunde?.id ?? ''} />
			{#if aktKunde && !sucheOffen}
				<div class="af-gewaehlt">
					<Avatar name={aktKunde.name} groesse={36} />
					<span class="af-gewaehlt-text">
						<strong>{aktKunde.name}</strong>
						{#if aktKunde.adresse}<span class="kd-info">{aktKunde.adresse}</span>{/if}
					</span>
					{#if kundenSuche}
						<button type="button" class="kd-knopf hell" onclick={() => (aendern = true)}>Anderen Kunden wählen</button>
					{/if}
				</div>
			{:else if kundenSuche}
				<KundeWahl onwaehle={(k) => void waehle(k)} autofocus={aendern} />
				{#if aendern && aktKunde}
					<button type="button" class="knopf-ghost af-zurueck" onclick={() => (aendern = false)}>Bei {aktKunde.name} bleiben</button>
				{/if}
			{:else}
				<p class="kd-info">Bitte den Auftrag über die Seite des Kunden anlegen („+ Auftrag“).</p>
			{/if}
		{/if}
	</div>

	{#if aktKunde && kundeArt === 'kunde'}
		<label>
			Objekt (Baustelle)
			<Auswahl name="objektId" onchange={(e) => (objektWahl = e.currentTarget.value)}>
				<option value="" selected={objektWert === ''}>
					Kundenadresse (Standard){aktKunde.adresse ? ` – ${aktKunde.adresse}` : ''}
				</option>
				{#each aktObjekte as o (o.id)}
					<option value={o.id} selected={o.id === objektWert}>
						{o.bezeichnung}{o.adresse ? ` (${o.adresse})` : ''}
					</option>
				{/each}
			</Auswahl>
		</label>
		{#if anlage && objektWert === anlage.objektId}
			<input type="hidden" name="anlageId" value={anlage.id} />
			<p class="kd-info">Anlage: <strong>{anlage.bezeichnung}</strong> ({anlage.typName})</p>
		{/if}
	{/if}

	{#if mitarbeiter.length > 0}
		<div class="af-feld">
			<span class="af-label">Zuständige Mitarbeiter</span>
			<input type="hidden" name="zustaendigeGesendet" value="1" />
			<PersonWahl name="zustaendige" mehrfach personen={mitarbeiter} bind:werte={zustaendigWahl} label="Zuständige Mitarbeiter" leerText="Mitarbeiter wählen" />
		</div>
	{/if}

	{#if quellen.length > 0}
		<label>
			Auftragsquelle{quellePflicht ? ' *' : ''} <span class="kd-info">(woher kam der Auftrag?)</span>
			<Auswahl name="quelleId" required={quellePflicht}>
				<option value="" selected={!werte.quelleId}>{quellePflicht ? 'Bitte wählen' : 'Keine'}</option>
				{#each quellen.filter((q) => q.aktiv || q.id === werte.quelleId) as q (q.id)}
					<option value={q.id} selected={werte.quelleId === q.id}>{q.name}</option>
				{/each}
			</Auswahl>
		</label>
	{/if}
	<label>
		Titel *
		<input type="text" name="titel" maxlength="200" required value={werte.titel ?? ''} placeholder="z. B. Badsanierung" />
	</label>

	<label>
		Beschreibung
		<textarea name="beschreibung" maxlength="4000" rows="5">{werte.beschreibung ?? ''}</textarea>
	</label>

	{#if vorlagen.length > 0}
		<label class="af-voll">
			{todosZusaetzlich ? 'Aufgaben aus Vorlage hinzufügen' : 'Aufgaben-Vorlage'}
			<Auswahl bind:value={vorlageWahl} onchange={ladeVorlage} aria-label="Aufgaben-Vorlage">
				<option value="">Ohne Vorlage</option>
				{#each vorlagen as v (v.id)}
					<option value={v.id}>{v.name}</option>
				{/each}
			</Auswahl>
		</label>
		{#if todosGeladen && todos.length > 0}
			<p class="kd-info">
				{todos.length} Aufgaben aus der Vorlage werden angelegt{todosZusaetzlich ? ' – zusätzlich zu den vorhandenen Aufgaben des Auftrags' : ''}.
			</p>
		{/if}
	{/if}

	{#if todos.length > 0}
		<div class="af-todos" role="group" aria-label="Aufgaben">
			<span class="af-label">Aufgaben</span>
			{#each todos as todo, i (i)}
				<div class="af-todo">
					<div class="af-todo-felder">
						<input type="text" name="todo_{i}" placeholder="Aufgabe {i + 1}" bind:value={todo.titel} maxlength="200" aria-label="Aufgabe {i + 1}" />
						<input type="text" name="todo_beschreibung_{i}" placeholder="Beschreibung (optional)" bind:value={todo.beschreibung} maxlength="500" aria-label="Beschreibung Aufgabe {i + 1}" />
						<div class="af-todo-stufen">
							<Auswahl name="todo_lautstaerke_{i}" bind:value={todo.lautstaerke} aria-label="Lautstärke Aufgabe {i + 1}">
								<option value="">Lautstärke –</option>
								{#each STUFEN as n (n)}<option value={String(n)}>Lautstärke: {STUFE_NAMEN[n]}</option>{/each}
							</Auswahl>
							<Auswahl name="todo_schmutz_{i}" bind:value={todo.schmutz} aria-label="Schmutz Aufgabe {i + 1}">
								<option value="">Schmutz –</option>
								{#each STUFEN as n (n)}<option value={String(n)}>Schmutz: {STUFE_NAMEN[n]}</option>{/each}
							</Auswahl>
						</div>
					</div>
					<div class="af-todo-knoepfe">
						<button type="button" class="knopf-ghost" aria-label="Aufgabe {i + 1} nach oben" onclick={() => todoVerschieben(i, -1)} disabled={i === 0}>↑</button>
						<button type="button" class="knopf-ghost" aria-label="Aufgabe {i + 1} nach unten" onclick={() => todoVerschieben(i, 1)} disabled={i === todos.length - 1}>↓</button>
						<button type="button" class="kd-knopf gefahr" aria-label="Aufgabe {i + 1} entfernen" onclick={() => todoEntfernen(i)}>×</button>
					</div>
				</div>
			{/each}
			<button type="button" onclick={todoHinzufuegen} class="kd-knopf hell af-todo-hinzufuegen">+ Aufgabe hinzufügen</button>
		</div>
	{:else if todosGeladen}
		<button type="button" onclick={todoHinzufuegen} class="kd-knopf hell af-todo-hinzufuegen">+ Aufgabe hinzufügen</button>
	{/if}

	<FormFuss>
		<a href={abbrechen} class="kd-knopf hell">Abbrechen</a>
		<button type="submit" class="kd-knopf">{knopf}</button>
	</FormFuss>
</form>

<style>
	.af-block,
	.af-feld {
		display: grid;
		gap: 0.5rem;
		grid-column: 1 / -1;
	}
	.af-feld {
		justify-items: start;
	}
	.af-label {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-weight: 500;
	}
	.af-einmal {
		display: grid;
		gap: 0.75rem;
		padding: 0.9rem 1rem;
		border-radius: var(--ui-radius-karte);
		background: var(--ui-band);
		border: 1px solid var(--ui-rand);
	}
	.af-einmal .kd-info {
		margin: 0;
	}
	.af-gewaehlt {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--ui-akzent-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-akzent-zart);
	}
	.af-gewaehlt-text {
		display: grid;
		flex: 1 1 12rem;
		min-width: 0;
	}
	.af-zurueck {
		justify-self: start;
	}
	.af-voll {
		grid-column: 1 / -1;
	}
	.af-todos {
		display: grid;
		gap: 0.6rem;
		grid-column: 1 / -1;
	}
	.af-todo {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		padding: 0.75rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
	}
	.af-todo-felder {
		flex: 1;
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}
	.af-todo-stufen {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.af-todo-knoepfe {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.af-todo-knoepfe :global(button) {
		min-width: var(--ui-knopf-hoehe);
		padding: 0 !important;
	}
	.af-todo-hinzufuegen {
		justify-self: start;
	}
</style>
