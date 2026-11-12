import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// → frontend/build-and-runtime.md
// - manualChunks 안 씀(자동 분할). modulePreload 끔(라우트 lazy 정신).
// - 파일명은 hash 만(페이지명 노출 금지).
// - 환경 값은 빌드에 박지 않는다 — index.html placeholder 를 런타임에 치환.
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // dev/build 모두 shared 소스를 직접 참조(별도 사전 빌드 불필요).
      '@app/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  build: {
    modulePreload: false,
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[hash].js',
        entryFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4200', changeOrigin: true },
    },
  },
});
