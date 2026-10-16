<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const vergebbar = $derived(data.rollen.filter((r) => r.vergebbar));
	const link = $derived(form && 'link' in form ? form.link : null);
	const fehlerFuer = (aktion: string, id?: string) =>
		form && 'fehler' in form && form.aktion === aktion && (id === undefined || ('id' in form && form.id === id))
			? form.fehler
			: null;
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

<main>
	<h1>Benutzer</h1>

	<section aria-labelledby="einladen">
		<h2 id="einladen">Neue Person einladen</h2>
		<p class="hinweis">
			Sie erhalten einen Link, den Sie selbst weitergeben (z. B. per Messenger oder E-Mail). Er ist
			{data.einladungTage} Tage gültig und funktioniert nur einmal.
		</p>
		<form
			method="POST"
			action="?/einladen"
			use:enhance={() => {
				kopiert = false;
				return async ({ update }) => update();
			}}
		>
			{#if fehlerFuer('einladen')}
				<p role="alert" class="fehler">{fehlerFuer('einladen')}</p>
			{/if}
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
				<select name="rolleId" required>
					{#each vergebbar as rolle (rolle.id)}
						<option value={rolle.id}>{rolle.name}</option>
					{/each}
				</select>
			</label>
			<button type="submit" disabled={vergebbar.length === 0}>Einladungslink erstellen</button>
		</form>

		{#if link}
			<div class="link" role="status">
				<p>Einladung für <strong>{form && 'email' in form ? form.email : ''}</strong> erstellt:</p>
				<input type="text" readonly value={link} aria-label="Einladungslink" onfocus={(e) => e.currentTarget.select()} />
				<button type="button" onclick={kopieren}>{kopiert ? 'Kopiert ✓' : 'Link kopieren'}</button>
				<p class="hinweis">Der Link wird nur jetzt angezeigt.</p>
			</div>
		{/if}
	</section>

	<section aria-labelledby="offen">
		<h2 id="offen">Offene Einladungen</h2>
		{#if fehlerFuer('widerrufen')}
			<p role="alert" class="fehler">{fehlerFuer('widerrufen')}</p>
		{/if}
		<ul class="liste">
			{#each data.einladungen as e (e.id)}
				<li class="karte">
					<div>
						<strong>{e.email}</strong>
						<span class="info">{e.rolleName} · gültig bis {datum(e.laeuftAb)}</span>
					</div>
					<form method="POST" action="?/widerrufen" use:enhance>
						<input type="hidden" name="id" value={e.id} />
						<button type="submit" class="gefahr">Widerrufen</button>
					</form>
				</li>
			{:else}
				<li class="leer">Keine offenen Einladungen.</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby="alle">
		<h2 id="alle">Alle Benutzer</h2>
		<ul class="liste">
			{#each data.benutzer as b (b.id)}
				{@const rolleVergebbar = data.rollen.find((r) => r.id === b.rolleId)?.vergebbar ?? true}
				<li class="karte" class:inaktiv={!b.aktiv}>
					<div>
						<strong>{b.name}</strong>
						{#if b.id === data.ichId}<span class="info">(Sie)</span>{/if}
						<span class="info">{b.email}</span>
						<span class="info">{b.rolleName ?? 'Keine Rolle'} · {b.aktiv ? 'aktiv' : 'deaktiviert'}</span>
					</div>
					{#if fehlerFuer('aendern', b.id) || fehlerFuer('aktiv', b.id)}
						<p role="alert" class="fehler">{fehlerFuer('aendern', b.id) ?? fehlerFuer('aktiv', b.id)}</p>
					{/if}
					{#if rolleVergebbar}
						<form method="POST" action="?/aendern" use:enhance class="zeile">
							<input type="hidden" name="id" value={b.id} />
							<label class="unsichtbar" for={`rolle-${b.id}`}>Rolle von {b.name}</label>
							<select id={`rolle-${b.id}`} name="rolleId">
								{#each vergebbar as rolle (rolle.id)}
									<option value={rolle.id} selected={rolle.id === b.rolleId}>{rolle.name}</option>
								{/each}
							</select>
							<button type="submit">Rolle speichern</button>
						</form>
						{#if b.id !== data.ichId}
							<form method="POST" action="?/aktiv" use:enhance>
								<input type="hidden" name="id" value={b.id} />
								<input type="hidden" name="aktiv" value={b.aktiv ? 'false' : 'true'} />
								<button type="submit" class:gefahr={b.aktiv}>{b.aktiv ? 'Deaktivieren' : 'Wieder aktivieren'}</button>
							</form>
						{/if}
					{:else}
						<p class="hinweis">Nur mit dem Recht „Einstellungen verwalten“ änderbar.</p>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="hinweis">Deaktivierte Benutzer werden sofort abgemeldet und zählen nicht zur Benutzergrenze.</p>
	</section>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 1.5rem auto;
		padding: 0 1rem;
	}
	section {
		margin-bottom: 2rem;
	}
	form {
		display: grid;
		gap: 0.75rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	input,
	select,
	button {
		font: inherit;
		padding: 0.5rem;
		min-height: 2.75rem;
	}
	.liste {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.karte {
		display: grid;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid #c8c8c8;
		border-radius: 0.4rem;
	}
	.karte > div {
		display: grid;
		gap: 0.15rem;
	}
	.inaktiv {
		background: #f4f4f4;
		color: #555;
	}
	.zeile {
		grid-template-columns: 1fr auto;
		align-items: center;
	}
	.link {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.75rem;
		border: 1px solid #1b6e2d;
		border-radius: 0.4rem;
	}
	.link p {
		margin: 0;
	}
	.info {
		font-size: 0.9rem;
		color: #555;
	}
	.hinweis {
		font-size: 0.9rem;
		color: #555;
	}
	.leer {
		color: #555;
	}
	.fehler {
		color: #b00020;
		margin: 0;
	}
	.gefahr {
		color: #b00020;
	}
	.unsichtbar {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	@media (max-width: 30rem) {
		.zeile {
			grid-template-columns: 1fr;
		}
	}
</style>
