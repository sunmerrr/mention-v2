// Explicit page allowlist prevents scanner paths from starting analytics reads.
const pages = new Set([
  "/",
  "/pokergosu",
  "/design-system",
  "/conversations",
  "/reviews",
  "/keywords",
  "/rooms",
  "/guide",
  "/messages",
  "/trends",
  "/campaigns",
  "/responses",
  "/briefing",
  "/bookmarks",
  "/aliases",
  "/operations",
  "/episode",
  "/conversation",
]);
export function isPagePath(pathname: string): boolean {
  return (
    pages.has(pathname) ||
    /^\/pokergosu\/[1-9][0-9]{0,18}$/.test(pathname) ||
    /^\/conversations\/[a-zA-Z0-9_-]+$/.test(pathname)
  );
}
