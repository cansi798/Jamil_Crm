<script lang="ts">
	/**
	 * Kopf des Kundenportals – gleich auf der Portal-Seite und der Passwort-Abfrage (Jamil msgs 3087/3088, 3126):
	 * Logo groß, daneben klein „Ihr Kundenportal“; kein Firmenname (steht im Logo, im Seitentitel und im Alt-Text),
	 * keine Telefonnummer, keine Linie darunter. Welches Logo passt, entscheidet die Kopffarbe (`portalLogo`): auf hellem
	 * Kopf das normale Logo, auf dunklem die helle Variante – ein Feld nur, wenn es die passende Variante nicht gibt.
	 * Ohne Logo steht der Firmenname da. Farbe des Kopfs: `--pt-dunkel` vom Elternelement.
	 */
	let {
		name,
		logo,
		hell,
		klasse = ''
	}: {
		name: string;
		logo: { src: string; feld: 'weiss' | 'dunkel' | null } | null;
		/** Kopffarbe ist hell → dunkle Schrift */
		hell: boolean;
		/** zusätzliche Klasse (Portal-Seite: `pt-kopf`, daran erkennen die Tests das angemeldete Portal) */
		klasse?: string;
	} = $props();
</script>

<header class="pk {klasse}" class:hell>
	<div class="pk-innen">
		{#if logo}
			<span class="pk-logo" class:feld-weiss={logo.feld === 'weiss'} class:feld-dunkel={logo.feld === 'dunkel'}>
				<img src={logo.src} alt={`Logo ${name}`} />
			</span>
			<span class="pk-portal">Ihr Kundenportal</span>
		{:else}
			<span class="pk-firma">
				<small>Ihr Kundenportal</small>
				<strong>{name}</strong>
			</span>
		{/if}
	</div>
</header>

<style>
	.pk {
		background: var(--pt-dunkel, #2d2c2e);
		color: #fff;
	}
	.pk-innen {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		max-width: 72rem;
		min-height: 4.5rem;
		margin: 0 auto;
		padding: 0.6rem 16px;
	}
	.pk-logo {
		display: grid;
		place-items: center;
		min-width: 0;
	}
	.pk-logo img {
		display: block;
		max-height: 3.25rem;
		max-width: min(13rem, 52vw);
		object-fit: contain;
	}
	/* nur, wenn die passende Variante fehlt: Feld, damit das Logo lesbar bleibt */
	.pk-logo.feld-weiss,
	.pk-logo.feld-dunkel {
		padding: 0.3rem 0.55rem;
		border-radius: 8px;
	}
	.pk-logo.feld-weiss {
		background: #fff;
	}
	.pk-logo.feld-dunkel {
		background: #2d2c2e;
	}
	.pk-logo:is(.feld-weiss, .feld-dunkel) img {
		max-height: 2.75rem;
	}
	.pk-portal {
		padding-left: 0.9rem;
		border-left: 1px solid rgb(255 255 255 / 0.28);
		color: var(--ui-akzent, #c3a56f);
		font-family: var(--pt-titel, 'Montserrat', 'Inter', system-ui, sans-serif);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		line-height: 1.35;
		text-transform: uppercase;
	}
	.pk-firma {
		display: grid;
		min-width: 0;
	}
	.pk-firma small {
		color: var(--ui-akzent, #c3a56f);
		font-family: var(--pt-titel, 'Montserrat', 'Inter', system-ui, sans-serif);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.pk-firma strong {
		overflow: hidden;
		color: inherit;
		font-family: var(--pt-titel, 'Montserrat', 'Inter', system-ui, sans-serif);
		font-size: 1rem;
		text-transform: var(--pt-gross, none);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	/* heller Kopf: dunkle Schrift, Akzent als lesbarer Text */
	.pk.hell {
		color: var(--ui-text, #2d2c2e);
	}
	.pk.hell :is(.pk-portal, .pk-firma small) {
		color: var(--ui-akzent-text, #7f6b48);
	}
	.pk.hell .pk-portal {
		border-left-color: rgb(0 0 0 / 0.15);
	}
	@media (min-width: 641px) {
		.pk-innen {
			min-height: 5.25rem;
		}
		.pk-logo img {
			max-height: 3.75rem;
			max-width: 16rem;
		}
		.pk-portal {
			font-size: 0.75rem;
		}
	}
</style>
