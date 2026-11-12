import { Module } from '@nestjs/common';
import { ExampleController } from '../modules/example/example.controller.js';
import { ExampleModule } from '../modules/example/example.module.js';

/**
 * 역할 모듈 — 컨트롤러/게이트웨이를 여기서 등록한다. → deployment/single-image-roles.md
 * APP_ROLE 에 'api'(또는 'all')가 있을 때만 app.module 이 이 모듈을 로드한다.
 * 비즈니스 서비스는 modules/ 에서 제공되고, 이 모듈은 컨트롤러만 얹는다.
 */
@Module({
  imports: [ExampleModule],
  controllers: [ExampleController],
})
export class ApiModule {}
