import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Dialog,
  Flex,
  Heading,
  Select,
  Table,
  Text,
  TextArea,
} from "@radix-ui/themes";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, Info, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type {
  Classification,
  Correction,
} from "../../../../packages/contracts/src/api";
import type { Stance } from "../../../../packages/domain/src/model";
import { Filters } from "../components/Filters";
import {
  Empty,
  Failure,
  labels,
  OriginBadge,
  Pending,
  Sentiment,
  time,
} from "../components/ui";
import { api, classificationQuery, overviewQuery, scopeFrom } from "../queries";
import { useRuntime } from "../runtime";

function CorrectionDialog({ item }: { item: Classification }) {
  const [open, setOpen] = useState(false),
    [label, setLabel] = useState(item.label),
    [note, setNote] = useState(item.summary),
    [request, setRequest] = useState("");
  const client = useQueryClient(),
    { writesEnabled } = useRuntime();
  const save = useMutation({
    mutationFn: (data: Correction) => api("/api/classifications/correct", data),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["classifications"] }),
        client.invalidateQueries({ queryKey: ["overview"] }),
        client.invalidateQueries({ queryKey: ["conversations"] }),
        client.invalidateQueries({
          queryKey: ["conversation", item.conversationId],
        }),
      ]);
      setOpen(false);
    },
  });
  function changedLabel(value: string) {
    setLabel(value as Stance);
    setRequest("");
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setLabel(item.label);
          setNote(item.summary);
          setRequest("");
          save.reset();
        }
      }}
    >
      <Dialog.Trigger>
        <Button variant="soft" color="gray" size="1">
          <Pencil size={12} />
          분류 수정
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>{item.target} 분류 수정</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          이미 집계된 결과를 수정합니다. 이전 분류와 수정 이력은 보존됩니다.
        </Dialog.Description>
        {!writesEnabled && (
          <Callout.Root color="amber" mb="4">
            <Callout.Text>
              새 버전은 현재 조회 전용입니다. 운영 데이터 수정은 연결 검증 후
              활성화합니다.
            </Callout.Text>
          </Callout.Root>
        )}
        <Flex direction="column" gap="3">
          <Text as="label" size="2" weight="medium">
            분류
            <Select.Root value={label} onValueChange={changedLabel}>
              <Select.Trigger aria-label="수정할 분류" />
              <Select.Content>
                {Object.entries(labels)
                  .filter(([key]) => key !== "unreviewed")
                  .map(([key, name]) => (
                    <Select.Item key={key} value={key}>
                      {name}
                    </Select.Item>
                  ))}
              </Select.Content>
            </Select.Root>
          </Text>
          <Text as="label" size="2" weight="medium">
            메모
            <TextArea
              aria-label="분류 메모"
              value={note}
              maxLength={2800}
              onChange={(e) => {
                setNote(e.target.value);
                setRequest("");
              }}
              rows={5}
            />
          </Text>
        </Flex>
        {save.isError && <Failure error={save.error} />}
        <Flex justify="end" gap="3" mt="5">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={save.isPending}>
              취소
            </Button>
          </Dialog.Close>
          <Button
            disabled={
              !writesEnabled ||
              (!item.stale && label === item.label && note === item.summary)
            }
            loading={save.isPending}
            onClick={() => {
              const id = request || crypto.randomUUID();
              setRequest(id);
              save.mutate({
                id: item.conversationId,
                service: item.target,
                verdict: label as Stance,
                summary: note,
                expected: item.expected,
                request_id: id,
              });
            }}
          >
            수정 저장
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
export default function Reviews() {
  const { search } = useLocation(),
    scope = scopeFrom(search),
    [params, setParams] = useSearchParams(),
    label = params.get("label") || "",
    query = useInfiniteQuery(classificationQuery(scope, label)),
    overview = useQuery(overviewQuery(scope));
  const items = query.data?.pages.flatMap((p) => p.items) || [];
  return (
    <>
      <Flex
        className="page-heading"
        justify="between"
        align="center"
        gap="4"
        wrap="wrap"
      >
        <Box>
          <Heading size="6">분류 검토</Heading>
          <Text as="p" color="gray" size="2" mt="1">
            분류는 확정된 상태입니다. 바꾸고 싶은 평가만 수정하세요.
          </Text>
        </Box>
        <Filters metadata={overview.data?.metadata} />
      </Flex>
      <Card className="section-card">
        <Flex justify="between" align="center" mb="4">
          <Heading size="4">
            확정된 평가{" "}
            <Text color="gray" size="2">
              {query.data?.pages[0]?.total || 0}건
            </Text>
          </Heading>
          <Select.Root
            value={label || "all"}
            onValueChange={(value) => {
              const next = new URLSearchParams(params);
              if (value === "all") next.delete("label");
              else next.set("label", value);
              setParams(next, { replace: true });
            }}
          >
            <Select.Trigger aria-label="분류 필터" />
            <Select.Content>
              <Select.Item value="all">모든 분류</Select.Item>
              {Object.entries(labels)
                .filter(([key]) => key !== "unreviewed")
                .map(([key, name]) => (
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
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>대상 / 평가</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>판단 근거</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>출처 / 관리</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {items.map((item) => (
                    <Table.Row key={item.id}>
                      <Table.Cell>
                        <Text as="p" size="2" weight="medium" mb="2">
                          {item.target}
                        </Text>
                        <Flex gap="2" align="center">
                          <Sentiment label={item.label} />
                          <OriginBadge origin={item.origin} />
                        </Flex>
                        {item.stale && (
                          <Badge color="amber" mt="2">
                            맥락 변경 · 집계 제외
                          </Badge>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Text as="p" size="2">
                          {item.summary || "별도 메모 없음"}
                        </Text>
                        {item.history.length > 0 && (
                          <details className="review-history">
                            <summary>
                              분류·수정 이력 {item.history.length}건
                            </summary>
                            {item.history.map((event) => (
                              <Box
                                key={`${event.at}-${event.before}-${event.after}`}
                                py="2"
                              >
                                <Text size="1" color="gray">
                                  {time(Date.parse(event.at))} ·{" "}
                                  {event.before === "unreviewed"
                                    ? "미분류"
                                    : labels[event.before as Stance]}{" "}
                                  → {labels[event.after as Stance]}
                                </Text>
                                <Text as="p" size="2">
                                  {event.note || "메모 없음"}
                                </Text>
                              </Box>
                            ))}
                          </details>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Text as="p" size="1" mb="3">
                          {item.room} · {time(item.at)}
                        </Text>
                        <Flex gap="3" align="center">
                          <CorrectionDialog item={item} />
                          <Button asChild variant="ghost" size="1">
                            <Link to={`/conversations/${item.conversationId}`}>
                              <ArrowUpRight size={13} />
                              맥락
                            </Link>
                          </Button>
                        </Flex>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
            {!items.length && (
              <Empty>이 조건에 맞는 확정 분류가 없습니다.</Empty>
            )}
            {query.hasNextPage && (
              <Flex justify="center" mt="4">
                <Button
                  variant="soft"
                  loading={query.isFetchingNextPage}
                  onClick={() => query.fetchNextPage()}
                >
                  <ArrowDown size={14} />더 보기
                </Button>
              </Flex>
            )}
          </>
        )}
      </Card>
      <Flex gap="2" mt="4" align="center">
        <Info size={13} />
        <Text size="1" color="gray">
          미분류는 중립으로 집계하지 않습니다. 사람이 수정한 결과를 우선합니다.
        </Text>
      </Flex>
    </>
  );
}
