import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  intakeGaps,
  intakeOffsets,
  monitoringRooms,
  nativeStateRecords,
  nativeStateSnapshots,
  timelineState,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { PostgresBackups } from './postgres-backups.js';

const states = ['open', 'partial', 'recovered', 'legacy'];
@Injectable()
export class OperationsRepository {
  constructor(
    private readonly evidence: EvidenceRepository,
    private readonly backups: PostgresBackups,
  ) {}
  async read(params: Record<string, string>) {
    const page = z.coerce.number().int().min(1).max(100_000).default(1).parse(params.page);
    const backup = await this.backups.list();
    return this.evidence.db.transaction(
      async (tx) => {
        const [archive] = await tx
          .select({ pk: nativeStateSnapshots.pk })
          .from(timelineState)
          .innerJoin(nativeStateSnapshots, eq(nativeStateSnapshots.id, timelineState.snapshotId))
          .where(and(eq(timelineState.key, 'active'), eq(nativeStateSnapshots.complete, true)));
        if (!archive)
          throw new AppError('OPERATIONS_NOT_READY', '수집 상태 기록이 준비 중입니다.', 503);
        const [offset] = await tx
          .select({ updatedAt: intakeOffsets.updatedAt })
          .from(intakeOffsets)
          .where(eq(intakeOffsets.consumer, 'kakao-live-ingest'));
        const recent = !!offset && Date.now() - offset.updatedAt.getTime() < 45_000;
        const rows = await tx
          .select({
            body: nativeStateRecords.body,
            table: nativeStateRecords.tableName,
            room: monitoringRooms.body,
          })
          .from(nativeStateRecords)
          .leftJoin(
            monitoringRooms,
            sql`${monitoringRooms.roomId}=${nativeStateRecords.body}->>'room_id'`,
          )
          .where(
            and(
              eq(nativeStateRecords.snapshotPk, archive.pk),
              inArray(nativeStateRecords.tableName, [
                'collection_intervals',
                'collection_recoveries',
              ]),
            ),
          );
        const next = await tx
          .select()
          .from(intakeGaps)
          .where(eq(intakeGaps.consumer, 'kakao-live-ingest'))
          .orderBy(desc(intakeGaps.createdAt));
        const intervals: Record<string, unknown>[] = rows
          .filter((entry) => entry.table === 'collection_intervals')
          .map(({ body, room }) => ({ ...body, room: room?.name }));
        intervals.push(
          ...next.map((gap) => ({
            status: 'legacy',
            room: '연결 이벤트 스트림',
            start_at: gap.createdAt.toISOString(),
            end_at: null,
            reason: gap.reason,
            certainty: 'range_unknown',
          })),
        );
        intervals.sort((a, b) => Date.parse(String(b.start_at)) - Date.parse(String(a.start_at)));
        const recoveries = rows
          .filter((entry) => entry.table === 'collection_recoveries')
          .sort((a, b) => Date.parse(String(b.body.at)) - Date.parse(String(a.body.at)))
          .slice(0, 30)
          .map(({ body, room }) => ({ ...body, room: room?.name }));
        return {
          coverage: {
            counts: Object.fromEntries(
              states.map((status) => [
                status,
                intervals.filter((row) => row.status === status).length,
              ]),
            ),
            intervals: intervals.slice((page - 1) * 20, page * 20),
            total: intervals.length,
            page,
            pages: Math.max(1, Math.ceil(intervals.length / 20)),
            recoveries,
            note: '저장된 수집 구간과 확인한 복구 기록입니다.',
          },
          backup,
          health: recent
            ? {
                state: 'monitoring',
                label: '수집 중',
                reason: '최근 연결 이벤트 위치를 저장했습니다.',
              }
            : {
                state: 'unverified',
                label: '수집 확인 대기',
                reason: '최근 수집 위치가 확인되지 않았습니다.',
                action: 'Mention 수집 프로세스의 상태와 PostgreSQL 오류 기록을 확인합니다.',
              },
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
