<script lang="ts">
	import { ausTagUndUhrzeit, berlinTag, berlinUhrzeit, tagPlus } from '$lib/zeit';

	type Einsatz = {
		id: string;
		auftragId: string;
		auftragNummer: string;
		auftragTitel: string;
		kundeName: string;
		benutzerId: string;
		benutzerName: string;
		beginn: string;
		ende: string;
		notiz: string | null;
	};
	type AuftragKurz = { id: string; nummer: string; titel: string; kundeName: string };

	/**
	 * Dialog „Einsatz anlegen“ bzw. „Einsatz bearbeiten / verschieben“ (Tag, Mitarbeiter, Uhrzeit, Notiz). Auch die
	 * Tastatur-Alternative zum Ziehen: Kärtchen fokussieren, Enter, Tag/Mitarbeiter wählen. Endet „bis“ vor „von“, endet
	 * der Einsatz am Folgetag (Nachtarbeit). Speichert selbst über die API und meldet das Ergebnis an die Seite.
	 * Die Auftragssuche fragt den Server (`/api/auftraege?offen=1&suche=`), damit auch ältere offene Aufträge
	 * planbar sind; ohne Suchtext gelten die mitgegebenen neuesten offenen Aufträge.
	 */
	let {
		einsatz = null,
		vorbelegung = null,
		mitarbeiter,
		auftraege,
		onfertig,
		onschliessen
	}: {
		einsatz?: Einsatz | null;
		vorbelegung?: { tag: string; benutzerId: string } | null;
		mitarbeiter: { id: string; name: string }[];
		auftraege: AuftragKurz[];
		onfertig: (ergebnis: { aktion: 'angelegt' | 'geaendert' | 'geloescht'; einsatz: any }) => void;
		onschliessen: () => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let fehler = $state<string | null>(null);
	let sendet = $state(false);
	let suche = $state('');

	// Startwerte (einmalig beim Öffnen; der Dialog wird je Einsatz neu erzeugt)
	const start = (() => {
		if (einsatz) {
			const b = new Date(einsatz.beginn);
			const e = new Date(einsatz.ende);
			return {
				auftragId: einsatz.auftragId,
				benutzerId: einsatz.benutzerId,
				tag: berlinTag(b),
				von: berlinUhrzeit(b),
				bis: berlinUhrzeit(e),
				notiz: einsatz.notiz ?? ''
			};
		}
		return {
			auftragId: '',
			benutzerId: vorbelegung?.benutzerId ?? '',
			tag: vorbelegung?.tag ?? berlinTag(new Date()),
			von: '07:00',
			bis: '16:00',
			notiz: ''
		};
	})();
	let auftragId = $state(start.auftragId);
	let benutzerId = $state(start.benutzerId);
	let tag = $state(start.tag);
	let von = $state(start.von);
	let bis = $state(start.bis);
	let notiz = $state(start.notiz);

	let gefunden = $state<AuftragKurz[] | null>(null);
	let suchFehler = $state<string | null>(null);
	let suchZeit: ReturnType<typeof setTimeout> | undefined;

	/** Mit Suchtext: Treffer des Servers (bis dahin lokal gefiltert); ohne: die mitgegebene Liste. */
	const treffer = $derived.by(() => {
		const w = suche.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const lokal = auftraege.filter((a) => w.every((x) => `${a.nummer} ${a.titel} ${a.kundeName}`.toLowerCase().includes(x)));
		const liste = w.length > 0 && gefunden ? gefunden : lokal;
		// die aktuelle Auswahl bleibt wählbar, auch wenn sie nicht (mehr) in der Trefferliste steht
		const gewaehlt = [...auftraege, ...(gefunden ?? [])].find((a) => a.id === auftragId);
		return gewaehlt && !liste.some((a) => a.id === gewaehlt.id) ? [gewaehlt, ...liste] : liste.slice(0, 100);
	});

	function sucheAendern() {
		clearTimeout(suchZeit);
		gefunden = null;
		suchFehler = null;
		const text = suche.trim();
		if (!text) return;
		suchZeit = setTimeout(async () => {
			try {
				const r = await fetch(`/api/auftraege?offen=1&suche=${encodeURIComponent(text.slice(0, 100))}`);
				if (!r.ok) throw new Error();
				const liste: AuftragKurz[] = await r.json();
				if (suche.trim() === text) gefunden = liste.map((a) => ({ id: a.id, nummer: a.nummer, titel: a.titel, kundeName: a.kundeName }));
			} catch {
				if (suche.trim() === text) suchFehler = 'Suche nicht möglich – es werden nur die neuesten Aufträge durchsucht.';
			}
		}, 250);
	}

	/** Mitarbeiter zur Auswahl; ein deaktivierter Mitarbeiter des bestehenden Einsatzes bleibt (markiert) wählbar. */
	const auswahlMitarbeiter = $derived(
		einsatz && !mitarbeiter.some((m) => m.id === einsatz.benutzerId)
			? [...mitarbeiter, { id: einsatz.benutzerId, name: `${einsatz.benutzerName} (deaktiviert)` }]
			: mitarbeiter
	);
	const folgetag = $derived(bis !== '' && von !== '' && bis <= von);

	$effect(() => {
		dialog?.showModal();
	});

	function zeitraum(): { beginn: string; ende: string } {
		const beginn = ausTagUndUhrzeit(tag, von);
		const ende = ausTagUndUhrzeit(folgetag ? tagPlus(tag, 1) : tag, bis);
		return { beginn: beginn.toISOString(), ende: ende.toISOString() };
	}

	async function senden(methode: 'POST' | 'PATCH' | 'DELETE', url: string, koerper?: unknown) {
		const r = await fetch(url, {
			method: methode,
			headers: koerper ? { 'content-type': 'application/json' } : undefined,
			body: koerper ? JSON.stringify(koerper) : undefined
		});
		const text = await r.text();
		const daten = text ? JSON.parse(text) : null;
		if (!r.ok) throw new Error(daten?.fehler ?? 'Speichern hat nicht geklappt.');
		return daten;
	}

	async function speichern(ev: SubmitEvent) {
		ev.preventDefault();
		fehler = null;
		let zeiten: { beginn: string; ende: string };
		try {
			zeiten = zeitraum();
		} catch {
			fehler = 'Bitte Tag und Uhrzeiten angeben.';
			return;
		}
		if (!einsatz && !auftragId) {
			fehler = 'Bitte einen Auftrag wählen.';
			return;
		}
		sendet = true;
		try {
			const koerper = { auftragId, benutzerId, ...zeiten, notiz };
			const ergebnis = einsatz
				? await senden('PATCH', `/api/einsaetze/${einsatz.id}`, koerper)
				: await senden('POST', '/api/einsaetze', koerper);
			onfertig({ aktion: einsatz ? 'geaendert' : 'angelegt', einsatz: ergebnis });
		} catch (e) {
			fehler = e instanceof Error ? e.message : 'Speichern hat nicht geklappt.';
		} finally {
			sendet = false;
		}
	}

	async function loeschen() {
		if (!einsatz) return;
		fehler = null;
		sendet = true;
		try {
			await senden('DELETE', `/api/einsaetze/${einsatz.id}`);
			onfertig({ aktion: 'geloescht', einsatz });
		} catch (e) {
			fehler = e instanceof Error ? e.message : 'Löschen hat nicht geklappt.';
		} finally {
			sendet = false;
		}
	}
</script>

<dialog bind:this={dialog} class="pt-dialog" aria-labelledby="pt-dialog-titel" onclose={onschliessen}>
	<form class="kd-formular" onsubmit={speichern}>
		<h2 id="pt-dialog-titel">{einsatz ? 'Einsatz bearbeiten' : 'Einsatz anlegen'}</h2>
		{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}

		{#if einsatz}
			<p>
				<a href={`/auftraege/${einsatz.auftragId}`}>{einsatz.auftragNummer} {einsatz.auftragTitel}</a>
				<span class="kd-info"> · {einsatz.kundeName}</span>
			</p>
		{:else}
			<label>
				Auftrag suchen
				<input
					type="search"
					bind:value={suche}
					oninput={sucheAendern}
					placeholder="Nummer, Titel oder Kunde"
					autocomplete="off"
				/>
			</label>
			{#if suchFehler}<p class="kd-info" role="status">{suchFehler}</p>{/if}
			<label>
				Auftrag *
				<select bind:value={auftragId} required size={Math.min(6, Math.max(2, treffer.length + 1))}>
					<option value="" disabled>– bitte wählen –</option>
					{#each treffer as a (a.id)}
						<option value={a.id}>{a.nummer} · {a.titel} · {a.kundeName}</option>
					{/each}
				</select>
			</label>
		{/if}

		<fieldset>
			<legend>{einsatz ? 'Verschieben' : 'Wer und wann'}</legend>
			<div class="kd-formular">
				<label>
					Mitarbeiter
					<select bind:value={benutzerId} required>
						{#each auswahlMitarbeiter as m (m.id)}
							<option value={m.id}>{m.name}</option>
						{/each}
					</select>
				</label>
				<label>
					Tag
					<input type="date" bind:value={tag} required />
				</label>
				<div class="kd-zwei">
					<label>Von <input type="time" bind:value={von} required /></label>
					<label>Bis <input type="time" bind:value={bis} required /></label>
				</div>
				{#if folgetag}<p class="kd-info">Der Einsatz endet am Folgetag.</p>{/if}
			</div>
		</fieldset>

		<label>
			Notiz
			<textarea bind:value={notiz} maxlength="500" rows="2"></textarea>
		</label>

		<div class="kd-aktionen">
			<button type="submit" class="kd-knopf" disabled={sendet}>{einsatz ? 'Speichern' : 'Einsatz anlegen'}</button>
			<button type="button" class="kd-knopf hell" onclick={() => dialog?.close()}>Abbrechen</button>
			{#if einsatz}
				<button type="button" class="kd-knopf gefahr" disabled={sendet} onclick={loeschen}>Einsatz löschen</button>
			{/if}
		</div>
	</form>
</dialog>

<style>
	.pt-dialog {
		box-sizing: border-box;
		width: min(32rem, calc(100vw - 1rem));
		max-height: calc(100dvh - 1rem);
		padding: 1rem;
		border: 1px solid var(--rand);
		border-radius: 0.6rem;
		overflow-y: auto;
	}
	.pt-dialog::backdrop {
		background: rgb(0 0 0 / 0.35);
	}
	.pt-dialog h2 {
		margin: 0;
		font-size: 1.2rem;
	}
	.pt-dialog fieldset {
		border: 1px solid #c8c8c8;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem 0.75rem;
		margin: 0;
		min-width: 0;
	}
	.pt-dialog select[size] {
		min-height: 6rem;
	}
</style>
