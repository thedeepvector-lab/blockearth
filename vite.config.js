import { defineConfig } from 'vite';
// base './' lets the built site run from any folder or sub-path (GitHub Pages, Netlify, S3...).
export default defineConfig({ base: './', build: { target: 'es2020' }, worker: { format: 'es' } });
