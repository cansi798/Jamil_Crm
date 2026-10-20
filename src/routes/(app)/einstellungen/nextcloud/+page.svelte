<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const fehlerFuer = (aktion: string, id?: string) =>
		form && 'fehler' in form && form.aktion === aktion && (id === undefined || ('id' in form && form.id === id))
			? form.fehler
			: null;
	const zeit = (iso: string) =>
		new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	const zahlen = (z: { geschrieben: number; geloescht: number; unveraendert: number; fehler: number } | undefined) =>
		z ? `${z.geschrieben} übertragen, ${z.geloescht} gelöscht, ${z.unveraendert} unverändert${z.fehler ? `, ${z.fehler} Fehler` : ''}` : '–';
</script>

<svelte:head>
	<title>Nextcloud</title>
</svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Nextcloud</h1>
			<p class="seiten-meta">Verbunden mit {data.url}</p>
		</div>
	</header>

	{#if !data.zustaendig}
		<p class="kd-info">Die Nextcloud-Anbindung dieses Servers gehört zu einem anderen Betrieb.</p>
	{:else}
		<section class="nc-karte">
			<h2>Was ist eingeschaltet?</h2>
			<ul class="nc-liste">
				<li>
					<strong>Mit Nextcloud anmelden:</strong>
					{#if data.teile.anmeldung}
						ja – {data.teile.zweiFaktorVertrauen
							? 'die Zwei-Faktor-Prüfung macht Nextcloud (keine zweite Abfrage im CRM)'
							: 'danach fragt das CRM zusätzlich seinen eigenen Bestätigungscode ab, wo er Pflicht ist'}{data.teile.perEmail
							? '; erste Anmeldung verknüpft automatisch über die bestätigte E-Mail'
							: ''}
					{:else}nein{/if}
				</li>
				<li><strong>Termine im Nextcloud-Kalender „CRM – Einsätze“:</strong> {data.teile.kalender ? 'ja' : 'nein'}</li>
				<li>
					<strong>Kunden im Adressbuch „CRM Kunden“:</strong>
					{data.teile.kontakte ? `ja${data.teile.kontakteGruppe ? ` (sichtbar für Gruppe „${data.teile.kontakteGruppe}“)` : ''}` : 'nein'}
				</li>
				<li>
					<strong>Fotos, Protokolle und Angebote als Dateien:</strong>
					{data.teile.dateien ? `ja (Ordner „${data.teile.ordner}/Kunden/…“)` : 'nein'}
				</li>
				<li><strong>Erinnerungen auch als Talk-Nachricht:</strong> {data.teile.talk ? 'ja' : 'nein'}</li>
			</ul>
			{#if data.teile.technik}
				<p class="kd-info">Übertragen wird mit dem Nextcloud-Konto „{data.teile.technik}“.</p>
			{/if}
			{#if data.letzter}
				<p class={data.letzter.ok ? 'kd-info' : 'kd-fehler'}>
					Letzter Abgleich {zeit(data.letzter.zeit)}{data.letzter.meldung ? `: ${data.letzter.meldung}` : ''}<br />
					Termine: {zahlen(data.letzter.termine)} · Kontakte: {zahlen(data.letzter.kontakte)} · Dateien: {zahlen(data.letzter.dateien)}
				</p>
			{/if}
			{#if data.darfAbgleichen && (data.teile.kalender || data.teile.kontakte || data.teile.dateien)}
				<form method="POST" action="?/abgleichen" use:enhance>
					{#if fehlerFuer('abgleichen')}<p role="alert" class="kd-fehler">{fehlerFuer('abgleichen')}</p>{/if}
					{#if form && 'laeuftSchon' in form && form.laeuftSchon}<p class="kd-info">Ein Abgleich läuft gerade schon.</p>{/if}
					<button type="submit" class="kd-knopf">Jetzt abgleichen</button>
				</form>
			{/if}
		</section>

		<section class="nc-karte">
			<h2>Konten verknüpfen</h2>
			<p class="kd-info">
				Tragen Sie bei jeder Person den Benutzernamen ein, mit dem sie sich bei Nextcloud anmeldet. Dann kann sie sich mit
				„Mit Nextcloud anmelden“ ins CRM einloggen und sieht ihre Termine im Nextcloud-Kalender. Neue CRM-Benutzer
				entstehen dadurch nie – die Person muss im CRM schon angelegt sein.
			</p>
			<div class="nc-huelle">
				<table class="nc-tabelle">
					<thead>
						<tr><th>Person</th><th>Nextcloud-Benutzer</th><th></th></tr>
					</thead>
					<tbody>
						{#each data.konten as b (b.benutzerId)}
							<tr>
								<td>
									{b.name}<br /><small>{b.email}{b.aktiv ? '' : ' · deaktiviert'}</small>
								</td>
								<td>
									<form method="POST" action="?/verknuepfen" use:enhance class="nc-zeile">
										<input type="hidden" name="id" value={b.benutzerId} />
										<input
											name="ncBenutzer"
											aria-label="Nextcloud-Benutzername von {b.name}"
											value={b.ncBenutzer ?? ''}
											maxlength="64"
											autocomplete="off"
											placeholder="z. B. Max Muster"
										/>
										<button type="submit" class="kd-knopf">Speichern</button>
									</form>
									{#if fehlerFuer('verknuepfen', b.benutzerId)}
										<p role="alert" class="kd-fehler">{fehlerFuer('verknuepfen', b.benutzerId)}</p>
									{/if}
									{#if b.ncBenutzer}
										<small>
											{b.art === 'email' ? 'automatisch über die E-Mail verknüpft' : 'von Hand verknüpft'}{b.zuletztAngemeldet
												? ` · zuletzt angemeldet ${zeit(b.zuletztAngemeldet)}`
												: ''}
										</small>
									{/if}
								</td>
								<td>
									{#if b.ncBenutzer}
										<form method="POST" action="?/loesen" use:enhance>
											<input type="hidden" name="id" value={b.benutzerId} />
											<button type="submit" class="kd-knopf">Lösen</button>
										</form>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</main>

<style>
	.nc-karte {
		margin: 1rem 0;
		padding: 1rem 1.25rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten);
	}
	.nc-karte h2 {
		margin: 0 0 0.75rem;
		font-size: 1.05rem;
	}
	.nc-huelle {
		overflow-x: auto;
	}
	.nc-tabelle {
		width: 100%;
		border-collapse: collapse;
	}
	.nc-tabelle th,
	.nc-tabelle td {
		text-align: left;
		padding: 0.6rem 0.5rem;
		vertical-align: top;
		border-bottom: 1px solid var(--m365-rand-stark);
	}
	.nc-liste {
		line-height: 1.7;
		padding-left: 1.2rem;
	}
	.nc-zeile {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.nc-zeile input {
		min-width: 10rem;
		flex: 1;
	}
</style>
