/** JSON data must not terminate its script element or change when parsed back. */
export function serializeBootstrap(state: unknown) {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
