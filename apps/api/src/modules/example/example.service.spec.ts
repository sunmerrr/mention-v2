import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { ExampleRepository } from './example.repository.js';
import { ExampleService } from './example.service.js';

/**
 * 샘플 유닛 테스트 — Service 비즈니스 로직을 mock 주입으로 검증. → testing/01-unit.md
 * 에러는 메시지가 아니라 코드로 검증한다(메시지는 i18n 으로 바뀔 수 있음).
 */
describe('ExampleService', () => {
  let service: ExampleService;
  let repo: ExampleRepository;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExampleService,
        {
          provide: ExampleRepository,
          useValue: {
            findById: vi.fn(),
            list: vi.fn(),
            create: vi.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ExampleService);
    repo = moduleRef.get(ExampleRepository);
  });

  it('없는 id → EXAMPLE_NOT_FOUND (404)', async () => {
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(service.getById('nope')).rejects.toMatchObject({
      code: 'EXAMPLE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('AppError 로 throw 한다', async () => {
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(service.getById('nope')).rejects.toBeInstanceOf(AppError);
  });

  it('존재하면 그대로 반환', async () => {
    const row = { id: '1', name: 'a', description: null, createdAt: 'x' };
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    await expect(service.getById('1')).resolves.toEqual(row);
  });

  it('create 는 repository.create 를 호출한다', async () => {
    const row = { id: '1', name: 'a', description: null, createdAt: 'x' };
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    await service.create({ name: 'a' });
    expect(repo.create).toHaveBeenCalledWith({ name: 'a' });
  });
});
