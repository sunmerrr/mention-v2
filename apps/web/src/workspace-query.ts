import { queryOptions } from "@tanstack/react-query";
import type {
  RecordData,
  WorkspaceFeature,
} from "../../../packages/application/src/workspace";
import { api } from "./queries";
export function routeFeature(path: string): WorkspaceFeature | undefined {
  const name = path.slice(1);
  return [
    "keywords",
    "rooms",
    "guide",
    "messages",
    "trends",
    "campaigns",
    "responses",
    "briefing",
    "bookmarks",
    "aliases",
    "operations",
    "episode",
  ].includes(name)
    ? (name as WorkspaceFeature)
    : undefined;
}
export const workspaceQuery = (feature: WorkspaceFeature, search: string) =>
  queryOptions({
    queryKey: ["workspace", feature, search],
    queryFn: () => api<RecordData>(`/api/workspace/${feature}${search}`),
  });
