import {
  localActions,
  type WorkspaceAction,
  workspaceActions,
} from '@app/shared/monitoring/application/workspace';
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import { CorrectionDto } from './dto/correction.dto.js';
import { MonitoringListDto, MonitoringScopeDto } from './dto/monitoring-query.dto.js';
import { MonitoringService } from './monitoring.service.js';
import { mutationScope } from './mutation-scope.js';

@Controller('api/v1/monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Post('classifications/correct') correct(
    @Body() input: CorrectionDto,
    @Req() request: FastifyRequest,
  ) {
    return this.monitoring.correct(input, mutationScope(request));
  }
  @Post('actions/:action') action(
    @Param('action') action: string,
    @Body() input: unknown,
    @Req() request: FastifyRequest,
  ) {
    if (!(workspaceActions as readonly string[]).includes(action))
      throw new AppError('NOT_FOUND', '없는 작업입니다.', 404);
    const scope = mutationScope(request, localActions.has(action as WorkspaceAction));
    return this.monitoring.action(action, z.record(z.string(), z.unknown()).parse(input), scope);
  }
  @Get('workspace/:feature') workspace(
    @Param('feature') feature: string,
    @Query() query: Record<string, string>,
  ) {
    return this.monitoring.workspace(feature, query);
  }
  @Get('conversations/:id/classifications') options(@Param('id') id: string) {
    return this.monitoring.options(id);
  }
  @Get('overview') overview(@Query() query: MonitoringScopeDto) {
    return this.monitoring.overview(query);
  }
  @Get('conversations') conversations(@Query() query: MonitoringListDto) {
    return this.monitoring.conversations(query);
  }
  @Get('conversations/:id') detail(@Param('id') id: string) {
    return this.monitoring.detail(id);
  }
  @Get('classifications') classifications(@Query() query: MonitoringListDto) {
    return this.monitoring.classifications(query);
  }
}
