import type { FastifyRequest } from "fastify";

/** Headers can reduce privileges, never grant local privileges to a remote peer. */
export function isLocalRequest(request: FastifyRequest) {
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    request.ip,
  );
  return (
    loopback &&
    ![
      "cf-ray",
      "cf-connecting-ip",
      "x-forwarded-for",
      "forwarded",
      "x-monitor-public",
    ].some((key) => request.headers[key] !== undefined)
  );
}
