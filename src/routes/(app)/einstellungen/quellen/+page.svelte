<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import AuftragsquelleEtikett from '$lib/components/AuftragsquelleEtikett.svelte';
	import { standardFarbe } from '$lib/farben';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const fehlerIn = (b: string) => (form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head>
	<title>Auftragsquellen</title>
</svelte:head>

<main class="kd-seite">
	<h1>Auftragsquellen</h1>
	<p class="kd-info">
		Woher kommen eure Aufträge? Bei jedem neuen Auftrag wird die Auftragsquelle gewählt; die <a href="/auswertung/quellen">Auswertung</a> zeigt, was
		jede Auftragsquelle bringt. Die Farbe erscheint als Etikett auf den Auftragskarten und in der Liste. Eine Auftragsquelle, die schon an
		Aufträgen hängt, wird beim Löschen nur ausgeschaltet.
	</p>
	{#if form && 'ergebnis' in form && form.ergebnis === 'deaktiviert'}
		<p class="kt-hinweis" role="status">Die Auftragsquelle hängt an Aufträgen und wurde deshalb nur ausgeschaltet.</p>
	{/if}

	<ol class="qu-liste" aria-label="Auftragsquellen">
		{#each data.quellen as q, i (q.id)}
			<li class:aus={!q.aktiv}>
				<form method="POST" action="?/speichern" use:enhance={ohneReset} class="qu-zeile">
					<input type="hidden" name="id" value={q.id} />
					<input type="color" name="farbe" value={q.farbe} class="qu-farbe" aria-label={`Farbe ${q.name}`} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
					<input type="text" name="name" value={q.name} maxlength="100" required aria-label={`Name ${q.name}`} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
					<AuftragsquelleEtikett name={q.name} farbe={q.farbe} />
					<label class="kd-haken">
						<input type="checkbox" name="aktiv" value="true" checked={q.aktiv} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
						<span>aktiv</span>
					</label>
					<input type="hidden" name="aktiv" value="false" />
					<span class="kd-info">{q.auftraege} Auftr.</span>
				</form>
				<div class="qu-knoepfe">
					{#if data.auftraggeber.length}
						<form method="POST" action="?/partner" use:enhance={ohneReset}>
							<input type="hidden" name="id" value={q.id} />
							<Auswahl name="partnerId" klein aria-label={`Auftraggeber für ${q.name}`} onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
								<option value="" selected={!data.zuordnung[q.id]}>Auftraggeber: –</option>
								{#each data.auftraggeber as p (p.id)}<option value={p.id} selected={data.zuordnung[q.id] === p.id}>→ {p.name}</option>{/each}
							</Auswahl>
						</form>
					{/if}
					<form method="POST" action="?/verschieben" use:enhance>
						<input type="hidden" name="id" value={q.id} />
						<button type="submit" name="richtung" value="hoch" class="kd-knopf hell klein" disabled={i === 0} aria-label={`${q.name} nach oben`}>↑</button>
						<button type="submit" name="richtung" value="runter" class="kd-knopf hell klein" disabled={i === data.quellen.length - 1} aria-label={`${q.name} nach unten`}>↓</button>
					</form>
					<form method="POST" action="?/loeschen" use:enhance>
						<input type="hidden" name="id" value={q.id} />
						<button type="submit" class="kd-knopf hell klein" aria-label={`${q.name} löschen`} use:rueckfrage={`Auftragsquelle „${q.name}“ wirklich löschen?`}>✕</button>
					</form>
				</div>
				{#if fehlerIn(q.id)}<p role="alert" class="kd-fehler">{fehlerIn(q.id)}</p>{/if}
			</li>
		{/each}
	</ol>

	<AddPanel label="Auftragsquelle hinzufügen" offen={!!fehlerIn('neu')}>
		{#snippet children(schliessen)}
			<form method="POST" action="?/speichern" use:enhance class="kd-formular">
				{#if fehlerIn('neu')}<p role="alert" class="kd-fehler">{fehlerIn('neu')}</p>{/if}
				<label>Name <input type="text" name="name" maxlength="100" required placeholder="z. B. Instagram" /></label>
				<label class="qu-farbwahl">Farbe <input type="color" name="farbe" value={standardFarbe('', data.quellen.length)} class="qu-farbe" /></label>
				<div class="qu-knoepfe">
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					<button type="submit" class="kd-knopf">Hinzufügen</button>
				</div>
			</form>
		{/snippet}
	</AddPanel>
</main>

<style>
	.qu-liste {
		list-style: none;
		margin: 1rem 0;
		padding: 0;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
	}
	.qu-liste li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
	}
	.qu-liste li + li {
		border-top: 1px solid var(--m365-rand);
	}
	.qu-liste li.aus input[type='text'] {
		color: var(--m365-text-leise);
	}
	.qu-zeile {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		flex: 1 1 18rem;
	}
	.qu-zeile input[type='text'] {
		width: auto !important;
		flex: 1 1 10rem;
	}
	.qu-farbe {
		width: 2.75rem !important;
		min-width: 2.75rem;
		height: 2.25rem;
		padding: 0.1rem !important;
		cursor: pointer;
	}
	.qu-farbwahl {
		display: flex !important;
		align-items: center;
		gap: 0.5rem;
	}
	.qu-knoepfe,
		.qu-knoepfe form {
		display: flex;
		gap: 0.35rem;
	}
</style>
