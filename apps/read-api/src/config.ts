import { z } from "zod";

const environmentSchema = z.object({
  HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(970000),
  MENTION_BUILD_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]{1,100}$/)
    .default("development"),
  MENTION_RUNTIME_DIR: z.string().min(1).optional(),
  MENTION_LISTEN_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  MENTION_PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  MENTION_ENABLE_WRITES: z.enum(["0", "1"]).optional(),
  MENTION_LEGACY_URL: z.url().default("http://127.0.0.1:8766"),
});

// Deployment-file values remain the fallback; an explicit environment value wins.
export function readConfig(environment: NodeJS.ProcessEnv) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path[0])),
    ];
    throw new Error(`Invalid configuration fields: ${fields.join(", ")}`);
  }
  return {
    port: result.data.MENTION_PORT,
    keepAliveTimeoutMs: result.data.HTTP_KEEP_ALIVE_TIMEOUT_MS,
    buildId: result.data.MENTION_BUILD_ID,
    runtimeDir: result.data.MENTION_RUNTIME_DIR,
    listenHost: result.data.MENTION_LISTEN_HOST,
    writesEnabled:
      result.data.MENTION_ENABLE_WRITES === undefined
        ? undefined
        : result.data.MENTION_ENABLE_WRITES === "1",
    legacyUrl: result.data.MENTION_LEGACY_URL,
  };
}
