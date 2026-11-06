import {
  Badge,
  Box,
  Button,
  Callout,
  Flex,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { RefreshCw, TriangleAlert } from "lucide-react";
import type { Label, Origin } from "../../../../packages/domain/src/model";
export const labels: Record<Label, string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
  mixed: "혼합",
  uncertain: "판단 보류",
  unreviewed: "미분류",
};
const colors = {
  positive: "jade",
  negative: "red",
  neutral: "gray",
  mixed: "violet",
  uncertain: "amber",
  unreviewed: "gray",
} as const;
export function Sentiment({ label }: { label: Label }) {
  return (
    <Badge color={colors[label]} variant="soft">
      {labels[label]}
    </Badge>
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
