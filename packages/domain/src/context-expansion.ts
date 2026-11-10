/** Completion of this explicit bounded lookup, not proof of all chat history. */
export function expansionFinished(result: {
  complete?: unknown;
  stop_reason?: unknown;
}) {
  return (
    result.complete === true &&
    (result.stop_reason === undefined ||
      result.stop_reason === "time_window_reached" ||
      result.stop_reason === "history_start" ||
      result.stop_reason === "no_more_messages")
  );
}
