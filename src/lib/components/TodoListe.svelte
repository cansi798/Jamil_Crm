<script lang="ts">
	import { enhance } from '$app/forms';
	import { tagDeutsch } from '$lib/zeit';
	import { STUFEN, STUFE_NAMEN, stufeName } from '$lib/stufen';

	type Todo = {
		id: string;
		titel: string;
		beschreibung?: string | null;
		lautstaerke?: number | null;
		schmutz?: number | null;
		serie?: { id: string; text: string; aktiv: boolean } | null;
		nachfassAngebotId?: string | null;
		zustaendigId: string | null;
		zustaendigName: string | null;
		faellig: string | null;
		faelligZeit?: string | null;
		erledigt: boolean;
	};

	/**
	 * To-dos im Auftrag als schlichte Liste (Wunsch Jamil, msg 2579): je Zeile Häkchen (erledigt), Titel, Zuständiger und
	 * Fälligkeit; Klick auf den Titel klappt Details und Bearbeiten auf. Erledigte stehen eingeklappt unten.
	 * (Die To-do-Seite behält ihr Board.)
	 */
	let {
		todos,
		heute,
		benutzerId,
		darfBearbeiten = false,
		mitarbeiter = [],
		aktionen,
		leer = 'Keine To-dos.'
	}: {
		todos: Todo[];
		heute: string;
		benutzerId: string;
		darfBearbeiten?: boolean;
		mitarbeiter?: { id: string; name: string }[];
		aktionen: { umschalten: string; aendern: string; loeschen: string; serieBeenden?: string };
		leer?: string;
	} = $props();

	const offen = $derived(
		todos.filter((t) => !t.erledigt).sort((a, b) => (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999'))
	);
	const erledigt = $derived(todos.filter((t) => t.erledigt));
	let erledigteZeigen = $state(false);
	let aufgeklappt = $state<string | null>(null);

	const ueberfaellig = (t: Todo) => !t.erledigt && t.faellig !== null && t.faellig < heute;
	const umschalten = (id: string) => (aufgeklappt = aufgeklappt === id ? null : id);
	// Nach dem Speichern zuklappen; Formular nicht leeren (Werte kommen frisch vom Server)
	const zuklappen = () => async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
		await update({ reset: false });
		if (result.type === 'success') aufgeklappt = null;
	};
</script>

{#snippet zeile(t: Todo)}
	{@const darfHaken = darfBearbeiten || t.zustaendigId === benutzerId}
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
			</button>
			<span class="tl-meta">
				{#if t.zustaendigName}
					<span class="tl-chip" title={t.zustaendigName}><span class="tl-avatar">{t.zustaendigName.charAt(0)}</span><span class="tl-name">{t.zustaendigName}</span></span>
				{/if}
				{#if t.faellig}<span class="tl-faellig">{tagDeutsch(t.faellig)}{t.faelligZeit ? ` ${t.faelligZeit}` : ''}</span>{/if}
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
				{#if t.nachfassAngebotId}<p><a href={`/angebote/${t.nachfassAngebotId}#nachfassen`}>Angebot und fertigen Mailtext öffnen</a></p>{/if}
				{#if darfBearbeiten}
					<form method="POST" action={aktionen.aendern} use:enhance={zuklappen} class="kd-formular tl-formular">
						<input type="hidden" name="id" value={t.id} />
						<label>Titel <input type="text" name="titel" maxlength="200" required value={t.titel} /></label>
						<label>Beschreibung <textarea name="beschreibung" maxlength="500" rows="2">{t.beschreibung ?? ''}</textarea></label>
						<div class="tl-raster">
							<label>
								Zuständig
								<select name="zustaendigId">
									<option value="" selected={!t.zustaendigId}>– niemand –</option>
									{#each mitarbeiter as m (m.id)}<option value={m.id} selected={m.id === t.zustaendigId}>{m.name}</option>{/each}
								</select>
							</label>
							<label>Fällig <input type="date" name="faellig" value={t.faellig ?? ''} /></label>
							<label>
								Lautstärke
								<select name="lautstaerke">
									<option value="" selected={!t.lautstaerke}>–</option>
									{#each STUFEN as n (n)}<option value={String(n)} selected={t.lautstaerke === n}>{STUFE_NAMEN[n]}</option>{/each}
								</select>
							</label>
							<label>
								Schmutz
								<select name="schmutz">
									<option value="" selected={!t.schmutz}>–</option>
									{#each STUFEN as n (n)}<option value={String(n)} selected={t.schmutz === n}>{STUFE_NAMEN[n]}</option>{/each}
								</select>
							</label>
						</div>
						<div class="tl-knoepfe">
							<button type="submit" class="kd-knopf">Speichern</button>
							<button type="button" class="kd-knopf hell" onclick={() => (aufgeklappt = null)}>Abbrechen</button>
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
							use:enhance={({ cancel }) => {
								if (!confirm(`To-do „${t.titel}“ löschen?`)) cancel();
							}}
						>
							<input type="hidden" name="id" value={t.id} />
							<button type="submit" class="kd-knopf hell tl-loeschen">Löschen</button>
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
	<ul class="tl-liste" aria-label="Offene To-dos">
		{#each offen as t (t.id)}{@render zeile(t)}{:else}<li class="kd-info tl-alle">Alles erledigt.</li>{/each}
	</ul>
	{#if erledigt.length > 0}
		<button type="button" class="tl-erledigt-knopf" aria-expanded={erledigteZeigen} onclick={() => (erledigteZeigen = !erledigteZeigen)}>
			{erledigteZeigen ? '▾' : '▸'} {erledigt.length} erledigt {erledigteZeigen ? 'ausblenden' : 'anzeigen'}
		</button>
		{#if erledigteZeigen}
			<ul class="tl-liste" aria-label="Erledigte To-dos">
				{#each erledigt as t (t.id)}{@render zeile(t)}{/each}
			</ul>
		{/if}
	{/if}
{/if}

<style>
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
		flex: 1 1 auto;
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
		align-items: center;
		gap: 0.4rem;
		flex: 0 0 auto;
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
