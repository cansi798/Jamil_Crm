<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import { ABO_STATUS, ABO_STATUS_NAMEN, istAboStatus } from '$lib/abo';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const b = $derived(data.betrieb);
	const fehler = $derived(form && 'fehler' in form ? form.fehler : null);
	const gespeichert = $derived(form && 'gespeichert' in form && form.gespeichert === true);

	const tarifName = (schluessel: unknown) =>
		data.tarife.find((t) => t.schluessel === schluessel)?.name ?? String(schluessel ?? '–');
	const statusName = (s: unknown) => (istAboStatus(s) ? ABO_STATUS_NAMEN[s] : String(s ?? '–'));
	const tag = (wert: unknown) =>
		typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wert)
			? new Date(`${wert}T00:00:00Z`).toLocaleDateString('de-DE', {
					day: '2-digit',
					month: '2-digit',
					year: 'numeric',
					timeZone: 'UTC'
				})
			: 'kein Datum';
	const zeitpunkt = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleString('de-DE', {
					day: '2-digit',
					month: '2-digit',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Europe/Berlin'
				})
			: '–';

	/** „Tarif: Basis → Profi“ usw. für einen Protokolleintrag. */
	function aenderungen(details: Record<string, any>): string[] {
		const vorher = details.vorher ?? {};
		const nachher = details.nachher ?? {};
		const zeilen: string[] = [];
		if ('tarif' in nachher) zeilen.push(`Tarif: ${tarifName(vorher.tarif)} → ${tarifName(nachher.tarif)}`);
		if ('abo_status' in nachher) {
			zeilen.push(`Abo-Status: ${statusName(vorher.abo_status)} → ${statusName(nachher.abo_status)}`);
		}
		if ('abo_ende' in nachher) zeilen.push(`Abo-Ende: ${tag(vorher.abo_ende)} → ${tag(nachher.abo_ende)}`);
		if (details.sitzungen_beendet > 0) zeilen.push(`${details.sitzungen_beendet} Sitzung(en) beendet`);
		return zeilen;
	}
</script>

<svelte:head>
	<title>{b.name} – Plattform-Verwaltung</title>
</svelte:head>

<main class="ad-seite">
	<a href="/admin" class="ad-zurueck">← Alle Betriebe</a>
	<h1>{b.name}</h1>

	<dl class="ad-daten">
		<dt>Tarif</dt>
		<dd>{tarifName(b.tarif)}</dd>
		<dt>Abo-Status</dt>
		<dd><span class="ad-status {b.aboStatus}">{statusName(b.aboStatus)}</span></dd>
		<dt>Abo-Ende</dt>
		<dd>{tag(b.aboEnde)}</dd>
		<dt>Aktive Benutzer</dt>
		<dd>{b.benutzerAnzahl}</dd>
		<dt>Letzte Aktivität</dt>
		<dd>{zeitpunkt(b.letzteAktivitaet)}</dd>
	</dl>

	<section aria-labelledby="aendern">
		<h2 id="aendern">Tarif und Abo ändern</h2>
		<form method="POST" action="?/aendern" class="ad-formular" use:enhance>
			{#if fehler}
				<p role="alert" class="ad-fehler">{fehler}</p>
			{:else if gespeichert}
				<p role="status" class="ad-erfolg">Gespeichert.</p>
			{/if}
			<label>
				Tarif
				<Auswahl name="tarif">
					{#each data.tarife as t (t.schluessel)}
						<option value={t.schluessel} selected={t.schluessel === b.tarif}>{t.name}</option>
					{/each}
				</Auswahl>
			</label>
			<label>
				Abo-Status
				<Auswahl name="aboStatus">
					{#each ABO_STATUS as s (s)}
						<option value={s} selected={s === b.aboStatus}>{ABO_STATUS_NAMEN[s]}</option>
					{/each}
				</Auswahl>
			</label>
			<label>
				Abo-Ende (leer = kein Datum)
				<input type="date" name="aboEnde" value={b.aboEnde ?? ''} />
			</label>
			<p class="ad-info">„Gesperrt“ meldet alle Benutzer des Betriebs sofort ab; Anmelden ist dann nicht mehr möglich.</p>
			<button type="submit" class="ad-knopf">Speichern</button>
		</form>
	</section>

	<section aria-labelledby="verlauf">
		<h2 id="verlauf">Verlauf</h2>
		<ul class="ad-verlauf">
			{#each data.protokoll as e (e.id)}
				<li>
					<strong>{e.aktion === 'betrieb_angelegt' ? 'Betrieb angelegt' : 'Geändert'}</strong>
					<span class="ad-info">{zeitpunkt(e.zeit)} · {e.adminName ?? 'unbekannt'}</span>
					{#each aenderungen(e.details) as zeile (zeile)}
						<span>{zeile}</span>
					{/each}
				</li>
			{:else}
				<li class="ad-leer">Noch keine Einträge.</li>
			{/each}
		</ul>
	</section>
</main>
