import { useLocation } from "react-router-dom";

const menuPaths = new Set([
  "/",
  "/combined",
  "/pokergosu",
  "/posts",
  "/conversations",
  "/reviews",
  "/trends",
  "/briefing",
  "/messages",
  "/campaigns",
  "/responses",
  "/bookmarks",
  "/aliases",
  "/keywords",
  "/rooms",
  "/guide",
  "/operations",
  "/design-system",
]);
export function selectedMenu(pathname: string, search: string) {
  if (pathname.startsWith("/pokergosu/") || pathname.startsWith("/posts/")) {
    const origin = new URLSearchParams(search).get("nav");
    return origin && menuPaths.has(origin) ? origin : "/posts";
  }
  const workflow =
    pathname === "/reviews" ||
    pathname === "/episode" ||
    pathname === "/conversations" ||
    pathname.startsWith("/conversations/");
  const origin = new URLSearchParams(search).get("nav");
  if (workflow && origin && menuPaths.has(origin)) return origin;
  return menuPaths.has(pathname) ? pathname : "/conversations";
}
export function relatedHref(destination: string, origin: string) {
  const url = new URL(destination, "http://localhost");
  if (menuPaths.has(origin)) url.searchParams.set("nav", origin);
  return url.pathname + url.search;
}
export function useMenuOrigin() {
  const { pathname, search } = useLocation();
  return selectedMenu(pathname, search);
}
