<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { rueckfrage } from '$lib/rueckfrage';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Knopf from '$lib/components/ui/Knopf.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import FormFuss from '$lib/components/ui/FormFuss.svelte';
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import type { ActionData, PageData } from './$types';

	/**
	 * „Handy verbinden“ (Jamil msgs 2964/2980): eigene Aufgaben mit der Erinnerungen-App (iPhone) bzw. DAVx⁵ + Tasks.org
	 * (Android) abgleichen – in beide Richtungen. Schritt für Schritt in einfacher Sprache, mit kleinen Bildern der
	 * Einstellungs-Seiten. Das App-Passwort erscheint genau einmal.
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props();
	let geraet = $state<'iphone' | 'android' | 'pc'>('iphone');
	let jeAuftrag = $state(false);
	$effect.pre(() => {
		jeAuftrag = data.jeAuftrag;
	});
	const neu = $derived(form && 'neu' in form ? form.neu : null);
	const fehlerIn = (b: string) => (form && 'bereich' in form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const datum = (iso: string | null) =>
		iso ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : 'noch nie';
	let kopiert = $state<string | null>(null);
	async function kopiere(was: string, wert: string) {
		try {
			await navigator.clipboard.writeText(wert);
			kopiert = was;
			setTimeout(() => (kopiert = null), 2000);
		} catch {
			kopiert = null;
		}
	}
</script>

<svelte:head><title>Handy verbinden</title></svelte:head>

<main class="kd-seite breit">
	<SeitenKopf info="handy.seite" titel="Handy verbinden" meta="Deine Aufgaben aus dem CRM in der Erinnerungen-App (iPhone) oder in Tasks.org (Android)" />

	<p class="kd-info ui-lesetext">
		Abhaken, umbenennen, neues Datum oder eine neue Aufgabe am Handy – alles kommt automatisch zurück ins CRM (und umgekehrt). Du siehst nur deine
		eigenen Aufgaben: die dir zugewiesen sind, die zu deinen Aufträgen gehören und eigene ohne Auftrag.
	</p>

	<Abschnitt titel="1. App-Passwort erstellen" id="hv-neu">
		{#if neu}
			<div class="hv-ergebnis" role="status">
				<p><strong>Fertig. Diese Angaben jetzt am Handy eintragen</strong> – das Passwort wird nur dieses eine Mal angezeigt.</p>
				<dl class="hv-daten">
					<dt>Server</dt>
					<dd><code>{data.host}</code> <button type="button" class="knopf-ghost klein" onclick={() => kopiere('server', data.host)}>{kopiert === 'server' ? 'kopiert' : 'kopieren'}</button></dd>
					<dt>Benutzername</dt>
					<dd><code>{data.email}</code> <button type="button" class="knopf-ghost klein" onclick={() => kopiere('name', data.email)}>{kopiert === 'name' ? 'kopiert' : 'kopieren'}</button></dd>
					<dt>Passwort</dt>
					<dd><code class="hv-passwort" data-testid="app-passwort">{neu.passwort}</code> <button type="button" class="knopf-ghost klein" onclick={() => kopiere('pw', neu.passwort)}>{kopiert === 'pw' ? 'kopiert' : 'kopieren'}</button></dd>
				</dl>
				<form method="POST" action="/konto/handy/profil" class="hv-profil">
					<input type="hidden" name="passwort" value={neu.passwort} />
					<p class="kd-info">Auf dem iPhone geht es noch einfacher: Diese Seite in Safari öffnen und das Profil laden – dann nur noch installieren.</p>
					<Knopf type="submit" art="sekundaer">Profil fürs iPhone laden</Knopf>
				</form>
			</div>
		{:else}
			<form method="POST" action="?/anlegen" use:enhance class="kd-formular">
				{#if fehlerIn('neu')}<p class="kd-fehler" role="alert">{fehlerIn('neu')}</p>{/if}
				<label>
					Name des Geräts *
					<input type="text" name="bezeichnung" maxlength="80" required placeholder="z. B. iPhone von Jamil" autocomplete="off" />
				</label>
				<p class="kd-info">Für jedes Handy ein eigenes App-Passwort. So kannst du ein verlorenes Handy einzeln entfernen.</p>
				<FormFuss><Knopf type="submit" symbol="plus">App-Passwort erstellen</Knopf></FormFuss>
			</form>
		{/if}
	</Abschnitt>

	<Abschnitt titel="2. Am Handy einrichten" id="hv-schritte">
		<div class="hv-umschalter">
			<Umschalter
				label="Gerät"
				eintraege={[
					{ wert: 'iphone', text: 'iPhone / iPad' },
					{ wert: 'android', text: 'Android' },
					{ wert: 'pc', text: 'PC (Thunderbird)' }
				]}
				aktiv={geraet}
				onwaehle={(w) => (geraet = w as typeof geraet)}
			/>
		</div>

		{#if geraet === 'iphone'}
			<ol class="hv-schritte">
				<li>
					<p>Öffne <strong>Einstellungen</strong> → <strong>Apps</strong> → <strong>Erinnerungen</strong> → <strong>Accounts</strong> → <strong>Account hinzufügen</strong>.</p>
					<p class="kd-info">Ältere iPhones: Einstellungen → Erinnerungen → Accounts → Account hinzufügen.</p>
					<div class="hv-handy" aria-hidden="true">
						<div class="hv-zeile">Erinnerungen <span>›</span></div>
						<div class="hv-zeile">Accounts <span>›</span></div>
						<div class="hv-zeile hv-markiert">Account hinzufügen <span>›</span></div>
					</div>
				</li>
				<li>
					<p>Ganz unten <strong>Andere</strong> tippen, dann <strong>CalDAV-Account hinzufügen</strong>.</p>
					<div class="hv-handy" aria-hidden="true">
						<div class="hv-zeile">iCloud</div>
						<div class="hv-zeile">Google</div>
						<div class="hv-zeile hv-markiert">Andere <span>›</span></div>
						<div class="hv-zeile hv-markiert">CalDAV-Account hinzufügen</div>
					</div>
				</li>
				<li>
					<p>Eintragen und auf <strong>Weiter</strong> tippen:</p>
					<div class="hv-handy" aria-hidden="true">
						<div class="hv-feld"><span>Server</span>{data.host}</div>
						<div class="hv-feld"><span>Benutzername</span>{data.email}</div>
						<div class="hv-feld"><span>Passwort</span>•••• (App-Passwort)</div>
						<div class="hv-feld"><span>Beschreibung</span>CRM Aufgaben</div>
					</div>
				</li>
				<li>
					<p>„Erinnerungen“ eingeschaltet lassen und <strong>Sichern</strong>. In der Erinnerungen-App erscheint die Liste <strong>„Meine Aufgaben (CRM)“</strong>.</p>
				</li>
			</ol>
			<p class="kd-info">
				Klappt es nicht? Unter „Erweiterte Einstellungen“ als Account-URL eintragen: <code>{data.kontoUrl}</code> (SSL an, Port 443).
			</p>
		{:else if geraet === 'android'}
			<ol class="hv-schritte">
				<li>
					<p>Aus dem Play Store (oder F-Droid) zwei Apps installieren: <strong>DAVx⁵</strong> (verbindet) und <strong>Tasks.org</strong> (zeigt die Aufgaben; jtx Board geht auch).</p>
				</li>
				<li>
					<p>DAVx⁵ öffnen, unten rechts auf <strong>+</strong> tippen und <strong>„Mit URL und Benutzername anmelden“</strong> wählen.</p>
					<div class="hv-handy" aria-hidden="true">
						<div class="hv-zeile">Mit E-Mail-Adresse anmelden</div>
						<div class="hv-zeile hv-markiert">Mit URL und Benutzername anmelden</div>
					</div>
				</li>
				<li>
					<p>Eintragen und <strong>Anmelden</strong>:</p>
					<div class="hv-handy" aria-hidden="true">
						<div class="hv-feld"><span>Basis-URL</span>{data.serverUrl}</div>
						<div class="hv-feld"><span>Benutzername</span>{data.email}</div>
						<div class="hv-feld"><span>Passwort</span>•••• (App-Passwort)</div>
					</div>
				</li>
				<li>
					<p><strong>Konto anlegen</strong> tippen, im Reiter <strong>CalDAV</strong> die Liste <strong>„Meine Aufgaben (CRM)“</strong> anhaken. Fragt DAVx⁵ nach der Aufgaben-App: Tasks.org wählen.</p>
				</li>
			</ol>
		{:else}
			<ol class="hv-schritte">
				<li><p>Thunderbird: <strong>Neuer Kalender</strong> → <strong>Im Netzwerk</strong> → Benutzername <code>{data.email}</code>, Adresse <code>{data.serverUrl}</code> → <strong>Kalender suchen</strong>.</p></li>
				<li><p>Beim Passwort das App-Passwort eingeben und „Meine Aufgaben (CRM)“ abonnieren. Die Aufgaben stehen dann unter „Aufgaben“.</p></li>
				<li><p>Outlook kann CalDAV nur mit einem Zusatzprogramm (z. B. „CalDav Synchronizer“) – dort dieselben Angaben.</p></li>
			</ol>
		{/if}

		<div class="hv-qr">
			<img src={data.qr} alt="QR-Code: diese Seite auf dem Handy öffnen" width="160" height="160" />
			<p class="kd-info">Mit der Handy-Kamera scannen, um diese Seite dort zu öffnen (zum Kopieren der Angaben oder für das iPhone-Profil).</p>
		</div>
	</Abschnitt>

	<Abschnitt titel="Verbundene Geräte" anzahl={data.geraete.length} id="hv-geraete">
		{#if fehlerIn('geraete')}<p class="kd-fehler" role="alert">{fehlerIn('geraete')}</p>{/if}
		{#if data.geraete.length === 0}
			<p class="kd-info">Noch kein Gerät verbunden.</p>
		{:else}
			<ul class="hv-liste" aria-label="Verbundene Geräte">
				{#each data.geraete as g (g.id)}
					<li>
						<div>
							<strong>{g.bezeichnung}</strong>
							<span class="kd-info">erstellt {datum(g.angelegt)} · zuletzt abgeglichen {datum(g.zuletztBenutzt)}</span>
						</div>
						<form method="POST" action="?/entfernen" use:enhance use:rueckfrage={{ frage: `Gerät „${g.bezeichnung}“ wirklich entfernen? Es gleicht dann nicht mehr ab.`, ja: 'Entfernen' }}>
							<input type="hidden" name="id" value={g.id} />
							<Knopf type="submit" art="gefahr" symbol="loeschen" klein aria-label={`${g.bezeichnung} entfernen`}>Entfernen</Knopf>
						</form>
					</li>
				{/each}
			</ul>
			<p class="kd-info">Entfernen sperrt das App-Passwort sofort – das Handy gleicht danach nichts mehr ab.</p>
		{/if}
	</Abschnitt>

	<Abschnitt titel="Listen" id="hv-listen">
		<form method="POST" action="?/listen" use:enhance={() => async ({ update }) => update({ reset: false })}>
			{#if fehlerIn('listen')}<p class="kd-fehler" role="alert">{fehlerIn('listen')}</p>{/if}
			<Schalter name="jeAuftrag" info="handy.je_auftrag" label="Für jeden Auftrag eine eigene Liste" hinweis="Aus: alles in „Meine Aufgaben (CRM)“. An: Aufgaben mit Auftrag in einer Liste je Auftrag." bind:an={jeAuftrag} />
			{#if form && 'gespeichert' in form}<p class="kd-info" role="status">Gespeichert. Das Handy zeigt die Listen beim nächsten Abgleich.</p>{/if}
			<FormFuss><Knopf type="submit" symbol="speichern">Speichern</Knopf></FormFuss>
		</form>
		<ul class="kd-info hv-hinweise">
			<li>Erledigte Aufgaben bleiben 30 Tage in der Liste.</li>
			<li>Wiederkehrende Aufgaben: am Handy steht immer der aktuelle Termin. Beim Abhaken legt das CRM den nächsten an.</li>
			<li>Wer Aufgaben im CRM nur abhaken darf, kann am Handy auch nur abhaken.</li>
		</ul>
	</Abschnitt>
</main>

<style>
	.hv-ergebnis {
		display: grid;
		gap: var(--ui-a3);
		padding: var(--ui-a3) var(--ui-a4);
		border: 1px solid var(--ui-akzent-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-akzent-zart);
	}
	.hv-ergebnis p {
		margin: 0;
	}
	.hv-daten {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--ui-a2) var(--ui-a4);
		margin: 0;
		align-items: center;
	}
	.hv-daten dt {
		color: var(--ui-text-leise, inherit);
		font-weight: 500;
	}
	.hv-daten dd {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--ui-a2);
		min-width: 0;
	}
	.hv-daten code {
		overflow-wrap: anywhere;
	}
	.hv-passwort {
		font-size: 1.15rem;
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.hv-profil {
		display: grid;
		gap: var(--ui-a2);
		justify-items: start;
	}
	.hv-umschalter {
		margin-bottom: var(--ui-a3);
	}
	.hv-schritte {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: var(--ui-a4);
		margin: 0;
		padding-left: 1.25rem;
	}
	.hv-schritte li p {
		margin: 0 0 var(--ui-a2);
	}
	/* Kleine Skizze der Einstellungs-Seite am Handy */
	.hv-handy {
		max-width: 16rem;
		padding: var(--ui-a2);
		border: 2px solid var(--ui-rand);
		border-radius: 1.25rem;
		background: var(--ui-hintergrund);
		font-size: var(--ui-schrift-s);
	}
	.hv-zeile,
	.hv-feld {
		display: flex;
		justify-content: space-between;
		gap: var(--ui-a2);
		padding: 0.45rem 0.6rem;
		background: var(--ui-flaeche);
		border-bottom: 1px solid var(--ui-rand);
		overflow-wrap: anywhere;
	}
	.hv-zeile:first-child,
	.hv-feld:first-child {
		border-radius: 0.6rem 0.6rem 0 0;
	}
	.hv-zeile:last-child,
	.hv-feld:last-child {
		border-radius: 0 0 0.6rem 0.6rem;
		border-bottom: 0;
	}
	.hv-feld span {
		flex: 0 0 6rem;
		font-weight: 600;
	}
	.hv-markiert {
		background: var(--ui-akzent-hell);
		font-weight: 600;
	}
	.hv-qr {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--ui-a4);
		margin-top: var(--ui-a4);
	}
	.hv-qr p {
		flex: 1 1 14rem;
		margin: 0;
	}
	.hv-liste {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.hv-liste li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--ui-a2);
		padding: var(--ui-a2) 0;
	}
	.hv-liste li + li {
		border-top: 1px solid var(--ui-rand);
	}
	.hv-liste li div {
		display: grid;
	}
	.hv-hinweise {
		margin: var(--ui-a3) 0 0;
		padding-left: 1.25rem;
	}
</style>
