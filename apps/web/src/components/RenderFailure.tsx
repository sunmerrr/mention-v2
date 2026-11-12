import type { FallbackProps } from "react-error-boundary";
import { Button, Callout } from "../design-system";

export function isChunkFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed/i.test(
      error.message,
    )
  );
}
export function PageRenderFailure({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  const update = isChunkFailure(error);
  return (
    <Callout.Root color="red" role="alert">
      <Callout.Text>
        {update
          ? "새 버전이 있어요. 새로고침해 주세요."
          : "화면을 표시하지 못했어요. 다시 시도해 주세요."}
        <Button
          intent="secondary"
          ml="3"
          onClick={update ? () => window.location.reload() : resetErrorBoundary}
        >
          {update ? "새로고침" : "다시 시도"}
        </Button>
      </Callout.Text>
    </Callout.Root>
  );
}
// The root fallback must work without the router, providers or theme.
export function GlobalRenderFailure() {
  return (
    <main role="alert">
      <h1>화면을 표시하지 못했어요.</h1>
      <p>새로고침 후 다시 시도해 주세요.</p>
      <button type="button" onClick={() => window.location.reload()}>
        새로고침
      </button>
    </main>
  );
}
