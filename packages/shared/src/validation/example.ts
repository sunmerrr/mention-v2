import { z } from 'zod';

/**
 * 샘플 공유 스키마 1개. 새 도메인을 추가할 때 이 파일을 복제해 규칙을 이곳에 모은다.
 * 같은 스키마를 백엔드 DTO(createZodDto)와 프론트 폼(zodResolver)이 함께 import 한다.
 */
export const createExampleSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(100, '이름은 100자 이하여야 합니다.'),
  description: z.string().trim().max(2000, '설명은 2000자 이하여야 합니다.').optional(),
});

export type CreateExampleInput = z.infer<typeof createExampleSchema>;

/** 검증 메타데이터(어드민 catalog 화면용). → api/04-validation-catalog.md */
export const EXAMPLE_VALIDATION_META = {
  name: {
    label: '이름',
    minLength: 1,
    maxLength: 100,
    notes: '샘플 도메인 필드. 실제 도메인 추가 시 교체.',
  },
} as const;
