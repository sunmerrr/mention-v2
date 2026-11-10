import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowDown, Info } from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import type { Stance } from "../../../../packages/domain/src/model";
import { ClassificationControl } from "../components/ClassificationControl";
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
import { classificationQuery, overviewQuery, scopeFrom } from "../queries";

export default function Reviews() {
  const menu = useMenuOrigin(),
    navigate = useNavigate();
  const { search } = useLocation(),
    scope = scopeFrom(search),
    [params, setParams] = useSearchParams(),
    label = params.get("label") || "",
    query = useInfiniteQuery(classificationQuery(scope, label)),
    overview = useQuery(overviewQuery(scope));
  const items = query.data?.pages.flatMap((p) => p.items) || [];
  return (
    <>
      <PageHeader
        title="분류 검토"
        description="분류는 확정된 상태입니다. 바꾸고 싶은 평가만 수정하세요."
        actions={<Filters metadata={overview.data?.metadata} />}
      />
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
                    <Table.Row
                      key={item.id}
                      className="review-row"
                      onClick={(event) => {
                        if (
                          event.defaultPrevented ||
                          !(event.target instanceof Element) ||
                          !event.currentTarget.contains(event.target) ||
                          event.target.closest(
                            "a,button,input,textarea,select,summary,details,[role=dialog],[role=combobox]",
                          )
                        )
                          return;
                        navigate(
                          relatedHref(
                            `/conversations/${item.conversationId}`,
                            menu,
                          ),
                        );
                      }}
                    >
                      <Table.Cell>
                        <Text as="p" size="2" weight="medium" mb="2">
                          {item.target}
                        </Text>
                        <EvaluationStatus evaluation={item} />
                      </Table.Cell>
                      <Table.Cell>
                        <Link
                          className="review-context-link"
                          aria-label={`${item.target} 대화 맥락 보기`}
                          to={relatedHref(
                            `/conversations/${item.conversationId}`,
                            menu,
                          )}
                        >
                          <Text as="p" size="2">
                            {item.summary || "별도 메모 없음"}
                          </Text>
                        </Link>
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
                          <ClassificationControl item={item} />
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
