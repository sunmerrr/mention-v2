import type {
  Classification,
  Correction,
  Detail,
} from "../../contracts/src/api";
import type { Dataset } from "../../domain/src/model";
export interface MonitoringReader {
  read(): Promise<Dataset>;
  detail(id: string): Promise<Detail>;
  classifications(): Promise<Classification[]>;
  refresh(): Promise<Dataset>;
}
export interface ClassificationWriter {
  correct(input: Correction): Promise<void>;
}
