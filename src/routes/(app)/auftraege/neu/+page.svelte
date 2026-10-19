<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import AuftragFormular from '$lib/components/AuftragFormular.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const auswahl = $derived(form?.auswahl ?? { kunde: data.kunde, objekte: data.objekte });
	const zurueck = $derived(data.kunde ? `/kunden/${data.kunde.id}` : '/auftraege');
</script>

<svelte:head>
	<title>Neuer Auftrag</title>
</svelte:head>

<main class="kd-seite">
	<a href={zurueck} class="kd-zurueck">← {data.kunde ? data.kunde.name : 'Aufträge'}</a>
	<h1>Neuer Auftrag</h1>
	<AuftragFormular
		aktion="?/anlegen"
		werte={form?.werte ?? { ...data.vorbelegt, objektId: data.objekte.length === 1 ? data.objekte[0].id : '' }}
		kunde={auswahl.kunde}
		objekte={auswahl.objekte}
		kundenSuche={data.kundenSuche}
		mitarbeiter={data.mitarbeiter}
		zustaendige={form?.zustaendige ?? []}
		vorlagen={data.vorlagen}
		fehler={form?.fehler ?? null}
		knopf="Auftrag anlegen"
		abbrechen={zurueck}
	/>
</main>
