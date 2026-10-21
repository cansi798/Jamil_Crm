<script lang="ts">
	import { farbStil } from '$lib/farbe';

	/**
	 * Passwort-Abfrage des Kundenportals (Jamil msg 3037) im Portal-Design: Kopf in der dunklen Farbe des Betriebs mit
	 * Akzentlinie, eine Karte mit einem Feld. Ein normales Formular (ohne JavaScript), das an /anmelden schickt.
	 */
	let {
		token,
		aussehen,
		anmeldung
	}: {
		token: string;
		aussehen: { name: string; farbe: string | null; dunkel: string | null; hintergrund: string | null };
		anmeldung: 'falsch' | 'gesperrt' | 'fehlt' | null;
	} = $props();

	const MELDUNG = {
		falsch: 'Das Passwort stimmt nicht. Bitte prüfen Sie Ihre Eingabe.',
		gesperrt: 'Zu viele Versuche – bitte warten Sie 15 Minuten und versuchen Sie es dann erneut.',
		fehlt: 'Der Zugang ist noch nicht eingerichtet – bitte wenden Sie sich an Ihren Handwerksbetrieb.'
	} as const;
	const stil = $derived(
		[farbStil(aussehen.farbe ?? '#c3a56f'), `--pt-dunkel: ${aussehen.dunkel ?? '#2d2c2e'}`, `--pt-grund: ${aussehen.hintergrund ?? '#f6f4f0'}`].join('; ')
	);
</script>

<svelte:head>
	<title>Kundenportal – {aussehen.name}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="pp" style={stil}>
	<header class="pp-kopf"><div class="pp-innen"><span class="pp-name">{aussehen.name}</span></div></header>
	<main class="pp-innen">
		<form class="pp-karte" method="POST" action={`/portal/${token}/anmelden`}>
			<h1>Ihr Kundenportal</h1>
			<label for="pp-passwort">Bitte geben Sie Ihr Passwort ein (Ihre Postleitzahl)</label>
			<input id="pp-passwort" name="passwort" type="password" autocomplete="current-password" required maxlength="200" />
			{#if anmeldung}<p class="pp-fehler" role="alert">{MELDUNG[anmeldung]}</p>{/if}
			<button type="submit" class="pp-knopf">Öffnen</button>
			<p class="pp-hinweis">Haben Sie ein eigenes Passwort von uns bekommen, geben Sie bitte dieses ein.</p>
		</form>
	</main>
</div>

<style>
	.pp {
		min-height: 100vh;
		background: var(--pt-grund);
		color: var(--ui-text, #2d2c2e);
		font-family: 'Inter', system-ui, sans-serif;
	}
	.pp-kopf {
		background: var(--pt-dunkel);
		color: #fff;
		border-bottom: 4px solid var(--ui-akzent);
	}
	.pp-innen {
		max-width: 28rem;
		margin: 0 auto;
		padding: 0 16px;
	}
	.pp-kopf .pp-innen {
		max-width: 72rem;
		padding-top: 1rem;
		padding-bottom: 1rem;
	}
	.pp-name {
		font-family: 'Montserrat', 'Inter', system-ui, sans-serif;
		font-weight: 700;
		font-size: 1.1rem;
	}
	.pp-karte {
		display: grid;
		gap: 0.75rem;
		margin-top: 2.5rem;
		padding: 1.5rem;
		border-radius: 12px;
		background: #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
	}
	h1 {
		margin: 0 0 0.25rem;
		font-family: 'Montserrat', 'Inter', system-ui, sans-serif;
		font-size: 1.35rem;
	}
	label {
		font-weight: 500;
	}
	input {
		min-height: 48px;
		padding: 0 0.9rem;
		border: 1px solid #d6d1c8;
		border-radius: 8px;
		font-size: 1.05rem;
	}
	.pp-knopf {
		min-height: 48px;
		border: 0;
		border-radius: 999px;
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
		font-family: 'Montserrat', 'Inter', system-ui, sans-serif;
		font-weight: 700;
		font-size: 1rem;
		cursor: pointer;
	}
	.pp-fehler {
		margin: 0;
		color: #b3261e;
		font-weight: 600;
	}
	.pp-hinweis {
		margin: 0;
		color: #6b6b6b;
		font-size: 0.875rem;
	}
</style>
