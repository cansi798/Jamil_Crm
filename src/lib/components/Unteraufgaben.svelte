<script lang="ts">
	/**
	 * Unteraufgaben einer Aufgabe (Jamil, Talk msg 3530): Haken, Titel, optional Person; neue Unteraufgabe unten anfügen,
	 * Entfernen mit Rückfrage. EIN Baustein für Aufgabenliste (Liste und Board) und Aufgaben im Auftrag.
	 */
	import { enhance } from '$app/forms';
	import { rueckfrage } from '$lib/rueckfrage';
	import Auswahl from './ui/Auswahl.svelte';

	type Unter = { id: string; titel: string; erledigt: boolean; benutzerId: string | null; benutzerName: string | null };
	let {
		todoId,
		todoTitel,
		liste,
		aktionen,
		darfBearbeiten = false,
		darfHaken = false,
		personen = []
	}: {
		todoId: string;
		todoTitel: string;
		liste: Unter[];
		aktionen: { unterNeu?: string; unterUmschalten?: string; unterLoeschen?: string };
		darfBearbeiten?: boolean;
		darfHaken?: boolean;
		personen?: { id: string; name: string }[];
	} = $props();
	const fertig = $derived(liste.filter((u) => u.erledigt).length);
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

{#if liste.length > 0 || (darfBearbeiten && aktionen.unterNeu)}
	<div class="ua" role="group" aria-label={`Unteraufgaben von „${todoTitel}“`} data-testid="unteraufgaben">
		<p class="ua-kopf">Unteraufgaben{#if liste.length > 0}<span class="ua-zahl">{fertig}/{liste.length}</span>{/if}</p>
		{#if liste.length > 0}
			<ul class="ua-liste">
				{#each liste as u (u.id)}
					<li class:erledigt={u.erledigt}>
						{#if (darfHaken || darfBearbeiten) && aktionen.unterUmschalten}
							<form method="POST" action={aktionen.unterUmschalten} use:enhance={ohneReset} class="ua-haken">
								<input type="hidden" name="id" value={u.id} />
								<input type="hidden" name="erledigt" value={u.erledigt ? 'nein' : 'ja'} />
								<button type="submit" class="ua-tipp" role="checkbox" aria-checked={u.erledigt} aria-label={u.titel}>
									<span class="ua-box" aria-hidden="true">{#if u.erledigt}✓{/if}</span>
								</button>
							</form>
						{:else}
							<span class="ua-box ruhig" aria-hidden="true">{#if u.erledigt}✓{/if}</span>
						{/if}
						<span class="ua-titel">{u.titel}{#if u.benutzerName}<span class="ua-person"> · {u.benutzerName}</span>{/if}</span>
						{#if darfBearbeiten && aktionen.unterLoeschen}
							<form method="POST" action={aktionen.unterLoeschen} use:enhance={ohneReset} use:rueckfrage={{ frage: `Unteraufgabe „${u.titel}“ wirklich entfernen?`, ja: 'Entfernen' }}>
								<input type="hidden" name="id" value={u.id} />
								<button type="submit" class="ua-weg" aria-label={`Unteraufgabe „${u.titel}“ entfernen`}>✕</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if darfBearbeiten && aktionen.unterNeu}
			<form method="POST" action={aktionen.unterNeu} use:enhance class="ua-neu">
				<input type="hidden" name="todoId" value={todoId} />
				<input type="text" name="titel" maxlength="200" required placeholder="Unteraufgabe hinzufügen …" aria-label={`Neue Unteraufgabe für „${todoTitel}“`} />
				{#if personen.length > 0}
					<Auswahl name="benutzerId" aria-label="Person (optional)">
						<option value="">ohne Person</option>
						{#each personen as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</Auswahl>
				{/if}
				<button type="submit" class="kd-knopf hell klein">+ Hinzufügen</button>
			</form>
		{/if}
	</div>
{/if}

<style>
	.ua {
		display: grid;
		gap: 0.35rem;
		margin-top: 0.4rem;
	}
	.ua-kopf {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ui-text-leise);
	}
	.ua-zahl {
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--ui-band, #f4f1ec);
		letter-spacing: 0;
	}
	.ua-liste {
		display: grid;
		gap: 0.1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.ua-liste li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.25rem;
		font-size: var(--ui-schrift-s);
	}
	.ua-liste li.erledigt .ua-titel {
		color: var(--ui-text-leise);
		text-decoration: line-through;
	}
	.ua-haken {
		display: contents;
	}
	/* Tippfläche 44 px, sichtbares Kästchen klein */
	.ua-tipp {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: 44px;
		height: 44px;
		margin: -0.2rem 0;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}
	.ua-box {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		margin: 0 0.6rem;
		padding: 0;
		border: 1.5px solid var(--ui-rand-stark, #b9b3a8);
		border-radius: 0.35rem;
		background: var(--ui-flaeche);
		color: var(--ui-gruen);
		font-size: 0.8rem;
		font-weight: 700;
	}
	.ua-tipp .ua-box {
		margin: 0;
	}
	.ua-titel {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.ua-person {
		color: var(--ui-text-leise);
	}
	.ua-weg {
		min-width: 44px;
		min-height: 44px;
		border: 0;
		background: none;
		color: var(--ui-text-leise);
		cursor: pointer;
	}
	.ua-weg:hover {
		color: var(--ui-rot);
	}
	.ua-neu {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.ua-neu input[type='text'] {
		flex: 1 1 12rem;
		min-width: 0;
	}
</style>
