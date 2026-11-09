import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, MessageSquareText } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type {
  Conversation,
  Evaluation,
} from "../../../../packages/domain/src/model";
import { Filters } from "../components/Filters";
import {
  Empty,
  EvaluationStatus,
  Failure,
  labels,
  Pending,
  time,
} from "../components/ui";
import {
  Badge,
  Box,
  Button,
  Card,
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
): [string, Evaluation] | undefined {
  const entries = Object.entries(item.evaluations).filter(
    ([name]) => !target || name === target,
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
    label = params.get("label") || "";
  const query = useInfiniteQuery(conversationsQuery(scope, label)),
    metadata = useQuery({ ...overviewQuery(scope), enabled: !embedded });
  const items = query.data?.pages.flatMap((p) => p.items) || [],
    total = query.data?.pages[0]?.total || 0;
  function setLabel(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("label");
    else next.set("label", value);
    setParams(next, { replace: true });
  }
  return (
    <>
      {!embedded && (
        <PageHeader
          title="대화 목록"
          description="기준 발언과 앞뒤 맥락을 한 대화로 읽습니다."
          actions={<Filters metadata={metadata.data?.metadata} />}
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
          <Select.Root value={label || "all"} onValueChange={setLabel}>
            <Select.Trigger aria-label="여론 분류" />
            <Select.Content>
              <Select.Item value="all">모든 분류</Select.Item>
              {Object.entries(labels).map(([key, name]) => (
                <Select.Item key={key} value={key}>
                  {name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
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
                    const evaluation = selectedEvaluation(item, scope.target);
                    return (
                      <Table.Row key={item.id}>
                        <Table.Cell>
                          <Flex gap="1" wrap="wrap" mb="2">
                            {item.targets.map((t) => (
                              <Badge key={t} color="gray" variant="soft">
                                {t}
                              </Badge>
                            ))}
                          </Flex>
                          <Flex align="center" gap="2">
                            {evaluation && (
                              <EvaluationStatus evaluation={evaluation[1]} />
                            )}
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
