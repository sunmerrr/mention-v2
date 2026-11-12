import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PokergosuQueries } from "../../../packages/application/src/pokergosu";
import {
  pokergosuId,
  pokergosuListSchema,
} from "../../../packages/contracts/src/pokergosu";

export function registerPokergosu(
  app: FastifyInstance,
  queries: PokergosuQueries,
  origins: string[] = [],
) {
  app.get("/api/pokergosu", async (request) => ({
    success: true,
    data: await queries.list(pokergosuListSchema.parse(request.query)),
    error: null,
  }));
  app.get<{ Params: { id: string } }>(
    "/api/pokergosu/:id",
    async (request, reply) => {
      const data = await queries.detail(pokergosuId.parse(request.params.id));
      return data
        ? { success: true, data, error: null }
        : reply.code(404).send({
            success: false,
            data: null,
            error: {
              code: "NOT_FOUND",
              message: "저장된 게시글을 찾을 수 없습니다.",
            },
          });
    },
  );
  const keySchema = z.string().regex(/^[a-f0-9]{64}$/);
  app.get<{ Params: { key: string } }>(
    "/api/pokergosu/media/:key",
    async (request, reply) => {
      const file = await queries.cachedMedia(
        keySchema.parse(request.params.key),
      );
      if (!file)
        return reply.code(404).send({
          success: false,
          data: null,
          error: {
            code: "NOT_FOUND",
            message: "아직 보관된 이미지가 없습니다.",
          },
        });
      return reply
        .type(file.mime)
        .header("X-Content-Type-Options", "nosniff")
        .send(Buffer.from(file.bytes));
    },
  );
  app.post<{ Params: { id: string; key: string } }>(
    "/api/pokergosu/:id/media/:key",
    async (request, reply) => {
      if (!request.headers.origin || !origins.includes(request.headers.origin))
        return reply.code(403).send({
          success: false,
          data: null,
          error: { message: "허용되지 않은 이미지 요청입니다." },
        });
      return {
        success: true,
        data: await queries.loadMedia(
          pokergosuId.parse(request.params.id),
          keySchema.parse(request.params.key),
        ),
        error: null,
      };
    },
  );
}
