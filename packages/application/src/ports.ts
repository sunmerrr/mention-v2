import type {
  Classification,
  Correction,
  Detail,
  ListInput,
  OverviewPayload,
  Page,
} from "../../contracts/src/api";
import type { Conversation, Dataset, Scope } from "../../domain/src/model";
export interface MonitoringReader {
  read(): Promise<Dataset>;
  detail(id: string): Promise<Detail>;
  classifications(): Promise<Classification[]>;
  classificationOptions?(id: string): Promise<Classification[]>;
  refresh(): Promise<Dataset>;
}
export interface ClassificationWriter {
  correct(input: Correction): Promise<void>;
  requestStatus?(requestId: string): Promise<{ state: string }>;
}

export interface MonitoringProjection {
  overview(scope: Scope): Promise<OverviewPayload>;
  conversations(input: ListInput): Promise<Page<Conversation>>;
  info(): Promise<Pick<Dataset, "capturedAt" | "source">>;
  refresh(fresh?: boolean): Promise<unknown>;
}
