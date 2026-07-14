import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const kataGoServerUrl = env.KATAGO_SERVER_URL || 'http://localhost:3001';

  return {
    server: {
      proxy: {
        '/api': {
          target: kataGoServerUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
