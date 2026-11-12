import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, MessageSquareText } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type {
  Conversation,
  Evaluation,
} from "../../../../packages/domain/src/model";
import { matchesReviewState } from "../../../../packages/domain/src/model";
import { ClassificationControl } from "../components/ClassificationControl";
import { Filters } from "../components/Filters";
import { Empty, Failure, labels, Pending, time } from "../components/ui";
import {
  Box,
  Button,
  Card,
  FilterBar,
  Flex,
  Heading,
  PageHeader,
  Select,
  Table,
  Text,
} from "../design-system";
import { relatedHref, useMenuOrigin } from "../navigation";
import { conversationsQuery, overviewQuery, scopeFrom } from "../queries";
export function selectedEvaluation(
  item: Conversation,
  target: string,
  label = "",
  status = "",
): [string, Evaluation] | undefined {
  const entries = Object.entries(item.evaluations).filter(
    ([name, evaluation]) =>
      (!target || name === target) &&
      matchesReviewState(evaluation, status) &&
      (!label ||
        (evaluation.stale ? "unreviewed" : evaluation.label) === label),
  );
  return (
    entries.find(([, e]) => e.label !== "unreviewed" && e.summary) ||
    entries.find(([, e]) => e.label !== "unreviewed") ||
    entries[0]
  );
}
export default function Conversations({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const menu = useMenuOrigin();
  const { search } = useLocation(),
    scope = scopeFrom(search),
    [params, setParams] = useSearchParams(),
    label = params.get("label") || "",
    status = params.get("status") || (label === "unreviewed" ? "pending" : "");
  const query = useInfiniteQuery(
      conversationsQuery(scope, label === "unreviewed" ? "" : label, status),
    ),
    metadata = useQuery({ ...overviewQuery(scope), enabled: !embedded });
  const items = query.data?.pages.flatMap((p) => p.items) || [],
    total = query.data?.pages[0]?.total || 0;
  function setLabel(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("label");
    else {
      next.set("label", value);
      if (["pending", "unclassified", "recheck", "excluded"].includes(status))
        next.set("status", "classified");
    }
    setParams(next, { replace: true });
  }
  const classificationFilters = (
    <>
      <Select.Root
        value={status || "all"}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          if (value === "all") next.delete("status");
          else next.set("status", value);
          if (
            ["pending", "unclassified", "recheck", "excluded"].includes(
              value,
            ) ||
            next.get("label") === "unreviewed"
          )
            next.delete("label");
          setParams(next, { replace: true });
        }}
      >
        <Select.Trigger aria-label="분류 상태">
          {(
            {
              pending: "미분류 / 재검토",
              unclassified: "미분류",
              recheck: "재검토",
              classified: "분류 완료",
              excluded: "판단 제외",
            } as Record<string, string>
          )[status] || "전체 상태"}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="all">전체 상태</Select.Item>
          <Select.Item value="pending">미분류 / 재검토</Select.Item>
          <Select.Item value="unclassified">미분류</Select.Item>
          <Select.Item value="recheck">재검토</Select.Item>
          <Select.Item value="classified">분류 완료</Select.Item>
          <Select.Item value="excluded">판단 제외</Select.Item>
        </Select.Content>
      </Select.Root>

      <Select.Root
        value={label && label !== "unreviewed" ? label : "all"}
        onValueChange={setLabel}
      >
        <Select.Trigger aria-label="여론 분류">
          {label && label !== "unreviewed"
            ? labels[label as keyof typeof labels]
            : "모든 여론"}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="all">모든 여론</Select.Item>
          {Object.entries(labels)
            .filter(([key]) => key !== "unreviewed" && key !== "excluded")
            .map(([key, name]) => (
              <Select.Item key={key} value={key}>
                {name}
              </Select.Item>
            ))}
        </Select.Content>
      </Select.Root>
    </>
  );
  return (
    <>
      {!embedded && (
        <PageHeader
          title="대화 목록"
          description="기준 발언과 앞뒤 맥락을 한 대화로 읽습니다."
          actions={
            <Filters metadata={metadata.data?.metadata}>
              {classificationFilters}
            </Filters>
          }
        />
      )}
      <Card className="section-card">
        <Flex align="center" justify="between" gap="3" mb="4" wrap="wrap">
          <Box>
            <Heading size="4">{embedded ? "주요 대화" : "연결된 대화"}</Heading>
            <Text size="2" color="gray">
              {total}개 대화 · 발송 시각 기준
            </Text>
          </Box>
          {embedded && <FilterBar>{classificationFilters}</FilterBar>}
        </Flex>
        {query.isPending ? (
          <Pending />
        ) : query.isError ? (
          <Failure error={query.error} retry={query.refetch} />
        ) : (
          <>
            <Box className="table-scroll">
              <Table.Root className="conversation-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>대상 / 분류</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>
                      요약·대표 발언
                    </Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>출처</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {items.map((item) => {
                    const evaluation = selectedEvaluation(
                      item,
                      scope.target,
                      label === "unreviewed" ? "" : label,
                      status,
                    );
                    return (
                      <Table.Row key={item.id}>
                        <Table.Cell>
                          <Flex direction="column" gap="3">
                            {item.targets
                              .filter(
                                (target) =>
                                  !scope.target || target === scope.target,
                              )
                              .map((target) => {
                                const evaluation = item.evaluations[target];
                                const previous = evaluation?.previous;
                                return (
                                  <Box key={target}>
                                    <Text
                                      as="p"
                                      size="1"
                                      weight="medium"
                                      mb="1"
                                    >
                                      {target}
                                    </Text>
                                    {evaluation?.expected ? (
                                      <ClassificationControl
                                        item={{
                                          id: `${item.id}:${target}`,
                                          conversationId: item.id,
                                          target,
                                          label:
                                            previous?.label || evaluation.label,
                                          summary: evaluation.summary,
                                          origin:
                                            previous?.origin ||
                                            evaluation.origin,
                                          stale: evaluation.stale,
                                          expected: evaluation.expected,
                                          room: item.room,
                                          at: item.at,
                                          history: [],
                                        }}
                                      />
                                    ) : (
                                      <Text size="1" color="gray">
                                        분류 정보 로드 중
                                      </Text>
                                    )}
                                    {evaluation?.stale && (
                                      <Text
                                        as="p"
                                        size="1"
                                        color="amber"
                                        mt="1"
                                      >
                                        {previous
                                          ? `기존 ${labels[previous.label]} · `
                                          : ""}
                                        재검토 필요
                                      </Text>
                                    )}
                                  </Box>
                                );
                              })}
                          </Flex>
                        </Table.Cell>
                        <Table.Cell>
                          <Link
                            to={relatedHref(
                              `/conversations/${item.id}${search}`,
                              menu,
                            )}
                            className="conversation-link"
                          >
                            <Text as="p" size="1" color="gray" mb="1">
                              {evaluation?.[1].summary
                                ? `${evaluation[0]} · 분류 요약`
                                : "실제 발언"}
                            </Text>
                            <Text
                              as="p"
                              className="preview-copy"
                              size="2"
                              weight="medium"
                            >
                              {evaluation?.[1].summary || item.title}
                            </Text>
                            <Flex gap="2" mt="2" align="center">
                              <MessageSquareText size={12} />
                              <Text size="1" color="gray">
                                맥락 {item.messageCount}개
                              </Text>
                              <ArrowUpRight size={12} />
                            </Flex>
                          </Link>
                        </Table.Cell>
                        <Table.Cell>
                          <Text as="p" size="1" className="room-name">
                            {item.room}
                          </Text>
                          <Text size="1" color="gray">
                            {time(item.at)}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </Box>
            {!items.length && <Empty>이 조건에 맞는 대화가 없습니다.</Empty>}
            {query.hasNextPage && (
              <Flex justify="center" mt="4">
                <Button
                  variant="soft"
                  color="gray"
                  loading={query.isFetchingNextPage}
                  onClick={() => query.fetchNextPage()}
                >
                  <ArrowDown size={14} />
                  대화 더 보기 · {items.length} / {total}
                </Button>
              </Flex>
            )}
          </>
        )}
      </Card>
    </>
  );
}
