import { createExampleSchema } from '@app/shared';
import { createZodDto } from 'nestjs-zod';

/**
 * DTO 는 packages/shared 의 zod 스키마를 그대로 재사용한다 — 프론트 폼과 동일 출처.
 * → api/04-validation-catalog.md
 * 검증 실패는 ZodValidationPipe → GlobalExceptionFilter 에서 VALIDATION_ERROR envelope.
 */
export class CreateExampleDto extends createZodDto(createExampleSchema) {}
