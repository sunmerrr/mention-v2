import { Global, Module } from '@nestjs/common';
import { SystemErrorService } from './system-error.service.js';

@Global()
@Module({ providers: [SystemErrorService], exports: [SystemErrorService] })
export class SystemErrorModule {}
