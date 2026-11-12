import type { CreateExampleInput } from '@app/shared';
import { apiClient } from './api.js';

/** 도메인별 함수는 apiClient 만 쓴다(fetch 직접 호출 금지). → frontend/api-client.md */

export interface Example {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export function listExamples() {
  return apiClient<Example[]>('/api/v1/examples');
}

export function getExample(id: string) {
  return apiClient<Example>(`/api/v1/examples/${id}`);
}

export function createExample(input: CreateExampleInput) {
  return apiClient<Example>('/api/v1/examples', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
