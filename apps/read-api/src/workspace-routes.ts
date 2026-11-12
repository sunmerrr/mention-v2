import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  localActions,
  type WorkspaceAction,
  type WorkspaceFeature,
  type WorkspaceQueries,
  workspaceActions,
  workspaceReads,
} from "../../../packages/application/src/workspace";
import { isLocalRequest } from "./request-scope";

export { isLocalRequest } from "./request-scope";
export function registerWorkspace(
  app: FastifyInstance,
  queries: WorkspaceQueries,
  options: { origin: string; publicOrigin?: string; writesEnabled: boolean },
  invalidate: () => Promise<unknown>,
) {
  app.get<{ Params: { feature: string } }>(
    "/api/workspace/:feature",
    async (request, reply) => {
      if (!Object.hasOwn(workspaceReads, request.params.feature))
        return reply.code(404).send({
          success: false,
          data: null,
          error: { code: "NOT_FOUND", message: "없는 기능입니다." },
        });
      const search = new URL(request.url, options.origin).search.slice(1);
      return {
        success: true,
        data: await queries.read(
          request.params.feature as WorkspaceFeature,
          search,
          isLocalRequest(request),
        ),
        error: null,
      };
    },
  );
  app.post<{ Params: { action: string } }>(
    "/api/actions/:action",
    async (request, reply) => {
      const action = request.params.action as WorkspaceAction;
      const origin = request.headers.origin;
      if (!workspaceActions.includes(action))
        return reply.code(404).send({
          success: false,
          data: null,
          error: { code: "NOT_FOUND", message: "없는 작업입니다." },
        });
      if (
        !options.writesEnabled ||
        (origin !== options.origin &&
          (!options.publicOrigin || origin !== options.publicOrigin)) ||
        (localActions.has(action) &&
          (!isLocalRequest(request) || origin !== options.origin))
      )
        return reply.code(403).send({
          success: false,
          data: null,
          error: {
            code: "FORBIDDEN",
            message: localActions.has(action)
              ? "이 작업은 로컬 대시보드에서만 가능합니다."
              : "수정 권한이나 요청 출처를 확인해 주세요.",
          },
        });
      const input = z.record(z.string(), z.unknown()).parse(request.body);
      const result = await queries.action(
        action,
        input,
        isLocalRequest(request),
      );
      // Upstream writes are already committed. A failed read must not report a failed save.
      void invalidate().catch(() => {});
      return { success: true, data: result, error: null };
    },
  );
  for (const prefix of ["/download/*", "/photo/*", "/results.json"])
    app.get(prefix, async (request, reply) => {
      const result = z
        .object({
          binary: z.string(),
          contentType: z.string(),
          disposition: z.string().optional(),
        })
        .parse(await queries.asset(request.url));
      if (result.disposition)
        reply.header("Content-Disposition", result.disposition);
      return reply
        .type(result.contentType)
        .send(Buffer.from(result.binary, "base64"));
    });
}
