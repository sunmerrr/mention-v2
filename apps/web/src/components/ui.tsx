import { RefreshCw, TriangleAlert } from "lucide-react";
import type {
  Evaluation,
  Label,
  Origin,
} from "../../../../packages/domain/src/model";
import {
  Badge,
  Box,
  Button,
  Callout,
  Flex,
  Spinner,
  sentimentColors,
  Text,
} from "../design-system";
export const labels: Record<Label, string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
  mixed: "혼합",
  uncertain: "판단 보류",
  unreviewed: "미분류",
};
export function Sentiment({ label }: { label: Label }) {
  return (
    <Badge color={sentimentColors[label]} variant="soft">
      {labels[label]}
    </Badge>
  );
}
export function EvaluationStatus({ evaluation }: { evaluation: Evaluation }) {
  const previous = evaluation.previous;
  const label = previous?.label || evaluation.label;
  return (
    <Flex direction="column" gap="1" align="start">
      {evaluation.stale ? (
        <>
          <Badge color={sentimentColors[label]}>
            {label === "unreviewed"
              ? "기존 분류 확인 필요"
              : `기존 분류: ${labels[label]}`}
          </Badge>
          <Text size="1" color="amber">
            맥락 변경 · 재검토 필요
          </Text>
        </>
      ) : (
        <Sentiment label={label} />
      )}
      <OriginBadge origin={previous?.origin || evaluation.origin} />
    </Flex>
  );
}
export function OriginBadge({ origin }: { origin: Origin | null }) {
  return origin ? (
    <Text size="1" color="gray">
      {origin === "ai" ? "AI 확정" : "사람 평가"}
    </Text>
  ) : null;
}
export function Pending() {
  return (
    <Flex align="center" justify="center" gap="3" py="9" role="status">
      <Spinner />
      <Text color="gray" size="2">
        데이터를 불러오는 중입니다.
      </Text>
    </Flex>
  );
}
export function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => unknown;
}) {
  return (
    <Callout.Root color="red" my="4">
      <Callout.Icon>
        <TriangleAlert size={18} />
      </Callout.Icon>
      <Callout.Text>
        {error instanceof Error ? error.message : "조회에 실패했습니다."}
        {retry && (
          <Button
            variant="soft"
            color="red"
            size="1"
            ml="3"
            onClick={() => retry()}
          >
            <RefreshCw size={12} />
            다시 시도
          </Button>
        )}
      </Callout.Text>
    </Callout.Root>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Box py="8">
      <Text as="p" align="center" color="gray" size="2">
        {children}
      </Text>
    </Box>
  );
}
export function time(at: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}
