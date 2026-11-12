import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateExampleDto } from './dto/create-example.dto.js';
import { ExampleService } from './example.service.js';

/**
 * Controller — 얇게. HTTP 요청/응답만. → api/01-layering.md
 * envelope 은 ResponseInterceptor 가 자동으로 씌우므로 데이터만 반환한다.
 */
@Controller('api/v1/examples')
export class ExampleController {
  constructor(private readonly exampleService: ExampleService) {}

  @Get()
  list() {
    return this.exampleService.list();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.exampleService.getById(id);
  }

  @Post()
  create(@Body() dto: CreateExampleDto) {
    return this.exampleService.create(dto);
  }
}
