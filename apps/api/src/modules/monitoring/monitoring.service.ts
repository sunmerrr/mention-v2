import { type MonitoringList, type MonitoringScope, monitoringIdSchema } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { MonitoringRepository } from './monitoring.repository.js';

@Injectable()
export class MonitoringService {
  constructor(private readonly repository: MonitoringRepository) {}
  overview(scope: MonitoringScope) {
    return this.repository.read('/api/overview', scope);
  }
  conversations(query: MonitoringList) {
    return this.repository.read('/api/conversations', query);
  }
  classifications(query: MonitoringList) {
    return this.repository.read('/api/classifications', query);
  }
  detail(id: string) {
    const valid = monitoringIdSchema.parse(id);
    return this.repository.read(`/api/conversations/${encodeURIComponent(valid)}`);
  }
}
