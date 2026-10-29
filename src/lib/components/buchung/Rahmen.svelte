<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import PortalHuelle from '$lib/components/portal/PortalHuelle.svelte';
	import type { PortalMarke } from '$lib/portal-marke';
	import type { PortalLogo } from '$lib/portal-kopf';

	/**
	 * Rahmen der öffentlichen Buchungsseiten (Online-Buchung) – im Design des Kundenportals (STÄNDIGE Regel von Jamil,
	 * msg 3662): dieselbe Hülle `PortalHuelle` (Farben, Schriften, Kopf mit Logo, Karten, Knöpfe, Fuß), nur schmaler
	 * und mit „Online-Terminbuchung“ statt „Ihr Kundenportal“. Änderungen am Portal-Design kommen so automatisch hier an.
	 * Eingebettet (iframe) meldet die Seite ihre Höhe an die Website (postMessage `crm-buchung-hoehe`), damit das
	 * iframe ohne Scrollbalken mitwächst.
	 */
	let {
		betrieb,
		logoBasis,
		datenschutzUrl = null,
		children
	}: {
		betrieb: {
			name: string;
			telefon: string | null;
			email: string | null;
			web: string | null;
			logoStand: string;
			aussehen: { akzent: string | null; marke: PortalMarke; logo: PortalLogo | null };
		};
		/** z. B. `/buchen/<Token>/logo` */
		logoBasis: string;
		datenschutzUrl?: string | null;
		children: Snippet;
	} = $props();

	const a = $derived(betrieb.aussehen);
	const logo = $derived(a.logo ? { src: `${logoBasis}?variante=${a.logo.variante}&v=${betrieb.logoStand}`, feld: a.logo.feld } : null);

	let wurzel = $state<HTMLElement>();
	let eingebettet = $state(false);
	onMount(() => {
		if (window.parent === window || !wurzel) return;
		eingebettet = true;
		let letzte = 0;
		const melden = () => {
			const h = Math.ceil(document.documentElement.scrollHeight);
			if (Math.abs(h - letzte) < 2) return;
			letzte = h;
			window.parent.postMessage({ typ: 'crm-buchung-hoehe', hoehe: h }, '*');
		};
		const ro = new ResizeObserver(melden);
		ro.observe(wurzel);
		melden();
		return () => ro.disconnect();
	});
</script>

<PortalHuelle
	bind:element={wurzel}
	name={betrieb.name}
	akzent={a.akzent}
	marke={a.marke}
	{logo}
	untertitel="Online-Terminbuchung"
	breite="schmal"
	vollhoehe={!eingebettet}
	kontakt={{ telefon: betrieb.telefon, email: betrieb.email, web: betrieb.web, datenschutzUrl }}
>
	<main class="pt-inhalt bu-inhalt">
		{@render children()}
	</main>
</PortalHuelle>

<style>
	.bu-inhalt {
		display: grid;
		gap: 0.85rem;
		padding-top: 1.25rem;
		padding-bottom: 2rem;
	}
</style>
