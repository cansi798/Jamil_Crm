import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: '0.0.0.0',
		port: 3000
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		// Datenbank-Tests legen im beforeAll eine frische Datenbank mit allen Migrationen an – unter Last länger als die
		// üblichen 10 s (wächst mit jeder Migration)
		hookTimeout: 60_000
	}
});
