import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Layers3,
  MessagesSquare,
  ScanText,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { stances } from "../../../../packages/domain/src/model";
import { Filters } from "../components/Filters";
import { OverviewConversations } from "../components/OverviewConversations";
import { Empty, Failure, labels, Pending } from "../components/ui";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  MetricCard,
  PageHeader,
  Popover,
  Table,
  Text,
} from "../design-system";
import { overviewQuery, scopeFrom } from "../queries";

export default function Overview() {
  const { search } = useLocation(),
    scope = scopeFrom(search),
    query = useQuery({ ...overviewQuery(scope), refetchInterval: 15000 });
  const [params, setParams] = useSearchParams();
  function unreviewedHref(target?: string) {
    const filters = new URLSearchParams(search);
    filters.delete("nav");
    filters.delete("label");
    filters.set("status", "pending");
    if (target) filters.set("target", target);
    return `/conversations?${filters}`;
  }

  if (query.isPending) return <Pending />;
  if (query.isError)
    return <Failure error={query.error} retry={query.refetch} />;
  const { overview, metadata } = query.data,
    lead = overview.targets.find((t) => t.conversations > 0);
  return (
    <>
      <PageHeader
        title="여론·동향"
        description="우리 서비스에 어떤 이야기가 오가는지, 맥락과 함께 살펴보세요."
        actions={<Filters metadata={metadata} />}
      />
      <Grid columns={{ initial: "1", sm: "3" }} gap="4" className="metric-grid">
        <MetricCard
          label="연결된 대화"
          icon={<MessagesSquare size={16} />}
          value={overview.conversations.toLocaleString()}
          unit="개"
          description={`${scope.day || "전체 저장 기간"} · 홍보 단독 안내 제외`}
        />
        <MetricCard
          label="확정된 대상별 반응"
          icon={<ScanText size={16} />}
          value={overview.classified}
          unit="건"
          description="AI 확정·사람 평가 · 대상별 건수"
        >
          <Flex align="center" justify="between" gap="3">
            <Text size="1" color="gray">
              미분류·재검토 {overview.unclassified}건
            </Text>
            <Button asChild intent="quiet" size="1">
              <Link to={unreviewedHref()}>
                검토 <ArrowRight size={12} />
              </Link>
            </Button>
          </Flex>
        </MetricCard>
        <MetricCard
          label="대화가 모인 대상"
          icon={<Layers3 size={16} />}
          value={lead?.name || "—"}
          description={
            lead
              ? `${lead.conversations}개 대화 · 대화 수는 호감도와 다릅니다.`
              : "기간과 분석 대상을 확인해 주세요."
          }
        />
      </Grid>
      <Card className="section-card">
        <Flex align="start" justify="between" mb="4" gap="3" wrap="wrap">
          <Box>
            <Heading size="4">대상별 여론</Heading>
            <Text as="p" size="2" color="gray" mt="1">
              미분류는 중립에 포함하지 않습니다. 여러 대상을 언급한 대화는 각
              대상에 포함됩니다.
            </Text>
          </Box>
          <Box>
            <Badge color="gray" variant="soft">
              확정 분류 기준
            </Badge>
            <Text as="p" size="1" color="gray" mt="2">
              집계{" "}
              {new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(overview.capturedAt))}
            </Text>
          </Box>
        </Flex>
        <Flex gap="4" wrap="wrap" mb="3" aria-label="반응 분포 색상 범례">
          {stances.map((stance) => (
            <Flex key={stance} align="center" gap="2">
              <span
                className={`sentiment-dot sentiment-fill ${stance}`}
                aria-hidden="true"
              />
              <Text size="1" color="gray">
                {labels[stance]}
              </Text>
            </Flex>
          ))}
        </Flex>
        <Text as="p" size="1" color="gray" className="overview-table-hint">
          표를 좌우로 움직여 분류 범위를 확인하세요.
        </Text>
        <Box className="table-scroll">
          <Table.Root variant="surface" className="overview-target-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>분석 대상</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>대화</Table.ColumnHeaderCell>{" "}
                <Table.ColumnHeaderCell>반응 분포</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>분류 범위</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {overview.targets.map((t) => (
                <Table.Row key={t.name}>
                  <Table.RowHeaderCell>
                    <Flex align="center" gap="2">
                      <Button
                        variant="ghost"
                        color="gray"
                        onClick={() => {
                          const next = new URLSearchParams(params);
                          next.set("target", t.name);
                          setParams(next, { replace: true });
                        }}
                      >
                        {t.name}
                        <ArrowUpRight size={12} />
                      </Button>
                      <Popover.Root>
                        <Popover.Trigger>
                          <Button
                            variant="ghost"
                            color="gray"
                            size="1"
                            aria-label={`${t.name} 하위 키워드`}
                          >
                            키워드 {t.aliases.length}
                            <ChevronDown size={12} />
                          </Button>
                        </Popover.Trigger>
                        <Popover.Content size="2">
                          <Text size="2" weight="medium">
                            {t.name} 하위 키워드
                          </Text>
                          <Flex gap="2" wrap="wrap" mt="3" maxWidth="320px">
                            {t.aliases.map((a) => (
                              <Badge color="gray" key={a}>
                                {a}
                                {t.aliasCounts?.[a] !== undefined
                                  ? ` · ${t.aliasCounts[a]}`
                                  : ""}
                              </Badge>
                            ))}
                          </Flex>
                        </Popover.Content>
                      </Popover.Root>
                    </Flex>
                  </Table.RowHeaderCell>
                  <Table.Cell>
                    <Text weight="medium">{t.conversations}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    {t.classified ? (
                      <Box minWidth="200px">
                        <div
                          className="sentiment-track"
                          role="img"
                          aria-label={stances
                            .map((s) => `${labels[s]} ${t.counts[s]}건`)
                            .join(", ")}
                        >
                          {stances
                            .filter((s) => t.counts[s] > 0)
                            .map((s) => (
                              <span
                                key={s}
                                className={`sentiment-fill ${s}`}
                                style={{
                                  width: `${(t.counts[s] / t.classified) * 100}%`,
                                }}
                              />
                            ))}
                        </div>
                        <Flex gap="3" wrap="wrap" mt="2">
                          {stances
                            .filter((s) => t.counts[s] > 0)
                            .map((s) => (
                              <Flex align="center" gap="1" key={s}>
                                <span
                                  className={`sentiment-dot sentiment-fill ${s}`}
                                  aria-hidden="true"
                                />
                                <Text size="1" color="gray">
                                  {labels[s]} {t.counts[s]}
                                </Text>
                              </Flex>
                            ))}
                        </Flex>
                      </Box>
                    ) : (
                      <Text size="2" color="gray">
                        {t.conversations
                          ? "아직 분류하지 않았습니다"
                          : "수집된 대화 없음"}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Flex align="center" justify="between" gap="3">
                      <Text size="2">
                        {t.classified} / {t.conversations}
                      </Text>
                      <Button asChild intent="quiet" size="1">
                        <Link to={unreviewedHref(t.name)}>
                          검토 <ArrowRight size={12} />
                        </Link>
                      </Button>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
        {!overview.targets.length && <Empty>선택한 대상이 없습니다.</Empty>}
      </Card>
      <OverviewConversations
        sections={overview.conversationSections}
        search={search}
      />
      <Flex justify="between" gap="3" wrap="wrap" mt="5">
        <Text size="1" color="gray">
          조회 기준{" "}
          {new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(new Date(overview.capturedAt))}{" "}
          · 수집 공백 확인 필요 {overview.gaps}건
        </Text>
        <Button asChild variant="ghost" size="1">
          <Link to="/reviews">
            분류 확인·수정
            <ArrowRight size={13} />
          </Link>
        </Button>
      </Flex>
    </>
  );
}
