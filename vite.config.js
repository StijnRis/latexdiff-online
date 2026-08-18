import { defineConfig } from 'vite';

export default defineConfig({
  // Match the GitHub repository name (project Pages URL)
  base: '/latexdiff-online/',

  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },

  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },

  test: {
    environment: 'jsdom',
  },
});
