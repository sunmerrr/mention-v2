import { monitoringListSchema, monitoringScopeSchema } from '@app/shared';
import { createZodDto } from 'nestjs-zod';
export class MonitoringScopeDto extends createZodDto(monitoringScopeSchema) {}
export class MonitoringListDto extends createZodDto(monitoringListSchema) {}
