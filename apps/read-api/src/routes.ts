import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ClassificationWriter,
  MonitoringProjection,
  MonitoringReader,
} from "../../../packages/application/src/ports";
import {
  InvalidCursor,
  MonitoringQueries,
} from "../../../packages/application/src/queries";
import {
  correctionSchema,
  listSchema,
  scopeSchema,
} from "../../../packages/contracts/src/api";
import { UpstreamError } from "./adapters/legacy";
export function registerApi(
  app: FastifyInstance,
  reader: MonitoringReader,
  writer: ClassificationWriter,
  options: { origin: string; writesEnabled: boolean; publicOrigin?: string },
  projection?: MonitoringProjection,
) {
  const queries = new MonitoringQueries(reader, projection);
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof z.ZodError || error instanceof InvalidCursor
        ? 400
        : error instanceof UpstreamError
          ? error.status
          : error instanceof Error &&
              "statusCode" in error &&
              typeof error.statusCode === "number"
            ? error.statusCode
            : 502;
    if (status >= 500)
      app.log.error(
        {
          event: "request_failed",
          errorType: error instanceof Error ? error.name : "unknown",
        },
        "Request failed",
      );
    reply.code(status).send({
      success: false,
      data: null,
      error: {
        code:
          status === 409
            ? "CONFLICT"
            : status === 400
              ? "INVALID_REQUEST"
              : "REQUEST_FAILED",
        message:
          error instanceof z.ZodError
            ? "필터나 입력 값을 확인해 주세요."
            : error instanceof InvalidCursor || error instanceof UpstreamError
              ? error.message
              : "데이터를 가져오지 못했습니다. 수집 서비스 연결을 확인해 주세요.",
      },
    });
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    return payload;
  });
  app.get("/api/overview", async (request) => ({
    success: true,
    data: await queries.overview(scopeSchema.parse(request.query)),
    error: null,
  }));
  app.get("/api/conversations", async (request) => ({
    success: true,
    data: await queries.conversations(listSchema.parse(request.query)),
    error: null,
  }));
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request) => ({
      success: true,
      data: await queries.detail(request.params.id),
      error: null,
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/classifications",
    async (request) => ({
      success: true,
      data: await queries.conversationClassifications(request.params.id),
      error: null,
    }),
  );
  app.get("/api/classifications", async (request) => ({
    success: true,
    data: await queries.classifications(listSchema.parse(request.query)),
    error: null,
  }));
  app.post("/api/refresh", async (request, reply) => {
    if (
      request.headers.origin !== options.origin &&
      (!options.publicOrigin || request.headers.origin !== options.publicOrigin)
    )
      return reply.code(403).send({
        success: false,
        data: null,
        error: { message: "허용되지 않은 요청입니다." },
      });
    await queries.refresh();
    return { success: true, data: { refreshed: true }, error: null };
  });
  app.post("/api/classifications/correct", async (request, reply) => {
    if (
      !options.writesEnabled ||
      (request.headers.origin !== options.origin &&
        (!options.publicOrigin ||
          request.headers.origin !== options.publicOrigin)) ||
      request.headers["x-monitor-public"] === "1"
    )
      return reply.code(403).send({
        success: false,
        data: null,
        error: { message: "현재 미리보기는 조회 전용입니다." },
      });
    const input = correctionSchema.parse(request.body);
    await writer.correct(input);
    if (projection) void queries.refresh().catch(() => {});
    return { success: true, data: { saved: true }, error: null };
  });
  return queries;
}
