<script lang="ts">
	import { enhance } from '$app/forms';

	type Kunde = { id: string; name: string };
	type Objekt = { id: string; bezeichnung: string; adresse: string };

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
		fehler = null,
		knopf,
		abbrechen
	}: {
		aktion: string;
		werte: Record<string, string>;
		kunde?: Kunde | null;
		objekte?: Objekt[];
		kundenSuche?: boolean;
		fehler?: string | null;
		knopf: string;
		abbrechen: string;
	} = $props();

	let gewaehlt = $state<{ kunde: Kunde; objekte: Objekt[] } | null>(null);
	let aendern = $state(false);
	let suchtext = $state('');
	let treffer = $state<(Kunde & { info: string })[]>([]);
	let meldung = $state<string | null>(null);
	let laedt = $state(false);
	let objektWahl = $state<string | null>(null);

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
			const liste: { id: string; name: string; ort: string | null; telefon: string | null }[] = await r.json();
			treffer = liste.map((k) => ({ id: k.id, name: k.name, info: [k.ort, k.telefon].filter(Boolean).join(' · ') }));
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
		gewaehlt = { kunde: { id: k.id, name: k.name }, objekte: liste };
		objektWahl = '';
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
</script>

<form method="POST" action={aktion} use:enhance class="kd-formular">
	{#if fehler}
		<p role="alert" class="kd-fehler">{fehler}</p>
	{/if}

	<fieldset class="af-kunde">
		<legend>Kunde *</legend>
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

	{#if aktKunde}
		<label>
			Objekt (Baustelle)
			<select name="objektId" onchange={(e) => (objektWahl = e.currentTarget.value)}>
				<option value="" selected={objektWert === ''}>– ohne Objekt –</option>
				{#each aktObjekte as o (o.id)}
					<option value={o.id} selected={o.id === objektWert}>
						{o.bezeichnung}{o.adresse ? ` (${o.adresse})` : ''}
					</option>
				{/each}
			</select>
		</label>
	{/if}

	<label>
		Titel *
		<input type="text" name="titel" maxlength="200" required value={werte.titel ?? ''} placeholder="z. B. Badsanierung" />
	</label>

	<label>
		Geplant ab
		<input type="date" name="geplantAb" value={werte.geplantAb ?? ''} />
	</label>

	<label>
		Beschreibung
		<textarea name="beschreibung" maxlength="4000" rows="5">{werte.beschreibung ?? ''}</textarea>
	</label>

	<div class="kd-aktionen">
		<button type="submit" class="kd-knopf">{knopf}</button>
		<a href={abbrechen} class="kd-knopf hell">Abbrechen</a>
	</div>
</form>
