import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import {
  type OpinionCounts,
  opinionDirection,
  type SourceEvidence,
} from '@app/shared/monitoring/domain/source-opinions';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileText, MessagesSquare } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { combinedQuery, combinedScope } from '../combined-query';
import { Filters } from '../components/Filters';
import { Empty, Failure, labels, Pending, Sentiment } from '../components/ui';
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  MetricCard,
  PageHeader,
  Section,
  Table,
  Text,
} from '../design-system';

function Distribution({ counts, units }: { counts: OpinionCounts; units: number }) {
  const direction = opinionDirection(counts);
  return (
    <Flex direction="column" gap="2">
      <Flex gap="2" align="center">
        <Text size="2">{units}건</Text>
        {units === 0 ? (
          <Badge color="gray">데이터 없음</Badge>
        ) : direction === 'insufficient' ? (
          <Badge color="gray">분류 표본 부족</Badge>
        ) : (
          <Sentiment label={direction} />
        )}
      </Flex>
      <Flex gap="2" wrap="wrap">
        {(
          [
            'positive',
            'negative',
            'neutral',
            'mixed',
            'uncertain',
            'excluded',
            'unreviewed',
          ] as const
        ).map((label) => (
          <Text key={label} size="1" color="gray">
            {labels[label]} {counts[label]}
          </Text>
        ))}
      </Flex>
    </Flex>
  );
}
function Evidence({ items }: { items: SourceEvidence[] }) {
  return items.length ? (
    <Flex direction="column" gap="4">
      {items.map((item) => (
        <Box key={`${item.id}:${item.target}`}>
          <Flex gap="2" align="center" mb="2">
            <Sentiment label={item.label} />
            <Text size="2" weight="medium">
              {item.target}
            </Text>
            <Button intent="quiet" size="1" asChild>
              <Link to={item.href + (!item.href.includes('?') ? '?nav=%2Fcombined' : '')}>
                맥락 <ArrowUpRight size={14} />
              </Link>
            </Button>
          </Flex>
          <Text as="p" size="2">
            {item.summary}
          </Text>
        </Box>
      ))}
    </Flex>
  ) : (
    <Empty>분류된 맥락이 아직 없습니다.</Empty>
  );
}
function KeywordReport({ data }: { data: CombinedPayload }) {
  const { scope, weekly } = data;
  const selected = weekly.rows.find((row) => row.name === scope.target);
  const sources = [
    { key: 'kakao', label: '카톡' },
    { key: 'pokergosu', label: '포커고수' },
  ] as const;
  const visible = sources.filter(({ key }) => !scope.source || scope.source === key);
  return (
    <>
      {selected && (
        <Section title="주간 추이">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                {['기간', '언급', '분류 완료', '긍정', '부정'].map((text) => (
                  <Table.ColumnHeaderCell key={text}>{text}</Table.ColumnHeaderCell>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {weekly.weeks.map(({ start, through, partial }, index) => {
                const counts = selected.values[index];
                return (
                  <Table.Row key={start}>
                    <Table.RowHeaderCell>
                      {start.slice(5)}–{through.slice(5)}
                      {partial ? ' (진행 중)' : ''}
                    </Table.RowHeaderCell>
                    <Table.Cell>{counts?.mentions ?? '–'}</Table.Cell>
                    <Table.Cell>{counts?.classified ?? '–'}</Table.Cell>
                    <Table.Cell>{counts?.positive ?? '–'}</Table.Cell>
                    <Table.Cell>{counts?.negative ?? '–'}</Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Section>
      )}
      {[
        { title: '하위 키워드 언급', rows: data.keywordMentions },
        { title: '함께 언급된 키워드', rows: data.relatedKeywords },
      ]
        .filter(({ rows }) => rows.length)
        .map(({ title, rows }) => (
          <Section key={title} title={title}>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>키워드</Table.ColumnHeaderCell>
                  {visible.map(({ key, label }) => (
                    <Table.ColumnHeaderCell key={key}>{label}</Table.ColumnHeaderCell>
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map(({ name, variants, kakao, pokergosu }) => (
                  <Table.Row key={name}>
                    <Table.RowHeaderCell>
                      {name}
                      {variants.length > 0 && (
                        <Text size="1" color="gray">
                          {' '}
                          · {variants.join(', ')}
                        </Text>
                      )}
                    </Table.RowHeaderCell>
                    {visible.map(({ key }) => (
                      <Table.Cell key={key}>
                        {(key === 'kakao' ? kakao : pokergosu) ?? '–'}
                      </Table.Cell>
                    ))}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Section>
        ))}
    </>
  );
}
export default function Combined() {
  const { search, pathname } = useLocation(),
    scope = combinedScope(pathname, search),
    query = useQuery(combinedQuery(scope)),
    data = query.data,
    showKakao = scope.source !== 'pokergosu',
    showForum = scope.source !== 'kakao';
  return (
    <>
      <PageHeader
        title={
          scope.target
            ? `${scope.target} ${scope.source === 'kakao' ? '카톡 ' : scope.source === 'pokergosu' ? '포커고수 ' : ''}여론`
            : '종합 여론'
        }
        description={
          scope.source ? undefined : '같은 대상에 대한 카톡과 포커고수의 반응을 나란히 비교합니다.'
        }
      />
      <Filters
        metadata={data?.metadata}
        showTarget={!/^\/(?:combined|kakao\/keywords|pokergosu\/keywords)\//u.test(pathname)}
      />
      {query.isPending ? (
        <Pending />
      ) : query.isError ? (
        <Failure error={query.error} retry={query.refetch} />
      ) : (
        data && (
          <>
            <Grid columns={{ initial: '1', sm: '2' }} gap="4" mb="5">
              {showKakao && (
                <MetricCard
                  label="카톡 대화"
                  value={data.kakao.units}
                  icon={<MessagesSquare size={16} />}
                  description="맥락으로 묶인 대화 기준"
                />
              )}
              {showForum && (
                <MetricCard
                  label="포커고수 글"
                  value={data.pokergosu.units}
                  icon={<FileText size={16} />}
                  description="게시글과 저장된 댓글을 하나의 맥락으로 분류"
                />
              )}
            </Grid>
            {showForum && !data.pokergosu.available && (
              <Text as="p" color="gray" mb="4">
                포커고수 수집 데이터가 아직 없습니다.
              </Text>
            )}
            <Section
              title={scope.source ? '분류 현황' : '대상별 비교'}
              description={scope.source ? undefined : '3건 미만의 분류는 표본 부족으로 표시합니다.'}
            >
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>대상</Table.ColumnHeaderCell>
                    {showKakao && <Table.ColumnHeaderCell>카톡</Table.ColumnHeaderCell>}
                    {showForum && <Table.ColumnHeaderCell>포커고수</Table.ColumnHeaderCell>}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {data.rows.map((row) => (
                    <Table.Row key={row.id}>
                      <Table.RowHeaderCell>
                        <Link
                          to={`/combined/${encodeURIComponent(row.name)}${scope.day ? `?day=${scope.day}` : ''}`}
                        >
                          {row.name}
                        </Link>
                      </Table.RowHeaderCell>
                      {showKakao && (
                        <Table.Cell>
                          <Distribution {...row.kakao} />
                        </Table.Cell>
                      )}
                      {showForum && (
                        <Table.Cell>
                          <Distribution {...row.pokergosu} />
                        </Table.Cell>
                      )}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Section>
            {data.pokergosu.undated > 0 && (
              <Text as="p" size="1" color="gray" mb="4">
                작성 시각 미확인 {data.pokergosu.undated}개 글은 날짜 지정 조회에서 제외합니다.
              </Text>
            )}
            <KeywordReport data={data} />
            {!scope.source && (
              <Section
                title="함께 언급된 주제"
                description="분류된 맥락 요약에서 두 채널에 함께 등장한 주제입니다. 의견이 같다는 뜻은 아닙니다."
              >
                {data.topics.length ? (
                  data.topics.map((topic) => (
                    <Box key={`${topic.target}:${topic.topic}`} mb="5">
                      <Text as="p" weight="medium" mb="3">
                        {topic.target} · {topic.topic}
                      </Text>
                      <Grid columns={{ initial: '1', md: '2' }} gap="5">
                        <Box>
                          <Text as="p" size="1" color="gray" mb="3">
                            카톡
                          </Text>
                          <Evidence items={topic.kakao} />
                        </Box>
                        <Box>
                          <Text as="p" size="1" color="gray" mb="3">
                            포커고수
                          </Text>
                          <Evidence items={topic.pokergosu} />
                        </Box>
                      </Grid>
                    </Box>
                  ))
                ) : (
                  <Empty>두 채널에서 비교할 분류 맥락이 아직 충분하지 않습니다.</Empty>
                )}
              </Section>
            )}
            <Grid columns={{ initial: '1', md: '2' }} gap="4">
              {showKakao && (
                <Section title="카톡 근거" description="분류된 대화 중 일부 예시">
                  <Evidence items={data.kakao.evidence} />
                </Section>
              )}
              {showForum && (
                <Section title="포커고수 근거" description="분류된 글·댓글 맥락 중 일부 예시">
                  <Evidence items={data.pokergosu.evidence} />
                </Section>
              )}
            </Grid>
          </>
        )
      )}
    </>
  );
}
