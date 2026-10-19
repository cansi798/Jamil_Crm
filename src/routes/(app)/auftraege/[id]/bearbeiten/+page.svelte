<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import AuftragFormular from '$lib/components/AuftragFormular.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const a = $derived(data.auftrag);
	const werte = $derived(
		form?.werte ?? {
			titel: a.titel,
			kundeId: a.kundeId,
			objektId: a.objektId ?? '',
			beschreibung: a.beschreibung ?? '',
			geplantAb: a.geplantAb ?? ''
		}
	) as Record<string, string>;
	const auswahl = $derived(form?.auswahl ?? { kunde: data.kunde, objekte: data.objekte });
</script>

<svelte:head>
	<title>{a.nummer} bearbeiten</title>
</svelte:head>

<main class="kd-seite">
	<a href={`/auftraege/${a.id}`} class="kd-zurueck">← {a.nummer}</a>
	<h1>Auftrag bearbeiten</h1>
	<AuftragFormular
		aktion="?/speichern"
		{werte}
		kunde={auswahl.kunde}
		objekte={auswahl.objekte}
		kundenSuche={data.kundenSuche}
		vorlagen={data.vorlagen}
		todosZusaetzlich
		fehler={form?.fehler ?? null}
		knopf="Speichern"
		abbrechen={`/auftraege/${a.id}`}
	/>
</main>
