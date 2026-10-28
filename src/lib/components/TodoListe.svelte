<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import ZeitraumWahl from './ZeitraumWahl.svelte';
	import { personenMitVorschlag, zeitraumText } from '$lib/aufgaben';
	import { STUFEN, STUFE_NAMEN, stufeName } from '$lib/stufen';
	import Unteraufgaben from './Unteraufgaben.svelte';

	type Todo = {
		id: string;
		titel: string;
		beschreibung?: string | null;
		nacharbeit?: boolean;
		lautstaerke?: number | null;
		schmutz?: number | null;
		serie?: { id: string; text: string; aktiv: boolean } | null;
		nachfassAngebotId?: string | null;
		zustaendigId: string | null;
		zustaendigName: string | null;
		faellig: string | null;
		faelligZeit?: string | null;
		vonTag?: string | null;
		vonZeit?: string | null;
		mitarbeiter?: { id: string; name: string }[];
		erledigt: boolean;
		/** Auftrag der Aufgabe – nur Aufgaben im Auftrag haben Lautstärke/Schmutz (Jamil msg 3529) */
		auftragId?: string | null;
		unteraufgaben?: { id: string; titel: string; erledigt: boolean; benutzerId: string | null; benutzerName: string | null }[];
	};

	/**
	 * Aufgaben im Auftrag als schlichte Liste (Wunsch Jamil, msg 2579): je Zeile Häkchen (erledigt), Titel, Zuständiger und
	 * Fälligkeit; Klick auf den Titel klappt Details und Bearbeiten auf. Erledigte stehen eingeklappt unten.
	 * (Die Aufgaben-Seite behält ihr Board.)
	 */
	let {
		todos,
		heute,
		benutzerId,
		darfBearbeiten = false,
		mitarbeiter = [],
		amAuftrag = [],
		aktionen,
		leer = 'Keine Aufgaben.'
	}: {
		todos: Todo[];
		heute: string;
		benutzerId: string;
		darfBearbeiten?: boolean;
		mitarbeiter?: { id: string; name: string }[];
		/** Mitarbeiter des Auftrags – Vorschlag oben in der Auswahl (wählbar ist jeder) */
		amAuftrag?: { id: string; name: string }[];
		aktionen: { umschalten: string; aendern: string; loeschen: string; serieBeenden?: string; unterNeu?: string; unterUmschalten?: string; unterLoeschen?: string };
		leer?: string;
	} = $props();

	const offen = $derived(
		todos.filter((t) => !t.erledigt).sort((a, b) => (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999'))
	);
	const erledigt = $derived(todos.filter((t) => t.erledigt));
	let erledigteZeigen = $state(false);
	let aufgeklappt = $state<string | null>(null);

	const personen = $derived(personenMitVorschlag(mitarbeiter, amAuftrag));
	const leute = (t: Todo) => (t.mitarbeiter && t.mitarbeiter.length > 0 ? t.mitarbeiter : t.zustaendigId && t.zustaendigName ? [{ id: t.zustaendigId, name: t.zustaendigName }] : []);
	const ueberfaellig = (t: Todo) => !t.erledigt && t.faellig !== null && t.faellig < heute;
	const umschalten = (id: string) => (aufgeklappt = aufgeklappt === id ? null : id);
	// Nach dem Speichern zuklappen; Formular nicht leeren (Werte kommen frisch vom Server)
	const zuklappen = () => async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
		await update({ reset: false });
		if (result.type === 'success') aufgeklappt = null;
	};
</script>

{#snippet zeile(t: Todo)}
	{@const darfHaken = darfBearbeiten || t.zustaendigId === benutzerId || leute(t).some((m) => m.id === benutzerId)}
	{@const zeitraum = zeitraumText(t)}
	<li class="tl-zeile" class:erledigt={t.erledigt} class:ueberfaellig={ueberfaellig(t)}>
		<div class="tl-kopf">
			<form method="POST" action={aktionen.umschalten} use:enhance={() => async ({ update }) => update({ reset: false })} class="tl-haken">
				<input type="hidden" name="id" value={t.id} />
				<input type="hidden" name="erledigt" value={t.erledigt ? 'false' : 'true'} />
				<input
					type="checkbox"
					checked={t.erledigt}
					disabled={!darfHaken}
					aria-label={t.erledigt ? `„${t.titel}“ wieder öffnen` : `„${t.titel}“ erledigt`}
					onchange={(ev) => ev.currentTarget.form?.requestSubmit()}
				/>
			</form>
			<button type="button" class="tl-titel" aria-expanded={aufgeklappt === t.id} onclick={() => umschalten(t.id)}>
				<span class="tl-text">{t.titel}</span>
				{#if t.serie?.aktiv}<span class="tl-serie" title={`Wiederholt sich: ${t.serie.text}`}>↻ {t.serie.text}</span>{/if}
				{#if t.unteraufgaben?.length}<span class="tl-serie" title="Unteraufgaben erledigt">☑ {t.unteraufgaben.filter((u) => u.erledigt).length}/{t.unteraufgaben.length}</span>{/if}
			</button>
			<span class="tl-meta">
				{#if darfBearbeiten && !t.erledigt}
					<!-- Mitarbeiter direkt in der Zeile zuweisen (Jamil msg 2977): speichert sofort -->
					<form method="POST" action={aktionen.aendern} use:enhance={() => async ({ update }) => update({ reset: false })} class="tl-wer">
						<input type="hidden" name="id" value={t.id} />
						<input type="hidden" name="mitarbeiterFeld" value="1" />
						<PersonWahl name="mitarbeiterIds" mehrfach klein absenden label={`Mitarbeiter für „${t.titel}“`} leerText="Nicht zugewiesen" {personen} werte={leute(t).map((m) => m.id)} />
					</form>
				{:else}
					{#each leute(t).slice(0, 2) as m (m.id)}
						<span class="tl-chip" title={m.name}><span class="tl-avatar">{m.name.charAt(0)}</span><span class="tl-name">{m.name}</span></span>
					{/each}
					{#if leute(t).length > 2}<span class="tl-mehr" title={leute(t).slice(2).map((m) => m.name).join(', ')}>+{leute(t).length - 2}</span>{/if}
				{/if}
				{#if zeitraum}<span class="tl-faellig">{zeitraum}</span>{/if}
			</span>
		</div>
		{#if aufgeklappt === t.id}
			<div class="tl-details">
				{#if t.beschreibung}<p class="tl-beschreibung">{t.beschreibung}</p>{/if}
				{#if t.lautstaerke || t.schmutz}
					<p class="kd-info">
						{#if t.lautstaerke}Lautstärke: {stufeName(t.lautstaerke)}{/if}{#if t.lautstaerke && t.schmutz} · {/if}{#if t.schmutz}Schmutz: {stufeName(t.schmutz)}{/if}
					</p>
				{/if}
				{#if t.serie}<p class="kd-info">{t.serie.aktiv ? `Wiederholt sich: ${t.serie.text}` : 'Wiederholung beendet'}</p>{/if}
				<Unteraufgaben todoId={t.id} todoTitel={t.titel} liste={t.unteraufgaben ?? []} {aktionen} {darfBearbeiten} darfHaken={darfHaken} {personen} />
				{#if t.nachfassAngebotId}<p><a href={`/angebote/${t.nachfassAngebotId}#nachfassen`}>Angebot und fertigen Mailtext öffnen</a></p>{/if}
				{#if darfBearbeiten}
					<form method="POST" action={aktionen.aendern} use:enhance={zuklappen} class="kd-formular tl-formular">
						<input type="hidden" name="id" value={t.id} />
						<label>Titel <input type="text" name="titel" maxlength="200" required value={t.titel} /></label>
						<label>Beschreibung <textarea name="beschreibung" maxlength="500" rows="2">{t.beschreibung ?? ''}</textarea></label>
						<input type="hidden" name="nacharbeitFeld" value="1" />
						<label class="tl-haken"><input type="checkbox" name="nacharbeit" checked={t.nacharbeit} /> Nacharbeit (Fehler beheben, nachbessern)</label>
						<div class="tl-raster">
							<div class="ui-feld">
								Mitarbeiter
								<input type="hidden" name="mitarbeiterFeld" value="1" />
								<PersonWahl name="mitarbeiterIds" mehrfach label="Mitarbeiter" leerText="Nicht zugewiesen" {personen} werte={leute(t).map((m) => m.id)} />
							</div>
							<div class="ui-feld tl-zeitraum">
								{t.serie ? 'Fällig' : 'Tag oder Zeitraum'}
								<ZeitraumWahl faellig={t.faellig ?? ''} faelligZeit={t.faelligZeit ?? ''} vonTag={t.vonTag ?? ''} vonZeit={t.vonZeit ?? ''} nurTag={!!t.serie} />
							</div>
							<!-- Lautstärke/Schmutz nur bei Aufgaben im Auftrag (Jamil msg 3529); bei direkten Aufgaben bleiben alte Werte unberührt -->
							{#if t.auftragId}
								<label>
									Lautstärke
									<Auswahl name="lautstaerke">
										<option value="" selected={!t.lautstaerke}>–</option>
										{#each STUFEN as n (n)}<option value={String(n)} selected={t.lautstaerke === n}>{STUFE_NAMEN[n]}</option>{/each}
									</Auswahl>
								</label>
								<label>
									Schmutz
									<Auswahl name="schmutz">
										<option value="" selected={!t.schmutz}>–</option>
										{#each STUFEN as n (n)}<option value={String(n)} selected={t.schmutz === n}>{STUFE_NAMEN[n]}</option>{/each}
									</Auswahl>
								</label>
							{/if}
						</div>
						<div class="tl-knoepfe">
							<button type="button" class="kd-knopf hell" onclick={() => (aufgeklappt = null)}>Abbrechen</button>
							<button type="submit" class="kd-knopf">Speichern</button>
						</div>
					</form>
					<div class="tl-knoepfe">
						{#if t.serie?.aktiv && aktionen.serieBeenden}
							<form method="POST" action={aktionen.serieBeenden} use:enhance>
								<input type="hidden" name="id" value={t.id} />
								<button type="submit" class="kd-knopf hell">Wiederholung beenden</button>
							</form>
						{/if}
						<form
							method="POST"
							action={aktionen.loeschen}
							use:enhance
						>
							<input type="hidden" name="id" value={t.id} />
							<button type="submit" class="kd-knopf hell tl-loeschen" use:rueckfrage={`Aufgabe „${t.titel}“ wirklich löschen?`}>Löschen</button>
						</form>
					</div>
				{/if}
			</div>
		{/if}
	</li>
{/snippet}

{#if todos.length === 0}
	<p class="kd-leer">{leer}</p>
{:else}
	<ul class="tl-liste" aria-label="Offene Aufgaben">
		{#each offen as t (t.id)}{@render zeile(t)}{:else}<li class="kd-info tl-alle">Alles erledigt.</li>{/each}
	</ul>
	{#if erledigt.length > 0}
		<button type="button" class="tl-erledigt-knopf" aria-expanded={erledigteZeigen} onclick={() => (erledigteZeigen = !erledigteZeigen)}>
			{erledigteZeigen ? '▾' : '▸'} {erledigt.length} erledigt {erledigteZeigen ? 'ausblenden' : 'anzeigen'}
		</button>
		{#if erledigteZeigen}
			<ul class="tl-liste" aria-label="Erledigte Aufgaben">
				{#each erledigt as t (t.id)}{@render zeile(t)}{/each}
			</ul>
		{/if}
	{/if}
{/if}

<style>
	.tl-haken {
		display: flex !important;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		font-weight: 500 !important;
	}
	.tl-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.tl-zeile + .tl-zeile {
		border-top: 1px solid var(--m365-rand);
	}
	.tl-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
		padding: 0.25rem 0.75rem;
	}
	.tl-haken {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.tl-titel {
		/* Titel behält Platz; Mitarbeiter und Datum rutschen am Handy in die nächste Zeile */
		flex: 1 1 11rem;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.1rem 0.5rem;
		padding: 0.4rem 0;
		border: 0;
		background: none;
		color: var(--m365-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.tl-text {
		overflow-wrap: anywhere;
	}
	.tl-titel:hover .tl-text {
		text-decoration: underline;
	}
	.tl-serie {
		color: var(--m365-text-leise);
		font-size: 0.8125rem;
	}
	.erledigt .tl-text {
		color: var(--m365-text-leise);
		text-decoration: line-through;
	}
	.tl-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.4rem;
		flex: 0 1 auto;
		margin-left: auto;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--m365-text-leise);
	}
	.tl-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		max-width: 9rem;
		padding: 0.1rem 0.5rem 0.1rem 0.1rem;
		border-radius: 999px;
		background: var(--m365-flaeche-hover);
	}
	.tl-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tl-avatar {
		display: inline-grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		background: var(--m365-primaer);
		color: var(--ui-akzent-auf);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.tl-mehr {
		font-weight: 600;
	}
	.tl-wer {
		display: inline-flex;
		max-width: 100%;
	}
	.tl-wer :global(.pw-text) {
		max-width: 10rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tl-zeitraum {
		grid-column: 1 / -1;
	}
	.ueberfaellig .tl-faellig {
		color: var(--m365-fehler);
		font-weight: 600;
	}
	.tl-details {
		padding: 0 0.75rem 0.75rem 2.75rem;
		display: grid;
		gap: 0.5rem;
	}
	.tl-beschreibung {
		margin: 0;
		white-space: pre-wrap;
	}
	.tl-raster {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
	}
	.tl-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.tl-loeschen {
		color: var(--m365-fehler);
	}
	.tl-erledigt-knopf {
		margin: 0.5rem 0 0.25rem;
		padding: 0.4rem 0;
		border: 0;
		background: none;
		color: var(--ui-akzent-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.tl-alle {
		padding: 0.6rem 0.75rem;
	}
	@media (max-width: 30rem) {
		.tl-name {
			display: none;
		}
		.tl-chip {
			padding-right: 0.1rem;
		}
		.tl-details {
			padding-left: 0.75rem;
		}
	}
</style>
