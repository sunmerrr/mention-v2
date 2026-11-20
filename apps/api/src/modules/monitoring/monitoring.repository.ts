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
  constructor(@Inject(MONITORING_SOURCE) private readonly source: MonitoringSource) {
    this.source = { ...source, origin: new URL(source.origin).origin };
  }

  async write(endpoint: string, input: unknown, scope: { local: boolean }) {
    let response: Response;
    try {
      response = await fetch(new URL(endpoint, this.source.origin), {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
        headers: {
          'Content-Type': 'application/json',
          Origin: this.source.origin,
          ...(scope.local ? {} : { 'x-forwarded-for': '0.0.0.0' }),
        },
        body: JSON.stringify(input),
      });
    } catch {
      throw new AppError(
        'WRITE_UNCONFIRMED',
        '처리 결과를 확인하지 못했습니다. 같은 요청의 상태를 먼저 확인해 주세요.',
        503,
      );
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new AppError('WRITE_UNCONFIRMED', '처리 결과를 확인하지 못했습니다.', 502);
    }
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      !('success' in envelope) ||
      !('data' in envelope)
    )
      throw new AppError('WRITE_UNCONFIRMED', '처리 결과를 확인하지 못했습니다.', 502);
    if (!response.ok || envelope.success !== true) {
      const message =
        'error' in envelope &&
        envelope.error &&
        typeof envelope.error === 'object' &&
        'message' in envelope.error &&
        typeof envelope.error.message === 'string' &&
        response.status < 500
          ? envelope.error.message
          : '저장 결과를 확인하지 못했습니다.';
      throw new AppError('SOURCE_WRITE_FAILED', message, response.ok ? 502 : response.status);
    }
    return envelope.data;
  }

  async asset(endpoint: string) {
    const url = new URL(endpoint, this.source.origin);
    if (
      (!/^\/(photo|download)\//.test(url.pathname) && url.pathname !== '/results.json') ||
      url.origin !== this.source.origin
    )
      throw new AppError('INVALID_ASSET', '잘못된 파일 경로입니다.', 400);
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(this.source.timeoutMs),
      headers: { 'x-monitor-public': '1' },
    });
    if (!response.ok)
      throw new AppError(
        'ASSET_UNAVAILABLE',
        '파일을 가져오지 못했습니다.',
        response.status === 404 ? 404 : 503,
      );
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      disposition: response.headers.get('content-disposition'),
    };
  }

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
    } catch (cause) {
      throw new AppError(
        'MONITORING_UNAVAILABLE',
        '기존 모니터링 서버에 연결하지 못했습니다.',
        503,
        undefined,
        { cause },
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
