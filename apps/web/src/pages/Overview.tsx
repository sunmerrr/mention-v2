import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Popover,
  Table,
  Text,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowRight,
  ChevronDown,
  Layers3,
  MessagesSquare,
  ScanText,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { stances } from "../../../../packages/domain/src/model";
import { Filters } from "../components/Filters";
import { Empty, Failure, labels, Pending, Sentiment } from "../components/ui";
import { overviewQuery, scopeFrom } from "../queries";

export default function Overview() {
  const { search } = useLocation(),
    scope = scopeFrom(search),
    query = useQuery({ ...overviewQuery(scope), refetchInterval: 15000 });
  const [params, setParams] = useSearchParams();
  if (query.isPending) return <Pending />;
  if (query.isError)
    return <Failure error={query.error} retry={query.refetch} />;
  const { overview, metadata } = query.data,
    lead = overview.targets.find((t) => t.conversations > 0);
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
          <Heading size="6">여론·동향</Heading>
          <Text as="p" color="gray" size="2" mt="1">
            우리 서비스에 어떤 이야기가 오가는지, 맥락과 함께 살펴보세요.
          </Text>
        </Box>
        <Filters metadata={metadata} />
      </Flex>
      <Grid columns={{ initial: "1", sm: "3" }} gap="4" className="metric-grid">
        <Card>
          <Flex align="center" gap="2">
            <MessagesSquare size={16} />
            <Text size="2" color="gray">
              연결된 대화
            </Text>
          </Flex>
          <Heading size="7" mt="3">
            {overview.conversations.toLocaleString()}
            <Text size="3" color="gray" ml="2">
              개
            </Text>
          </Heading>
          <Text size="2" color="gray">
            {scope.day || "전체 저장 기간"} · 홍보 단독 안내 제외
          </Text>
        </Card>
        <Card>
          <Flex align="center" gap="2">
            <ScanText size={16} />
            <Text size="2" color="gray">
              확정된 대상별 반응
            </Text>
          </Flex>
          <Heading size="7" mt="3">
            {overview.classified}
            <Text size="3" color="gray" ml="2">
              건
            </Text>
          </Heading>
          <Text size="2" color="gray">
            AI 확정과 사람 평가 포함 · 미분류 {overview.unclassified}건
          </Text>
        </Card>
        <Card>
          <Flex align="center" gap="2">
            <Layers3 size={16} />
            <Text size="2" color="gray">
              대화가 모인 대상
            </Text>
          </Flex>
          <Heading size="6" mt="3">
            {lead?.name || "아직 대화가 없습니다"}
          </Heading>
          <Text size="2" color="gray">
            {lead
              ? `${lead.conversations}개 대화 · 대화 수는 호감도와 다릅니다.`
              : "기간과 분석 대상을 확인해 주세요."}
          </Text>
        </Card>
      </Grid>
      <Card className="section-card">
        <Flex align="center" justify="between" mb="4">
          <Box>
            <Heading size="4">대상별 여론</Heading>
            <Text as="p" size="2" color="gray" mt="1">
              미분류는 중립에 포함하지 않습니다. 여러 대상을 언급한 대화는 각
              대상에 포함됩니다.
            </Text>
          </Box>
          <Badge color="gray" variant="soft">
            확정 분류 기준
          </Badge>
        </Flex>
        <Box className="table-scroll">
          <Table.Root variant="surface">
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
                        <ArrowDownRight size={12} />
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
                              <Text size="1" color="gray" key={s}>
                                {labels[s]} {t.counts[s]}
                              </Text>
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
                    <Text size="2">
                      {t.classified} / {t.conversations}
                    </Text>
                    <Text as="p" size="1" color="gray">
                      미분류 {t.counts.unreviewed}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
        {!overview.targets.length && <Empty>선택한 대상이 없습니다.</Empty>}
      </Card>
      <Card className="section-card">
        <Flex justify="between" align="center" gap="3" wrap="wrap" mb="4">
          <Box>
            <Heading size="4">주요 대화</Heading>
            <Text as="p" size="2" color="gray" mt="1">
              확정 요약과 맥락이 있는 대화에서 대상·반응별 사례를 최대 4개
              선정합니다. 전체 여론을 대표한다는 의미는 아닙니다.
            </Text>
          </Box>
          <Button asChild variant="soft" size="2">
            <Link to={`/conversations${search}`}>
              전체 대화 보기 <ArrowRight size={14} />
            </Link>
          </Button>
        </Flex>
        <Grid columns={{ initial: "1", md: "2" }} gap="3">
          {overview.highlights.map((item) => (
            <Card key={item.id}>
              <Flex align="center" gap="2" mb="3">
                <Badge color="gray">{item.target}</Badge>
                <Sentiment label={item.label} />
              </Flex>
              <Link
                to={`/conversations/${item.id}${search}`}
                className="conversation-link"
              >
                <Text as="p" size="3" weight="medium">
                  {item.summary}
                </Text>
              </Link>
              <Text as="p" size="1" color="gray" mt="3">
                선정 이유: {item.reason}
              </Text>
              <Text as="p" size="1" color="gray" mt="1">
                {item.room}
              </Text>
            </Card>
          ))}
        </Grid>
        {!overview.highlights.length && (
          <Empty>
            확정 요약과 충분한 맥락을 갖춘 대화가 아직 없습니다. 전체 대화에서
            확인해 주세요.
          </Empty>
        )}
      </Card>
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
