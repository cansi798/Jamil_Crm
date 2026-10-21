<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';

	/**
	 * Rückfrage zum Löschen eines ganzen Datensatzes – direkt UNTER dem Seitenkopf, geöffnet vom `LoeschenKnopf`
	 * oben rechts (Jamil msg 3043, docs/design-regeln.md). Warnung, „Abbrechen“ und „Endgültig löschen“.
	 * Schlägt das Löschen fehl, bleibt die Rückfrage offen und zeigt den Fehler.
	 *
	 * Standard: Formular an `aktion` (`?/loeschen`) mit `use:enhance`. Seiten, die selbst per `fetch` löschen,
	 * geben `onbestaetigen` (dann kein Formular-Versand) und `arbeitet`.
	 */
	let {
		ding,
		offen = $bindable(false),
		fehler = null,
		aktion = '?/loeschen',
		onbestaetigen,
		arbeitet = false,
		felder,
		children,
		id = 'loeschen-oben',
		knopf = 'Endgültig löschen'
	}: {
		ding: string;
		offen?: boolean;
		/** Fehlermeldung der Lösch-Aktion – öffnet die Rückfrage */
		fehler?: string | null;
		aktion?: string;
		onbestaetigen?: () => void | Promise<void>;
		arbeitet?: boolean;
		/** versteckte Formularfelder */
		felder?: Snippet;
		/** Warnungstext */
		children?: Snippet;
		/** eigene id, wenn eine Seite mehrere Rückfragen hat (passend zu `LoeschenKnopf ziel`) */
		id?: string;
		/** Text des Bestätigungsknopfs, z. B. „Ja, entfernen“ */
		knopf?: string;
	} = $props();

	$effect(() => {
		if (fehler) offen = true;
	});
</script>

{#if offen}
	<section {id} class="lo-oben" aria-label={`${ding} löschen`}>
		<form
			method="POST"
			action={aktion}
			use:enhance
			class="lo-form"
			onsubmit={(e) => {
				if (onbestaetigen) {
					e.preventDefault();
					onbestaetigen();
				}
			}}
		>
			{#if fehler}
				<p role="alert" class="kd-fehler">{fehler}</p>
			{/if}
			{#if felder}{@render felder()}{/if}
			<p>
				{#if children}{@render children()}{:else}{ding} wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.{/if}
			</p>
			<div class="lo-knoepfe">
				<button type="button" class="kd-knopf hell" onclick={() => (offen = false)}>Abbrechen</button>
				<button type="submit" class="kd-knopf gefahr" disabled={arbeitet}>{knopf}</button>
			</div>
		</form>
	</section>
{/if}

<style>
	.lo-oben {
		margin: 0 0 1rem;
		padding: 1rem;
		border: 1px solid var(--ui-gefahr);
		border-radius: var(--ui-radius-karte, 0.75rem);
		background: var(--ui-gefahr-hell);
	}
	.lo-oben p {
		margin: 0 0 0.75rem;
	}
	.lo-oben .kd-fehler {
		margin-bottom: 0.75rem;
	}
	.lo-knoepfe {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
