export type CollectionSource = "kakao" | "pokergosu";
export type SourceScopes = Record<CollectionSource, { disabled: string[] }>;
/** Update only explicitly supplied aliases in one source; preserve other scopes. */
export function updateSourceScope(
  scopes: SourceScopes,
  source: CollectionSource,
  aliases: string[],
  active: boolean,
): SourceScopes {
  const disabled = new Set(scopes[source].disabled);
  for (const alias of aliases) {
    if (active) disabled.delete(alias);
    else disabled.add(alias);
  }
  return { ...scopes, [source]: { disabled: [...disabled] } };
}
