import { monitoringScopeSchema } from '@app/shared';
import { forumCorrectionSchema } from '@app/shared/monitoring/contracts/forum-opinions';
import { pokergosuId, pokergosuListSchema } from '@app/shared/monitoring/contracts/pokergosu';
import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import { mutationScope, requestOriginScope } from '../monitoring/mutation-scope.js';
import { ForumService } from './forum.service.js';
import { ForumMedia } from './forum-media.service.js';
@Controller('api/v1/monitoring')
export class ForumReadController {
  constructor(
    private readonly service: ForumService,
    private readonly media: ForumMedia,
  ) {}
  @Post('pokergosu/:id/reviews') save(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const input = forumCorrectionSchema.parse(body),
      scope = mutationScope(request);
    if (pokergosuId.parse(id) !== input.id || (input.origin === 'ai' && !scope.local))
      throw new AppError('FORBIDDEN', '허용되지 않은 분류 요청입니다.', 403);
    return this.service.save(input, scope);
  }
  @Get('pokergosu/media/:key') async mediaFile(
    @Param('key') key: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.media.file(
      z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(key),
    );
    if (!file) throw new AppError('NOT_FOUND', '아직 보관된 이미지가 없습니다.', 404);
    return reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('ETag', `"${file.digest}"`)
      .type(file.mime)
      .send(file.bytes);
  }
  @Post('pokergosu/:id/media/:key') loadMedia(
    @Param('id') id: string,
    @Param('key') key: string,
    @Req() request: FastifyRequest,
  ) {
    requestOriginScope(request);
    return this.media.request(
      pokergosuId.parse(id),
      z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(key),
    );
  }
  @Get('combined') combined(@Query() query: unknown) {
    return this.service.combined(monitoringScopeSchema.parse(query));
  }
  @Get('pokergosu/summary') summary() {
    return this.service.summary();
  }
  @Get('pokergosu') list(@Query() query: unknown) {
    return this.service.list(pokergosuListSchema.parse(query));
  }
  @Get('pokergosu/:id') async detail(@Param('id') id: string) {
    const detail = await this.service.detail(pokergosuId.parse(id));
    if (!detail) throw new AppError('NOT_FOUND', '저장된 게시글을 찾을 수 없습니다.', 404);
    return detail;
  }
}
