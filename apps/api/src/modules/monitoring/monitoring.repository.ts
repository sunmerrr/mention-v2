import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error.js';

export const MONITORING_SOURCE = Symbol('MONITORING_SOURCE');
export interface MonitoringSource {
  origin: string;
  timeoutMs: number;
}

/** Read-only transition adapter. It never imports a collector SDK or sends mutations. */
@Injectable()
export class MonitoringRepository {
  constructor(@Inject(MONITORING_SOURCE) private readonly source: MonitoringSource) {}

  async read(
    endpoint: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<unknown> {
    const url = new URL(endpoint, this.source.origin);
    for (const [key, value] of Object.entries(params))
      if (value !== undefined) url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.source.timeoutMs),
        // The migration must never acquire local-only privileges at the source.
        headers: { 'x-monitor-public': '1' },
      });
    } catch {
      throw new AppError(
        'MONITORING_UNAVAILABLE',
        '기존 모니터링 서버에 연결하지 못했습니다.',
        503,
      );
    }
    if (!response.ok) {
      const status = [400, 403, 404, 409].includes(response.status) ? response.status : 503;
      throw new AppError('MONITORING_SOURCE_ERROR', '모니터링 조회를 완료하지 못했습니다.', status);
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new AppError(
        'MONITORING_INVALID_RESPONSE',
        '모니터링 응답 형식을 확인하지 못했습니다.',
        502,
      );
    }
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      !('success' in envelope) ||
      envelope.success !== true ||
      !('data' in envelope)
    )
      throw new AppError(
        'MONITORING_INVALID_RESPONSE',
        '모니터링 응답 형식을 확인하지 못했습니다.',
        502,
      );
    return envelope.data;
  }
}
