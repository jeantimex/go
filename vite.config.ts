import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const kataGoServerUrl = env.KATAGO_SERVER_URL || 'http://localhost:3001';
  const apiProxy = {
    '/api': {
      target: kataGoServerUrl,
      changeOrigin: true,
    },
  };

  return {
    server: {
      proxy: apiProxy,
    },
    preview: {
      proxy: apiProxy,
    },
  };
});
