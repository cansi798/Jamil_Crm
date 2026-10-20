<script lang="ts">
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { untrack } from 'svelte';
	import { ausTagUndUhrzeit, berlinTag, berlinUhrzeit, tagPlus } from '$lib/zeit';
	import { page } from '$app/state';
	import ErinnerungWahl from './ErinnerungWahl.svelte';

	type Einsatz = {
		id: string;
		auftragId: string | null;
		auftragNummer: string;
		auftragTitel: string;
		kundeName: string;
		benutzerId: string;
		benutzerName: string;
		beginn: string;
		ende: string;
		notiz: string | null;
		gruppe?: { id: string; vonTag: string; bisTag: string } | null;
		kolonne?: { id: string; name: string } | null;
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
		kolonnen = [],
		onfertig,
		onschliessen
	}: {
		einsatz?: Einsatz | null;
		vorbelegung?: { tag: string; benutzerId: string; kolonneId?: string } | null;
		mitarbeiter: { id: string; name: string }[];
		auftraege: AuftragKurz[];
		/** Kolonnen zur Auswahl „Wer“ (Wunsch Jamil msg 2510). */
		kolonnen?: { id: string; name: string; mitglieder: { id: string; name: string }[] }[];
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
	// Eigener Termin ohne Auftrag (Wunsch Jamil msg 2682), z. B. „Zahnarzt“
	let eigen = $state(untrack(() => !!einsatz && !einsatz.auftragId));
	let titel = $state(untrack(() => (einsatz && !einsatz.auftragId ? einsatz.auftragTitel : '')));
	// Erinnerungen (msg 2679): beim Anlegen immer, beim Bearbeiten nur, wenn „neu setzen“ gewählt
	const erinnern = $derived(page.data.erinnern === true);
	let erinnerungNeu = $state(untrack(() => !einsatz));
	let formEl: HTMLFormElement | undefined = $state();
	// Mehrtägig / Kolonne (msgs 2510, 2513) – nur beim Anlegen
	let wer = $state<'person' | 'kolonne'>(untrack(() => (vorbelegung?.kolonneId ? 'kolonne' : 'person')));
	let kolonneId = $state(untrack(() => vorbelegung?.kolonneId ?? kolonnen[0]?.id ?? ''));
	let bisTag = $state(start.tag);
	let ohneWochenende = $state(true);
	// Bestehende Gruppe: letzten Tag ändern
	let gruppenEnde = $state(untrack(() => einsatz?.gruppe?.bisTag ?? ''));
	const alsGruppe = $derived(!einsatz && (wer === 'kolonne' || (bisTag !== '' && bisTag > tag)));

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
		if (eigen && !titel.trim()) {
			fehler = 'Bitte einen Titel für den eigenen Termin eingeben.';
			return;
		}
		if (!einsatz && !eigen && !auftragId) {
			fehler = 'Bitte einen Auftrag wählen.';
			return;
		}
		if (eigen && alsGruppe) {
			fehler = 'Eigene Termine gehen nur an einem Tag und für eine Person.';
			return;
		}
		const fd = formEl ? new FormData(formEl) : null;
		const erinnerungen = erinnern && erinnerungNeu && !alsGruppe ? { erinnerung1: String(fd?.get('erinnerung1') ?? ''), erinnerung2: String(fd?.get('erinnerung2') ?? '') } : {};
		sendet = true;
		try {
			if (alsGruppe) {
				if (folgetag) throw new Error('Mehrtägige Termine: „Bis“ muss am selben Tag nach „Von“ liegen.');
				const g = await senden('POST', '/api/einsatz-gruppen', {
					auftragId,
					...(wer === 'kolonne' ? { kolonneId } : { benutzerIds: [benutzerId] }),
					vonTag: tag,
					bisTag: bisTag < tag ? tag : bisTag,
					vonZeit: von,
					bisZeit: bis,
					notiz,
					ohneWochenende
				});
				const alle = g.einsaetze as { warnungen: unknown[] }[];
				onfertig({ aktion: 'angelegt', einsatz: { ...alle[0], warnungen: alle.flatMap((x) => x.warnungen) } });
				return;
			}
			const koerper = { ...(eigen ? { auftragId: null, titel: titel.trim() } : { auftragId }), benutzerId, ...zeiten, notiz, ...erinnerungen };
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

	async function gruppeAendern(art: 'ende' | 'loeschen') {
		if (!einsatz?.gruppe) return;
		fehler = null;
		sendet = true;
		try {
			if (art === 'loeschen') {
				await senden('DELETE', `/api/einsatz-gruppen/${einsatz.gruppe.id}`);
				onfertig({ aktion: 'geloescht', einsatz });
			} else {
				const liste = await senden('PATCH', `/api/einsatz-gruppen/${einsatz.gruppe.id}`, { bisTag: gruppenEnde });
				onfertig({ aktion: 'geaendert', einsatz: { ...liste[0], warnungen: liste.flatMap((x: { warnungen: unknown[] }) => x.warnungen) } });
			}
		} catch (e) {
			fehler = e instanceof Error ? e.message : 'Hat nicht geklappt.';
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
	<form class="kd-formular" onsubmit={speichern} bind:this={formEl}>
		<h2 id="pt-dialog-titel">{einsatz ? 'Einsatz bearbeiten' : 'Einsatz anlegen'}</h2>
		{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}

		{#if einsatz && einsatz.auftragId}
			<p>
				<a href={`/auftraege/${einsatz.auftragId}`}>{einsatz.auftragNummer} {einsatz.auftragTitel}</a>
				<span class="kd-info"> · {einsatz.kundeName}</span>
			</p>
		{:else if einsatz || eigen}
			{#if !einsatz}<label class="kd-haken"><input type="checkbox" bind:checked={eigen} /><span>📌 Eigener Termin (ohne Auftrag)</span></label>{/if}
			<label>Titel * <input type="text" bind:value={titel} maxlength="200" required placeholder="z. B. Zahnarzt, Besprechung" /></label>
		{:else}
			<label class="kd-haken"><input type="checkbox" bind:checked={eigen} /><span>📌 Eigener Termin (ohne Auftrag)</span></label>
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
				<Auswahl bind:value={auftragId} required size={Math.min(6, Math.max(2, treffer.length + 1))}>
					<option value="" disabled>– bitte wählen –</option>
					{#each treffer as a (a.id)}
						<option value={a.id}>{a.nummer} · {a.titel} · {a.kundeName}</option>
					{/each}
				</Auswahl>
			</label>
		{/if}

		{#if einsatz?.gruppe}
			<div class="pt-gruppe" role="note">
				<p>
					{einsatz.kolonne ? `${einsatz.kolonne.name} · ` : ''}Termin {einsatz.gruppe.vonTag === einsatz.gruppe.bisTag ? 'am' : 'über mehrere Tage'}:
					{einsatz.gruppe.vonTag.split('-').reverse().join('.')}{einsatz.gruppe.bisTag !== einsatz.gruppe.vonTag ? ` – ${einsatz.gruppe.bisTag.split('-').reverse().join('.')}` : ''}.
					Unten änderst du nur diesen Tag dieser Person.
				</p>
				<div class="kd-zwei">
					<label>Letzter Tag <input type="date" bind:value={gruppenEnde} min={einsatz.gruppe.vonTag} /></label>
					<button type="button" class="kd-knopf hell" disabled={sendet || !gruppenEnde} onclick={() => gruppeAendern('ende')}>Termin bis dahin</button>
				</div>
				<button type="button" class="kd-knopf gefahr" disabled={sendet} onclick={() => gruppeAendern('loeschen')}>Ganzen Termin löschen</button>
			</div>
		{/if}

		<fieldset>
			<legend>{einsatz ? 'Verschieben' : 'Wer und wann'}</legend>
			<div class="kd-formular">
				{#if !einsatz && kolonnen.length > 0}
					<Segmente
						label="Wer"
						voll
						bind:wert={wer}
						optionen={[
							{ wert: 'person', text: 'Mitarbeiter' },
							{ wert: 'kolonne', text: 'Kolonne' }
						]}
					/>
				{/if}
				{#if wer === 'kolonne' && !einsatz}
					<label>
						Kolonne
						<Auswahl bind:value={kolonneId} required>
							{#each kolonnen as ko (ko.id)}<option value={ko.id}>{ko.name} ({ko.mitglieder.map((m) => m.name.split(' ')[0]).join(', ')})</option>{/each}
						</Auswahl>
					</label>
				{:else}
					<div class="ui-feld">
						Mitarbeiter
						<PersonWahl name="benutzerId" label="Mitarbeiter" leerText="Mitarbeiter wählen" required personen={auswahlMitarbeiter} bind:wert={benutzerId} />
					</div>
				{/if}
				<div class={einsatz ? '' : 'kd-zwei'}>
					<label>
						{einsatz ? 'Tag' : 'Erster Tag'}
						<input type="date" bind:value={tag} required onchange={() => { if (!einsatz && bisTag < tag) bisTag = tag; }} />
					</label>
					{#if !einsatz}
						<label>
							Letzter Tag (mehrtägig)
							<input type="date" bind:value={bisTag} min={tag} />
						</label>
					{/if}
				</div>
				{#if alsGruppe && bisTag > tag}
					<label class="kd-haken"><input type="checkbox" bind:checked={ohneWochenende} /><span>Samstag und Sonntag auslassen</span></label>
				{/if}
				<div class="kd-zwei">
					<label>Von <input type="time" bind:value={von} required /></label>
					<label>Bis <input type="time" bind:value={bis} required /></label>
				</div>
				{#if folgetag && !alsGruppe}<p class="kd-info">Der Einsatz endet am Folgetag.</p>{/if}
				{#if alsGruppe}<p class="kd-info">Arbeitszeit gilt für jeden Tag{wer === 'kolonne' ? ' und jedes Mitglied der Kolonne' : ''}.</p>{/if}
			</div>
		</fieldset>

		<label>
			Notiz
			<textarea bind:value={notiz} maxlength="500" rows="2"></textarea>
		</label>

		{#if erinnern && !alsGruppe}
			<fieldset class="pt-erinnern">
				<legend>Erinnern (an dich)</legend>
				{#if einsatz}<label class="kd-haken"><input type="checkbox" bind:checked={erinnerungNeu} /><span>Erinnerungen neu setzen</span></label>{/if}
				{#if erinnerungNeu}
					<ErinnerungWahl name="erinnerung1" label="🔔" wert="" />
					<ErinnerungWahl name="erinnerung2" label="und" wert="" />
					<p class="kd-info">„vorher“ bezieht sich auf den Beginn des Termins.</p>
				{/if}
			</fieldset>
		{/if}

		<div class="kd-aktionen">
			<button type="button" class="kd-knopf hell" onclick={() => dialog?.close()}>Abbrechen</button>
			<button type="submit" class="kd-knopf" disabled={sendet}>{einsatz ? 'Speichern' : 'Einsatz anlegen'}</button>
			{#if einsatz}
				<button type="button" class="kd-knopf gefahr" disabled={sendet} onclick={loeschen}>Einsatz löschen</button>
			{/if}
		</div>
	</form>
</dialog>

<style>
	.pt-erinnern {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		border: 1px solid var(--m365-rand, #e1dfdd);
		border-radius: 0.4rem;
		padding: 0.5rem 0.75rem;
	}
	.pt-erinnern p {
		flex-basis: 100%;
		margin: 0;
	}
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
	.pt-gruppe {
		display: grid;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		border-radius: 0.5rem;
		background: #eef3fa;
	}
	.pt-gruppe p {
		margin: 0;
	}
	.pt-wer {
		display: flex;
		gap: 1rem;
	}
	.pt-dialog select[size] {
		min-height: 6rem;
	}
</style>
