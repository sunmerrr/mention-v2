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
import { isLocalRequest } from "./request-scope";
export function registerApi(
  app: FastifyInstance,
  reader: MonitoringReader,
  writer: ClassificationWriter,
  options: { origin: string; writesEnabled: boolean; publicOrigin?: string },
  projection?: MonitoringProjection,
) {
  const queries = new MonitoringQueries(reader, projection);
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      success: false,
      data: null,
      error: { code: "NOT_FOUND", message: "존재하지 않는 경로입니다." },
    }),
  );
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
    if (projection) await queries.refresh().catch(() => {});
    return { success: true, data: { saved: true }, error: null };
  });
  app.get<{ Params: { requestId: string } }>(
    "/api/classifications/request-state/:requestId",
    async (request, reply) => {
      if (
        !isLocalRequest(request) ||
        request.headers.origin !== options.origin ||
        request.headers["x-monitor-public"] === "1"
      )
        return reply.code(403).send({
          success: false,
          data: null,
          error: { message: "로컬 요청만 허용합니다." },
        });
      const id = z.string().uuid().parse(request.params.requestId);
      return {
        success: true,
        data: writer.requestStatus
          ? await writer.requestStatus(id)
          : { state: "unsupported" },
        error: null,
      };
    },
  );
  app.post("/api/classifications/ai-batch", async (request, reply) => {
    if (
      !options.writesEnabled ||
      !isLocalRequest(request) ||
      request.headers.origin !== options.origin ||
      request.headers["x-monitor-public"] === "1"
    )
      return reply.code(403).send({
        success: false,
        data: null,
        error: { message: "로컬 AI 분류 요청만 허용합니다." },
      });
    const inputs = z.array(correctionSchema).min(1).max(20).parse(request.body);
    if (inputs.some((input) => input.origin !== "ai"))
      return reply.code(400).send({
        success: false,
        data: null,
        error: { message: "AI 출처가 필요합니다." },
      });
    const results = [];
    for (const input of inputs) {
      try {
        await writer.correct(input);
        results.push({
          id: input.id,
          request_id: input.request_id,
          state: "saved",
        });
      } catch (error) {
        results.push({
          id: input.id,
          request_id: input.request_id,
          state: "not_saved",
          status: error instanceof UpstreamError ? error.status : 502,
          message: error instanceof Error ? error.message : "분류 저장 실패",
        });
      }
    }
    if (projection) await queries.refresh().catch(() => {});
    return { success: true, data: { results }, error: null };
  });
  return queries;
}
