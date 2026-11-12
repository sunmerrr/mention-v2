import { z } from 'zod';

/**
 * 공통 재사용 스키마. 검증 규칙은 한 곳에서 정의하고 프론트·백엔드·어드민이
 * 같은 출처를 참조한다. → api/04-validation-catalog.md
 */

// 쿼리 파라미터는 항상 string 이므로 coerce 로 변환한다.
export const cursorSchema = z.coerce.number().int().positive().optional();

export const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

export const paginationSchema = z.object({
  cursor: cursorSchema,
  limit: limitSchema,
});

export const utcDateSchema = z.string().datetime({ offset: false });
