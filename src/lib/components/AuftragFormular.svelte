<script lang="ts">
	import { enhance } from '$app/forms';
	import { STUFEN, STUFE_NAMEN } from '$lib/stufen';

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
		/** Bearbeiten: To-dos aus der Vorlage kommen zu den vorhandenen To-dos des Auftrags dazu. */
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
	// Kunde aus der Kundendatenbank, Einmal-Kunde (nur am Auftrag) oder ohne Kunde (Phase 3)
	let kundeArtWahl = $state<string | null>(null);
	const kundeArt = $derived(kundeArtWahl ?? (werte.kundeArt || 'kunde'));
	let aendern = $state(false);
	let suchtext = $state('');
	let treffer = $state<(Kunde & { info: string })[]>([]);
	let meldung = $state<string | null>(null);
	let laedt = $state(false);
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

	async function suchen() {
		meldung = null;
		laedt = true;
		try {
			const r = await fetch(`/api/kunden?suche=${encodeURIComponent(suchtext)}`);
			if (!r.ok) {
				treffer = [];
				meldung = r.status === 403 ? 'Die Kundensuche ist für Ihr Konto nicht freigegeben.' : 'Die Suche hat nicht geklappt.';
				return;
			}
			const liste: { id: string; name: string; strasse?: string | null; plz?: string | null; ort: string | null; telefon: string | null }[] =
				await r.json();
			treffer = liste.map((k) => ({
				id: k.id,
				name: k.name,
				adresse: adresse({ strasse: k.strasse ?? null, plz: k.plz ?? null, ort: k.ort }) || null,
				info: [k.ort, k.telefon].filter(Boolean).join(' · ')
			}));
			if (treffer.length === 0) meldung = 'Keine Kunden gefunden.';
		} catch {
			meldung = 'Keine Verbindung. Bitte erneut versuchen.';
		} finally {
			laedt = false;
		}
	}

	async function waehle(k: Kunde) {
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
		treffer = [];
		suchtext = '';
		meldung = null;
	}

	function sucheTaste(e: KeyboardEvent) {
		// Enter im Suchfeld sucht, statt das Auftragsformular abzuschicken
		if (e.key === 'Enter') {
			e.preventDefault();
			void suchen();
		}
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

<form method="POST" action={aktion} use:enhance class="kd-formular">
	{#if fehler}
		<p role="alert" class="kd-fehler">{fehler}</p>
	{/if}

	<fieldset class="af-kundenart">
		<legend>Kunde *</legend>
		<div class="af-kundenart-wahl">
			{#each [['kunde', 'Aus der Kundendatenbank'], ['einmal', 'Einmal-Kunde'], ['ohne', 'Ohne Kunde']] as [wert, text] (wert)}
				<label class="af-haken">
					<input type="radio" name="kundeArt" value={wert} checked={kundeArt === wert} onchange={() => (kundeArtWahl = wert)} />
					{text}
				</label>
			{/each}
		</div>
	</fieldset>

	{#if kundeArt === 'einmal'}
		<fieldset class="af-kunde af-einmal">
			<legend>Einmal-Kunde</legend>
			<p class="kd-info">Wird nur an diesem Auftrag gespeichert, nicht in der Kundendatenbank. Später übernehmbar.</p>
			<label>Name * <input type="text" name="einmalName" maxlength="200" required value={werte.einmalName ?? ''} /></label>
			<div class="kd-zwei">
				<label>Telefon <input type="tel" name="einmalTelefon" maxlength="50" value={werte.einmalTelefon ?? ''} /></label>
				<label>E-Mail <input type="email" name="einmalEmail" maxlength="200" value={werte.einmalEmail ?? ''} /></label>
			</div>
			<label>Straße <input type="text" name="einmalStrasse" maxlength="200" value={werte.einmalStrasse ?? ''} /></label>
			<div class="kd-zwei">
				<label>PLZ <input type="text" name="einmalPlz" maxlength="20" value={werte.einmalPlz ?? ''} /></label>
				<label>Ort <input type="text" name="einmalOrt" maxlength="200" value={werte.einmalOrt ?? ''} /></label>
			</div>
		</fieldset>
	{:else if kundeArt === 'ohne'}
		<p class="kd-info">Der Auftrag bekommt keinen Kunden – z. B. für interne Arbeiten. Ein Kunde lässt sich später eintragen.</p>
	{/if}

	{#if kundeArt === 'kunde'}
	<fieldset class="af-kunde">
		<legend>Kunde aus der Kundendatenbank</legend>
		<input type="hidden" name="kundeId" value={aktKunde?.id ?? ''} />
		{#if aktKunde}
			<div class="af-gewaehlt">
				<strong>{aktKunde.name}</strong>
				{#if kundenSuche && !aendern}
					<button type="button" class="kd-knopf hell" onclick={() => (aendern = true)}>Anderen Kunden wählen</button>
				{/if}
			</div>
		{/if}
		{#if sucheOffen}
			{#if kundenSuche}
				<div class="kd-suche">
					<input
						type="search"
						bind:value={suchtext}
						onkeydown={sucheTaste}
						placeholder="Name, Ort oder Telefon"
						aria-label="Kunden suchen"
						autocomplete="off"
						enterkeyhint="search"
					/>
					<button type="button" class="kd-knopf" onclick={suchen} disabled={laedt}>Suchen</button>
				</div>
				{#if meldung}<p class="kd-info" role="status">{meldung}</p>{/if}
				{#if treffer.length > 0}
					<ul class="af-treffer" aria-label="Gefundene Kunden">
						{#each treffer as t (t.id)}
							<li>
								<button type="button" onclick={() => waehle(t)}>
									<strong>{t.name}</strong>
									{#if t.info}<span class="kd-info"> · {t.info}</span>{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if !aktKunde}
				<p class="kd-info">Bitte den Auftrag über die Seite des Kunden anlegen („+ Auftrag“).</p>
			{/if}
		{/if}
	</fieldset>
	{/if}

	{#if aktKunde && kundeArt === 'kunde'}
		<label>
			Objekt (Baustelle)
			<select name="objektId" onchange={(e) => (objektWahl = e.currentTarget.value)}>
				<option value="" selected={objektWert === ''}>
					Kundenadresse (Standard){aktKunde.adresse ? ` – ${aktKunde.adresse}` : ''}
				</option>
				{#each aktObjekte as o (o.id)}
					<option value={o.id} selected={o.id === objektWert}>
						{o.bezeichnung}{o.adresse ? ` (${o.adresse})` : ''}
					</option>
				{/each}
			</select>
		</label>
		{#if anlage && objektWert === anlage.objektId}
			<input type="hidden" name="anlageId" value={anlage.id} />
			<p class="kd-info">Anlage: <strong>{anlage.bezeichnung}</strong> ({anlage.typName})</p>
		{/if}
	{/if}

	{#if mitarbeiter.length > 0}
		<fieldset class="af-zustaendig">
			<legend>Zuständige Mitarbeiter (mehrere möglich)</legend>
			<input type="hidden" name="zustaendigeGesendet" value="1" />
			<div class="af-zustaendig-liste">
				{#each mitarbeiter as m (m.id)}
					<label class="af-haken">
						<input type="checkbox" name="zustaendige" value={m.id} checked={zustaendige.includes(m.id)} />
						{m.name}
					</label>
				{/each}
			</div>
		</fieldset>
	{/if}

	{#if quellen.length > 0}
		<label>
			Auftragsquelle{quellePflicht ? ' *' : ''} <span class="kd-info">(woher kam der Auftrag?)</span>
			<select name="quelleId" required={quellePflicht}>
				<option value="" selected={!werte.quelleId}>{quellePflicht ? '– bitte wählen –' : '– keine –'}</option>
				{#each quellen.filter((q) => q.aktiv || q.id === werte.quelleId) as q (q.id)}
					<option value={q.id} selected={werte.quelleId === q.id}>{q.name}</option>
				{/each}
			</select>
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
		<fieldset class="af-vorlage">
			<legend>{todosZusaetzlich ? 'To-dos aus Vorlage hinzufügen' : 'To-do-Vorlage'}</legend>
			<select bind:value={vorlageWahl} onchange={ladeVorlage} aria-label="To-do-Vorlage">
				<option value="">– ohne Vorlage –</option>
				{#each vorlagen as v (v.id)}
					<option value={v.id}>{v.name}</option>
				{/each}
			</select>
			{#if todosGeladen && todos.length > 0}
				<p class="kd-info">
					{todos.length} To-dos aus der Vorlage werden angelegt{todosZusaetzlich
						? ' – zusätzlich zu den vorhandenen To-dos des Auftrags'
						: ''}.
				</p>
			{/if}
		</fieldset>
	{/if}

	{#if todos.length > 0}
		<fieldset class="af-todos">
			<legend>To-dos</legend>
			{#each todos as todo, i (i)}
				<div class="af-todo">
					<div class="af-todo-felder">
						<input
							type="text"
							name="todo_{i}"
							placeholder="To-do {i + 1}"
							bind:value={todo.titel}
							maxlength="200"
						/>
						<input
							type="text"
							name="todo_beschreibung_{i}"
							placeholder="Beschreibung (optional)"
							bind:value={todo.beschreibung}
							maxlength="500"
						/>
						<div class="af-todo-stufen">
							<select name="todo_lautstaerke_{i}" bind:value={todo.lautstaerke} aria-label="Lautstärke To-do {i + 1}">
								<option value="">Lautstärke –</option>
								{#each STUFEN as n (n)}<option value={String(n)}>Lautstärke: {STUFE_NAMEN[n]}</option>{/each}
							</select>
							<select name="todo_schmutz_{i}" bind:value={todo.schmutz} aria-label="Schmutz To-do {i + 1}">
								<option value="">Schmutz –</option>
								{#each STUFEN as n (n)}<option value={String(n)}>Schmutz: {STUFE_NAMEN[n]}</option>{/each}
							</select>
						</div>
					</div>
					<div class="af-todo-knoepfe">
						<button type="button" onclick={() => todoVerschieben(i, -1)} disabled={i === 0}>↑</button>
						<button type="button" onclick={() => todoVerschieben(i, 1)} disabled={i === todos.length - 1}>↓</button>
						<button type="button" onclick={() => todoEntfernen(i)} class="entfernen">×</button>
					</div>
				</div>
			{/each}
			<button type="button" onclick={todoHinzufuegen} class="af-todo-hinzufuegen">+ To-do hinzufügen</button>
		</fieldset>
	{:else if todosGeladen}
		<button type="button" onclick={todoHinzufuegen} class="af-todo-hinzufuegen">+ To-do hinzufügen</button>
	{/if}

	<div class="kd-aktionen">
		<button type="submit" class="kd-knopf">{knopf}</button>
		<a href={abbrechen} class="kd-knopf hell">Abbrechen</a>
	</div>
</form>

<style>
	.af-kundenart {
		border: none;
		padding: 0;
		margin: 0 0 0.5rem;
	}
	.af-kundenart legend {
		font-weight: 600;
		padding: 0;
		margin-bottom: 0.25rem;
	}
	.af-kundenart-wahl {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1.25rem;
	}
	.af-einmal {
		display: grid;
		gap: 0.5rem;
	}
	.af-zustaendig {
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	.af-zustaendig legend {
		font-weight: 600;
		padding: 0 0.5rem;
	}
	.af-zustaendig-liste {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
	}
	.af-haken {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tippziel, 44px);
		font-weight: 400;
	}
	.af-haken input {
		width: 1.25rem;
		height: 1.25rem;
	}
	.af-vorlage {
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		padding: 1rem;
		margin-bottom: 1rem;
	}
	.af-vorlage legend {
		font-weight: 600;
		color: var(--text, #323130);
		padding: 0 0.5rem;
	}
	.af-vorlage select {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		font-size: 1rem;
	}
	.af-todos {
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		padding: 1rem;
		margin-bottom: 1rem;
	}
	.af-todos legend {
		font-weight: 600;
		color: var(--text, #323130);
		padding: 0 0.5rem;
	}
	.af-todo {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		align-items: flex-start;
	}
	.af-todo-felder {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.af-todo-felder input {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		font-size: 1rem;
		box-sizing: border-box;
	}
	.af-todo-stufen {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.af-todo-stufen select {
		padding: 0.5rem;
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		font-size: 0.9rem;
	}
	.af-todo-knoepfe {
		display: flex;
		gap: 0.25rem;
	}
	.af-todo-knoepfe button {
		width: 32px;
		height: 32px;
		border: 1px solid #d2d0ce;
		background: white;
		border-radius: 4px;
		cursor: pointer;
		font-size: 1.25rem;
		line-height: 1;
	}
	.af-todo-knoepfe button:hover:not(:disabled) {
		background: #f3f2f1;
	}
	.af-todo-knoepfe button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.af-todo-knoepfe .entfernen {
		color: #a4262c;
	}
	.af-todo-hinzufuegen {
		width: 100%;
		padding: 0.5rem;
		border: 2px dashed #d2d0ce;
		background: transparent;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-leise, #605e5c);
		font-size: 1rem;
		margin-top: 0.5rem;
	}
	.af-todo-hinzufuegen:hover {
		border-color: var(--m365-primaer);
		color: var(--ui-akzent-text);
	}
</style>
