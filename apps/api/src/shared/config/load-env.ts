import 'dotenv/config'; // 3순위: .env — 이미 설정된 키는 덮지 않음 (dotenv 기본 동작)
import { paginateGetParametersByPath, SSMClient } from '@aws-sdk/client-ssm';

/**
 * env 출처 폭포 — 어디서 오든 코드는 config 모듈만 본다.
 * → config/runtime-configuration.md "env 출처 폭포"
 *
 * 우선순위(위가 이김):
 *   1) AWS Parameter Store  — PARAMETER_STORE_PATH 가 있을 때만 로드
 *   2) 시스템(프로세스) env  — 컨테이너/배포 스택 주입
 *   3) .env (dotenv)         — 주로 로컬
 *
 * 이 함수는 zod 검증(config/index.ts) 이전에 main.ts 에서 await 로 먼저 호출한다.
 */
export async function loadEnv(): Promise<void> {
  const path = process.env.PARAMETER_STORE_PATH;
  if (!path) return; // Parameter Store 미사용 — env/.env 만으로 동작

  // 자격증명: 기본은 IAM Role. 필요 시에만 명시적 키(optional).
  const client = new SSMClient({
    region: process.env.AWS_REGION,
    ...(process.env.PARAMETER_STORE_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.PARAMETER_STORE_ACCESS_KEY,
            // biome-ignore lint/style/noNonNullAssertion: ACCESS_KEY 가 있으면 SECRET_KEY 도 함께 주어진다는 규약
            secretAccessKey: process.env.PARAMETER_STORE_SECRET_KEY!,
          },
        }
      : {}),
  });

  // GetParametersByPath(recursive + WithDecryption) → 1순위: 무조건 덮어씀
  const paginator = paginateGetParametersByPath(
    { client },
    { Path: path, Recursive: true, WithDecryption: true },
  );

  for await (const page of paginator) {
    for (const p of page.Parameters ?? []) {
      if (!p.Name) continue;
      const key = p.Name.slice(path.length).replace(/^\//, '').replaceAll('/', '_').toUpperCase();
      process.env[key] = p.Value;
    }
  }
}
