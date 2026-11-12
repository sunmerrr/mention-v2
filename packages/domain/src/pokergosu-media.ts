/** File caching is restricted to the board's own image hosts. */
const hosts = new Set([
  "www.pokergosu.com",
  "pokergosu.com",
  "www.ipokergosu.com",
  "ipokergosu.com",
]);
export function supportedPokergosuImage(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      hosts.has(url.hostname) &&
      !url.hash
    );
  } catch {
    return false;
  }
}
