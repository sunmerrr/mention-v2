import { Injectable } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error.js';
import { type Example, ExampleRepository, type NewExample } from './example.repository.js';

/**
 * Service — 비즈니스 로직. → api/01-layering.md
 * DB 는 Repository 를 통해서만. HTTP 객체를 직접 만지지 않는다.
 * 비즈니스 예외는 AppError 로 throw → 전역 필터가 envelope 으로 변환.
 */
@Injectable()
export class ExampleService {
  constructor(private readonly exampleRepo: ExampleRepository) {}

  async getById(id: string): Promise<Example> {
    const found = await this.exampleRepo.findById(id);
    if (!found) {
      throw new AppError('EXAMPLE_NOT_FOUND', '대상을 찾을 수 없습니다.', 404);
    }
    return found;
  }

  async list(): Promise<Example[]> {
    return this.exampleRepo.list();
  }

  async create(input: NewExample): Promise<Example> {
    return this.exampleRepo.create(input);
  }
}
