import { Injectable } from '@nestjs/common';

export interface Example {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface NewExample {
  name: string;
  description?: string;
}

/**
 * Repository — DB 접근 캡슐화. → api/01-layering.md
 *
 * 코어에는 DB 블록이 없으므로 인메모리 Map 으로 시연만 한다. DB 블록을 도입하면
 * 이 클래스의 구현만 Drizzle 쿼리로 교체하고 Service/Controller 는 그대로 둔다.
 * (Repository 는 SELECT/INSERT/UPDATE/DELETE 외 책임을 갖지 않는다 — 소유권 검사/상태 전이 금지.)
 */
@Injectable()
export class ExampleRepository {
  private readonly store = new Map<string, Example>();
  private seq = 0;

  async findById(id: string): Promise<Example | null> {
    return this.store.get(id) ?? null;
  }

  async list(): Promise<Example[]> {
    return [...this.store.values()];
  }

  async create(input: NewExample): Promise<Example> {
    this.seq += 1;
    const row: Example = {
      id: String(this.seq),
      name: input.name,
      description: input.description ?? null,
      createdAt: new Date().toISOString(),
    };
    this.store.set(row.id, row);
    return row;
  }
}
