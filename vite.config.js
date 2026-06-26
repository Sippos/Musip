import { defineConfig } from 'vite';

export default defineConfig({
  // Use relative paths so it works seamlessly on GitHub Pages regardless of repository name
  base: './',
  server: {
    // Forward stem-separation calls to the local Demucs backend so the browser
    // talks to it same-origin (see server/README.md).
    proxy: {
      '/api': 'http://localhost:8000',
    },
    // Don't watch the Python backend — its virtualenv holds thousands of files
    // and watching them exhausts the OS inotify limit (ENOSPC), crashing dev.
    watch: {
      ignored: ['**/server/**'],
    },
  },
});
