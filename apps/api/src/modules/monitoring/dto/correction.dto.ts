import { correctionSchema } from '@app/shared/monitoring/contracts/api';
import { createZodDto } from 'nestjs-zod';
export class CorrectionDto extends createZodDto(correctionSchema) {}
