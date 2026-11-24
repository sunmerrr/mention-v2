import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Empty, Failure, Pending } from '../components/ui';
import { Button, Flex, PageHeader, Section, Table, Text, TextField } from '../design-system';
import { relatedHref } from '../navigation';
import { topicQuery, topicScope } from '../topic-query';

const formatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateHref = (day: string) => `/trending?${new URLSearchParams({ mode: 'daily', day })}`;

export default function TopicBriefing() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const scope = topicScope(search);
  const query = useQuery(topicQuery(scope));
  const data = query.data;
  const daily = scope.mode === 'daily';
  return (
    <>
      <PageHeader
        title={daily ? '화제 브리핑' : '화제 브리핑 · 실시간'}
        description={
          data
            ? daily
              ? `${data.day} · 한국 시간${data.partial ? ' · 집계 중' : ''}`
              : `최근 6시간 · ${formatter.format(data.from)} ~ ${formatter.format(data.through)}`
            : undefined
        }
        actions={
          <Flex gap="2" align="center" wrap="wrap">
            <Button asChild intent={daily ? 'quiet' : 'primary'}>
              <Link to="/trending">실시간</Link>
            </Button>
            <Button asChild intent={daily ? 'primary' : 'quiet'}>
              <Link to={dateHref('')}>일간</Link>
            </Button>
            {daily && (
              <TextField.Root
                type="date"
                aria-label="브리핑 날짜"
                value={data?.day ?? scope.day}
                max={data?.today}
                onChange={(event) => navigate(dateHref(event.currentTarget.value))}
              />
            )}
          </Flex>
        }
      />
      {query.isPending ? (
        <Pending />
      ) : query.isError ? (
        <Failure error={query.error} retry={query.refetch} />
      ) : (
        data && (
          <Section title="화제별 언급량">
            <Flex gap="3" wrap="wrap" mb="3">
              {(
                [
                  { key: 'kakao', label: '카톡' },
                  { key: 'pokergosu', label: '포커고수' },
                ] as const
              ).map(({ key, label }) => (
                <Text key={key} size="2" color="gray">
                  {label}{' '}
                  {data.sources[key].available
                    ? `${data.sources[key].count}건`
                    : '데이터 조회 불가'}
                </Text>
              ))}
            </Flex>
            {data.topics.length ? (
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>화제</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>전체</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>카톡</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>포커고수</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {data.topics.map((topic) => (
                    <Table.Row key={topic.name}>
                      <Table.RowHeaderCell>
                        <Link
                          to={`/combined/${encodeURIComponent(topic.name)}${daily ? `?day=${data.day}` : ''}`}
                        >
                          {topic.name}
                        </Link>
                      </Table.RowHeaderCell>
                      <Table.Cell>{topic.count}건</Table.Cell>
                      <Table.Cell>
                        {topic.latest.kakao ? (
                          <Link
                            title={topic.latest.kakao.title}
                            to={relatedHref(`/conversations/${topic.latest.kakao.id}`, '/trending')}
                          >
                            {topic.kakao}건
                          </Link>
                        ) : (
                          '0건'
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {topic.latest.pokergosu ? (
                          <Link
                            title={topic.latest.pokergosu.title}
                            to={relatedHref(`/posts/${topic.latest.pokergosu.id}`, '/trending')}
                          >
                            {topic.pokergosu}건
                          </Link>
                        ) : (
                          '0건'
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            ) : (
              <Empty>이 기간에 수집된 화제가 없습니다.</Empty>
            )}
          </Section>
        )
      )}
    </>
  );
}
