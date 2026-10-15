<script lang="ts">
	import '$lib/stil/admin.css';

	let { children } = $props();
</script>

<header class="ad-kopf">
	<a href="/admin">Plattform-Verwaltung</a>
	<form method="POST" action="/api/abmelden">
		<button type="submit" class="ad-abmelden">Abmelden</button>
	</form>
</header>

{@render children()}
