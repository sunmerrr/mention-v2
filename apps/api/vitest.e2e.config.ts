import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['test/e2e/**/*.e2e.spec.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 120000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // 코어에는 DB가 없으므로 globalSetup(testcontainers)을 켜지 않는다.
    // DB/Valkey 블록을 도입하면 아래 주석을 해제해 실제 컨테이너 위에서 e2e를 돌린다.
    // globalSetup: ['test/global-setup.ts'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
        keepClassNames: true,
      },
    }),
  ],
});
