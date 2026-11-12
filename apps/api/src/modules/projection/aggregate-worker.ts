import { parentPort, workerData } from 'node:worker_threads';
import { type Dataset, koreanDay, summarize } from '@app/shared/monitoring/domain/model';

const dataset = workerData as Dataset;
const days = ['', ...new Set(dataset.conversations.map((item) => koreanDay(item.at)))];
const summaries = days.flatMap((day) =>
  ['', ...dataset.targets.map((target) => target.name)].map((target) => ({
    day,
    target,
    body: summarize(dataset, { day, target }),
  })),
);
parentPort?.postMessage(summaries);
