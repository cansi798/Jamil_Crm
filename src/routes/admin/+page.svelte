<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import { ABO_STATUS_NAMEN, istAboStatus } from '$lib/abo';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const link = $derived(form && 'link' in form ? form.link : null);
	const fehler = $derived(form && 'fehler' in form ? form.fehler : null);
	/** Eingaben nach einem Fehler wieder anzeigen, nach Erfolg leeren. */
	const wert = (feld: 'name' | 'tarif' | 'chefEmail' | 'chefName') =>
		form && fehler && feld in form ? String((form as Record<string, unknown>)[feld] ?? '') : '';
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

	const tarifName = (schluessel: string) => data.tarife.find((t) => t.schluessel === schluessel)?.name ?? schluessel;
	const statusName = (s: string) => (istAboStatus(s) ? ABO_STATUS_NAMEN[s] : s);
	const datum = (wert: string | null) =>
		wert
			? new Date(wert.length === 10 ? `${wert}T00:00:00Z` : wert).toLocaleDateString('de-DE', {
					day: '2-digit',
					month: '2-digit',
					year: 'numeric',
					timeZone: wert.length === 10 ? 'UTC' : 'Europe/Berlin'
				})
			: '–';
</script>

<svelte:head>
	<title>Plattform-Verwaltung</title>
</svelte:head>

<main class="ad-seite">
	<h1>Betriebe</h1>
	<p class="ad-info">Hier stehen nur Verwaltungsdaten. Kundendaten der Betriebe sind nicht einsehbar.</p>

	<table class="ad-tabelle">
		<thead>
			<tr>
				<th scope="col">Betrieb</th>
				<th scope="col">Tarif</th>
				<th scope="col">Abo-Status</th>
				<th scope="col">Abo-Ende</th>
				<th scope="col">Benutzer</th>
				<th scope="col">Letzte Aktivität</th>
			</tr>
		</thead>
		<tbody>
			{#each data.betriebe as b (b.id)}
				<tr>
					<td class="ad-name" data-titel="Betrieb"><a href={`/admin/betriebe/${b.id}`}>{b.name}</a></td>
					<td data-titel="Tarif">{tarifName(b.tarif)}</td>
					<td data-titel="Abo-Status"><span class="ad-status {b.aboStatus}">{statusName(b.aboStatus)}</span></td>
					<td data-titel="Abo-Ende">{datum(b.aboEnde)}</td>
					<td data-titel="Benutzer">{b.benutzerAnzahl}</td>
					<td data-titel="Letzte Aktivität">{datum(b.letzteAktivitaet)}</td>
				</tr>
			{:else}
				<tr><td class="ad-leer ad-name" colspan="6">Noch keine Betriebe angelegt.</td></tr>
			{/each}
		</tbody>
	</table>

	<section aria-labelledby="neu">
		<h2 id="neu">Neuen Betrieb anlegen</h2>
		<p class="ad-info">
			Der Betrieb startet im Status „Test“ mit den Rollen Chef, Büro und Monteur. Für den Chef entsteht ein
			Einladungslink, den Sie selbst weitergeben – es wird keine E-Mail verschickt.
		</p>
		<form
			method="POST"
			action="?/anlegen"
			class="ad-formular"
			use:enhance={() => {
				kopiert = false;
				return async ({ update }) => update();
			}}
		>
			{#if fehler}
				<p role="alert" class="ad-fehler">{fehler}</p>
			{/if}
			<label>
				Name des Betriebs
				<input name="name" required maxlength="200" autocomplete="off" value={wert('name')} />
			</label>
			<label>
				Tarif
				<Auswahl name="tarif" required>
					{#each data.tarife as t (t.schluessel)}
						<option value={t.schluessel} selected={wert('tarif') === t.schluessel}>{t.name}</option>
					{/each}
				</Auswahl>
			</label>
			<label>
				Name des Chefs
				<input name="chefName" required maxlength="100" autocomplete="off" value={wert('chefName')} />
			</label>
			<label>
				E-Mail des Chefs
				<input type="email" name="chefEmail" required maxlength="254" autocomplete="off" value={wert('chefEmail')} />
			</label>
			<button type="submit" class="ad-knopf">Betrieb anlegen</button>
		</form>

		{#if link}
			<div class="ad-link" role="status">
				<p>Betrieb <strong>{form && 'name' in form ? form.name : ''}</strong> angelegt. Einladungslink für den Chef:</p>
				<input type="text" readonly value={link} aria-label="Einladungslink" onfocus={(e) => e.currentTarget.select()} />
				<button type="button" class="ad-knopf hell" onclick={kopieren}>{kopiert ? 'Kopiert ✓' : 'Link kopieren'}</button>
				<p class="ad-info">Der Link wird nur jetzt angezeigt, ist 7 Tage gültig und funktioniert nur einmal.</p>
			</div>
		{/if}
	</section>
</main>
