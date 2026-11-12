import { type MonitoringList, type MonitoringScope, monitoringIdSchema } from '@app/shared';
import { workspaceReads } from '@app/shared/monitoring/application/workspace';
import type { Correction } from '@app/shared/monitoring/contracts/api';
import { Injectable } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { ProjectionRepository } from '../projection/projection.repository.js';
import { MonitoringRepository } from './monitoring.repository.js';

@Injectable()
export class MonitoringService {
  constructor(
    private readonly repository: MonitoringRepository,
    private readonly projection: ProjectionRepository,
  ) {}
  async correct(input: Correction, scope: { local: boolean }) {
    if (input.origin === 'ai' && !scope.local)
      throw new AppError('FORBIDDEN', '로컬 AI 요청만 허용합니다.', 403);
    const result = await this.repository.write('/api/classifications/correct', input, scope);
    void this.projection.requestRefresh().catch(() => {});
    return result;
  }
  async action(action: string, input: Record<string, unknown>, scope: { local: boolean }) {
    const result = await this.repository.write(`/api/actions/${action}`, input, scope);
    void this.projection.requestRefresh().catch(() => {});
    return result;
  }
  overview(scope: MonitoringScope) {
    return config.MONITORING_READ_BACKEND === 'postgres'
      ? this.projection.overview(scope)
      : this.repository.read('/api/overview', scope);
  }
  conversations(query: MonitoringList) {
    return config.MONITORING_READ_BACKEND === 'postgres'
      ? this.projection.list(query)
      : this.repository.read('/api/conversations', query);
  }
  classifications(query: MonitoringList) {
    return this.repository.read('/api/classifications', query);
  }
  workspace(feature: string, params: Record<string, string>) {
    if (!Object.hasOwn(workspaceReads, feature))
      throw new AppError('NOT_FOUND', '없는 기능입니다.', 404);
    return this.repository.read(`/api/workspace/${feature}`, params);
  }
  options(id: string) {
    return this.repository.read(
      `/api/conversations/${monitoringIdSchema.parse(id)}/classifications`,
    );
  }
  asset(endpoint: string) {
    return this.repository.asset(endpoint);
  }
  detail(id: string) {
    const valid = monitoringIdSchema.parse(id);
    return this.repository.read(`/api/conversations/${encodeURIComponent(valid)}`);
  }
}
