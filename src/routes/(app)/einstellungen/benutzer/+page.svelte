<script lang="ts">
	import { untrack } from 'svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { ANREDE_NAMEN } from '$lib/portal-figur';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const vergebbar = $derived(data.rollen.filter((r) => r.vergebbar));
	const link = $derived(form && 'link' in form ? form.link : null);
	const fehlerFuer = (aktion: string, id?: string) =>
		form && 'fehler' in form && form.aktion === aktion && (id === undefined || ('id' in form && form.id === id))
			? form.fehler
			: null;
	let neuOffen = $state(untrack(() => !!fehlerFuer('einladen')));
	let kopiert = $state(false);

	async function kopieren() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			kopiert = true;
		} catch {
			kopiert = false;
		}
	}

	const datum = (iso: string) =>
		new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
</script>

<svelte:head>
	<title>Benutzer</title>
</svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Benutzer</h1>
			<p class="seiten-meta">{data.benutzer.length} Benutzer · {data.einladungen.length} offene Einladungen</p>
		</div>
		<div class="seiten-aktionen">
			<button type="button" class="kd-knopf" aria-expanded={neuOffen} onclick={() => (neuOffen = !neuOffen)}>
				<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
				Person einladen
			</button>
		</div>
	</header>

	<AddPanel label="Person einladen" knopf={false} bind:offen={neuOffen}>
		{#snippet children(schliessen)}
			<p class="kd-info">
				Sie erhalten einen Link, den Sie selbst weitergeben (z. B. per Messenger oder E-Mail). Er ist
				{data.einladungTage} Tage gültig und funktioniert nur einmal.
			</p>
			<form
				method="POST"
				action="?/einladen"
				class="kd-formular"
				use:enhance={() => {
					kopiert = false;
					return async ({ update }) => update();
				}}
			>
				{#if fehlerFuer('einladen')}
					<p role="alert" class="kd-fehler">{fehlerFuer('einladen')}</p>
				{/if}
				<div class="kd-zwei">
					<label>
						E-Mail
						<input
							type="email"
							name="email"
							required
							maxlength="254"
							autocomplete="off"
							value={form && 'email' in form && !link ? form.email : ''}
						/>
					</label>
					<label>
						Rolle
						<Auswahl name="rolleId" required>
							{#each vergebbar as rolle (rolle.id)}
								<option value={rolle.id}>{rolle.name}</option>
							{/each}
						</Auswahl>
					</label>
				</div>
				<div class="knopf-reihe">
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					<button type="submit" class="kd-knopf" disabled={vergebbar.length === 0}>Einladungslink erstellen</button>
				</div>
			</form>
		{/snippet}
	</AddPanel>

	{#if link}
		<div class="bn-link" role="status">
			<p>Einladung für <strong>{form && 'email' in form ? form.email : ''}</strong> erstellt:</p>
			<div class="bn-link-zeile">
				<input type="text" readonly value={link} aria-label="Einladungslink" onfocus={(e) => e.currentTarget.select()} />
				<button type="button" class="kd-knopf" onclick={kopieren}>{kopiert ? 'Kopiert ✓' : 'Link kopieren'}</button>
			</div>
			<p class="kd-info">Der Link wird nur jetzt angezeigt.</p>
		</div>
	{/if}

	<Abschnitt titel="Offene Einladungen" id="offen" anzahl={data.einladungen.length}>
		{#if fehlerFuer('widerrufen')}
			<p role="alert" class="kd-fehler">{fehlerFuer('widerrufen')}</p>
		{/if}
		<ul class="kd-liste bn-liste">
			{#each data.einladungen as e (e.id)}
				<li class="bn-zeile">
					<div class="bn-wer">
						<strong>{e.email}</strong>
						<span class="kd-info">{e.rolleName} · gültig bis {datum(e.laeuftAb)}</span>
					</div>
					<form method="POST" action="?/widerrufen" use:enhance>
						<input type="hidden" name="id" value={e.id} />
						<button type="submit" class="kd-knopf gefahr">Widerrufen</button>
					</form>
				</li>
			{:else}
				<li class="kd-leer">Keine offenen Einladungen.</li>
			{/each}
		</ul>
	</Abschnitt>

	<Abschnitt titel="Alle Benutzer" id="alle" anzahl={data.benutzer.length}>
		<ul class="kd-liste bn-liste">
			{#each data.benutzer as b (b.id)}
				{@const rolleVergebbar = data.rollen.find((r) => r.id === b.rolleId)?.vergebbar ?? true}
				<li class="bn-zeile" class:inaktiv={!b.aktiv}>
					<Avatar name={b.name} groesse={34} />
					<div class="bn-wer">
						<strong>{b.name}{#if b.id === data.ichId} <span class="kd-info">(Sie)</span>{/if}</strong>
						<span class="kd-info">{b.email}</span>
						<span class="kd-info">{b.rolleName ?? 'Keine Rolle'} · {b.aktiv ? 'aktiv' : 'deaktiviert'}</span>
					</div>
					<!-- Anrede wählt die Comic-Figur im Kundenportal (Jamil msg 3113); speichert sofort beim Wählen -->
					<form method="POST" action="?/anrede" use:enhance={() => async ({ update }) => update({ reset: false })} class="bn-anrede">
						<input type="hidden" name="id" value={b.id} />
						<label class="kd-info" for={`anrede-${b.id}`}>Anrede</label>
						<Auswahl id={`anrede-${b.id}`} name="anrede" klein aria-label={`Anrede von ${b.name}`} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
							<option value="" selected={!b.anrede}>–</option>
							{#each Object.entries(ANREDE_NAMEN) as [wert, name] (wert)}
								<option value={wert} selected={b.anrede === wert}>{name}</option>
							{/each}
						</Auswahl>
						{#if form && 'gespeichert' in form && form.aktion === 'anrede' && 'id' in form && form.id === b.id}<span class="kd-info" role="status">gespeichert ✓</span>{/if}
					</form>
					{#if fehlerFuer('aendern', b.id) || fehlerFuer('aktiv', b.id) || fehlerFuer('anrede', b.id)}
						<p role="alert" class="kd-fehler bn-breit">{fehlerFuer('aendern', b.id) ?? fehlerFuer('aktiv', b.id) ?? fehlerFuer('anrede', b.id)}</p>
					{/if}
					{#if rolleVergebbar}
						<div class="bn-aktionen">
							<form method="POST" action="?/aendern" use:enhance class="bn-rolle">
								<input type="hidden" name="id" value={b.id} />
								<label class="unsichtbar" for={`rolle-${b.id}`}>Rolle von {b.name}</label>
								<Auswahl id={`rolle-${b.id}`} name="rolleId">
									{#each vergebbar as rolle (rolle.id)}
										<option value={rolle.id} selected={rolle.id === b.rolleId}>{rolle.name}</option>
									{/each}
								</Auswahl>
								<button type="submit" class="kd-knopf hell">Rolle speichern</button>
							</form>
							{#if b.id !== data.ichId}
								<form method="POST" action="?/aktiv" use:enhance>
									<input type="hidden" name="id" value={b.id} />
									<input type="hidden" name="aktiv" value={b.aktiv ? 'false' : 'true'} />
									<button type="submit" class={b.aktiv ? 'kd-knopf gefahr' : 'kd-knopf hell'}>{b.aktiv ? 'Deaktivieren' : 'Wieder aktivieren'}</button>
								</form>
							{/if}
						</div>
					{:else}
						<p class="kd-info">Nur mit dem Recht „Einstellungen verwalten“ änderbar.</p>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="kd-info">Deaktivierte Benutzer werden sofort abgemeldet und zählen nicht zur Benutzergrenze.</p>
		<p class="kd-info">
			Die Anrede bestimmt die gezeichnete Figur im Kundenportal: Projektbegleiter bzw. Projektbegleiterin, im Team
			Monteur bzw. Monteurin. Ohne Anrede erscheint die männliche Figur.
		</p>
	</Abschnitt>
</main>

<style>
	.bn-liste {
		margin: 0 0 0.75rem;
	}
	.bn-zeile {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--ui-rand);
	}
	.bn-zeile:last-child {
		border-bottom: 0;
	}
	.bn-zeile.inaktiv {
		color: var(--ui-text-leise);
	}
	.bn-wer {
		display: grid;
		gap: 0.1rem;
		min-width: 12rem;
		flex: 1 1 14rem;
	}
	.bn-anrede {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 0 0 auto;
	}
	.bn-breit {
		flex-basis: 100%;
	}
	.bn-aktionen,
	.bn-rolle {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.bn-rolle {
		flex-wrap: nowrap;
		flex: 1 1 16rem;
	}
	.bn-rolle select {
		flex: 1 1 auto;
		width: auto;
		min-width: 0;
	}
	.bn-rolle button {
		flex: none;
		white-space: nowrap;
	}
	.bn-aktionen {
		flex: 0 1 26rem;
	}
	.bn-link {
		display: grid;
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid #9fd89f;
		border-radius: var(--ui-radius-karte);
		background: #f1faf1;
	}
	.bn-link p {
		margin: 0;
	}
	.bn-link-zeile {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.5rem;
	}
</style>
