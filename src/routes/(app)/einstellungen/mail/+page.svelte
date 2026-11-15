<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const fehler = (aktion: string) => (form && 'fehler' in form && form.aktion === aktion ? form.fehler : null);
	const zeit = (iso: string) =>
		new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	const STATUS: Record<string, string> = { gesendet: 'gesendet', fehler: 'Fehler', wartet: 'wartet', kein_versand: 'nicht gesendet (kein Versand)' };
	const ART: Record<string, string> = {
		angebot: 'Angebot', ab: 'Auftragsbestätigung', rechnung: 'Rechnung', erinnerung: 'Zahlungserinnerung', mahnung: 'Mahnung',
		nachfassen: 'Nachfassen', protokoll: 'Protokoll', buchung: 'Terminbestätigung', test: 'Testmail', sonstiges: 'Sonstiges'
	};
</script>

<svelte:head>
	<title>E-Mail-Versand</title>
</svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>E-Mail-Versand</h1>
			<p class="seiten-meta"><span class="meta-text">Postfach, über das das CRM Angebote, Auftragsbestätigungen und Rechnungen verschickt</span><InfoFenster id="mail.seite" /></p>
		</div>
	</header>

	<section class="ml-karte" aria-label="Stand">
		{#if data.status.eingerichtet && data.status.aktiv && data.status.erlaubt}
			<p class="kd-info"><strong>Eingeschaltet.</strong> Mails gehen über {data.e.absenderAdresse} hinaus.</p>
		{:else}
			<p class="kd-info"><strong>Kein automatischer Versand.</strong> {data.status.grund} Bis dahin bereitet das CRM Mails nur vor (Aufgabe „bereit zum Versand“).</p>
		{/if}
		{#if data.status.fehler24h > 0}
			<p class="kd-fehler" role="alert">{data.status.fehler24h} Mail(s) mit Fehler in den letzten 24 Stunden{data.status.letzterFehler ? `: ${data.status.letzterFehler}` : ''}</p>
		{/if}
		{#if !data.geheimnisBereit}
			<p class="kd-fehler">Auf dem Server fehlt der Schlüssel für Zugangsdaten (CRM_GEHEIMNIS_SCHLUESSEL) – das Passwort lässt sich erst danach speichern.</p>
		{/if}
	</section>

	<section class="ml-karte">
		<h2>Postfach <InfoFenster id="mail.postfach" /></h2>
		<form method="POST" action="?/speichern" use:enhance={() => async ({ update }) => update({ reset: false })} class="ml-form">
			<div class="ml-felder">
				<label>Server (SMTP)<input name="host" value={data.e.host ?? ''} placeholder="z. B. smtp.ionos.de" maxlength="253" autocomplete="off" /></label>
				<label>Port<input name="port" type="number" min="1" max="65535" value={data.e.port ?? 587} /></label>
				<label>Verschlüsselung
					<select name="sicherheit" value={data.e.sicherheit}>
						<option value="starttls">STARTTLS (Port 587, empfohlen)</option>
						<option value="ssl">SSL/TLS (Port 465)</option>
						<option value="keine">keine (nur im eigenen Netz)</option>
					</select>
				</label>
				<label>Benutzername<input name="benutzer" value={data.e.benutzer ?? ''} maxlength="254" autocomplete="off" /></label>
				<label>Passwort
					<input name="passwort" type="password" autocomplete="new-password" maxlength="500" placeholder={data.e.passwortGesetzt ? `gespeichert (${data.e.passwortHinweis}) – leer lassen = bleibt` : 'Passwort des Postfachs'} />
				</label>
				<label>Absender-Name<input name="absenderName" value={data.e.absenderName ?? ''} maxlength="200" placeholder="z. B. Bauwelt Handwerk" /></label>
				<label>Absender-Adresse<input name="absenderAdresse" type="email" value={data.e.absenderAdresse ?? ''} maxlength="254" placeholder="buero@ihre-firma.de" /></label>
				<label>Antworten an (optional)<input name="antwortAn" type="email" value={data.e.antwortAn ?? ''} maxlength="254" /></label>
				<label>Kopie an (BCC, optional) <InfoFenster id="mail.bcc" /><input name="bcc" type="email" value={data.e.bcc ?? ''} maxlength="254" /></label>
			</div>
			{#if data.e.passwortGesetzt}
				<label class="ml-haken"><input type="checkbox" name="passwortLoeschen" /> Gespeichertes Passwort entfernen</label>
			{/if}
			<Schalter name="aktiv" an={data.e.aktiv} label="Mails über dieses Postfach versenden" info="mail.aktiv" hinweis="Aus: Das CRM bereitet Mails nur vor. An: Mails gehen direkt hinaus." />
			{#if fehler('speichern')}<p role="alert" class="kd-fehler">{fehler('speichern')}</p>{/if}
			{#if form && form.aktion === 'speichern' && 'gespeichert' in form}<p class="kd-info" role="status">Gespeichert.</p>{/if}
			<div><button type="submit" class="kd-knopf">Speichern</button></div>
		</form>
	</section>

	<section class="ml-karte">
		<h2>Testmail</h2>
		<form method="POST" action="?/testmail" use:enhance class="ml-zeile">
			<input name="an" type="email" aria-label="Testmail an" placeholder="ihre@adresse.de" maxlength="254" required />
			<button type="submit" class="kd-knopf hell">Testmail senden</button>
		</form>
		{#if fehler('testmail')}<p role="alert" class="kd-fehler">{fehler('testmail')}</p>{/if}
		{#if form && form.aktion === 'testmail' && 'ergebnis' in form}
			<p class={form.ergebnis === 'gesendet' ? 'kd-info' : 'kd-fehler'} role="status">
				{form.ergebnis === 'gesendet' ? 'Testmail gesendet – bitte im Postfach nachsehen.' : `Nicht gesendet: ${form.meldung ?? 'kein Versand'}`}
			</p>
		{/if}
	</section>

	<section class="ml-karte">
		<h2>Versandprotokoll <InfoFenster id="mail.protokoll" /></h2>
		{#if data.ausgang.length === 0}
			<p class="kd-info">Noch keine Mails.</p>
		{:else}
			<ul class="ml-liste">
				{#each data.ausgang as m (m.id)}
					<li>
						<span class="ml-zeit">{zeit(m.angelegt)}</span>
						<span>{ART[m.art] ?? m.art} an {m.an} – {m.betreff}</span>
						<span class={m.status === 'fehler' ? 'ml-fehler' : 'ml-status'}>{STATUS[m.status] ?? m.status}{m.fehler ? `: ${m.fehler}` : ''}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	.ml-karte {
		margin: 1rem 0;
		padding: 1rem 1.25rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten);
	}
	.ml-karte h2 {
		margin: 0 0 0.75rem;
		font-size: 1.05rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.ml-form {
		display: grid;
		gap: 0.9rem;
	}
	.ml-felder {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.75rem 1rem;
	}
	.ml-felder label {
		display: grid;
		gap: 0.25rem;
	}
	.ml-felder input,
	.ml-felder select,
	.ml-zeile input {
		min-width: 0;
	}
	.ml-zeile {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.ml-zeile input {
		flex: 1 1 14rem;
	}
	.ml-haken {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.ml-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.ml-liste li {
		display: grid;
		gap: 0.15rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--m365-rand-stark);
		overflow-wrap: anywhere;
	}
	.ml-zeit {
		font-size: 0.85rem;
		color: var(--m365-text-2, #555);
	}
	.ml-fehler {
		color: var(--m365-fehler, #a4262c);
	}
	.ml-status {
		font-size: 0.9rem;
	}
</style>
