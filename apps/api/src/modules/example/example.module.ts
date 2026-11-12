import { Module } from '@nestjs/common';
import { ExampleRepository } from './example.repository.js';
import { ExampleService } from './example.service.js';

/**
 * 비즈니스 모듈 — 서비스만 제공(모든 역할이 DI 로 공유). 컨트롤러는 roles/ 에서 등록한다.
 * → deployment/single-image-roles.md
 */
@Module({
  providers: [ExampleService, ExampleRepository],
  exports: [ExampleService],
})
export class ExampleModule {}
