import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import {
  type OpinionCounts,
  opinionChartPopulation,
  opinionLabels,
} from '@app/shared/monitoring/domain/source-opinions';
import type { BriefingSource } from '../combined-query';
import { labels } from '../components/ui';
import {
  Box,
  CountBreakdown,
  Disclosure,
  Flex,
  Grid,
  Section,
  StackedDistribution,
  sentimentColors,
  Table,
  Text,
  VisuallyHidden,
} from '../design-system';

function distributionItems(counts: OpinionCounts) {
  return opinionLabels.map((tone) => ({
    label: labels[tone],
    count: counts[tone],
    color: sentimentColors[tone],
    tone,
  }));
}

function OpinionChart({
  label,
  ariaLabel,
  units,
  counts,
}: {
  label: string;
  ariaLabel: string;
  units: number;
  counts: OpinionCounts;
}) {
  const population = opinionChartPopulation(counts, units);
  return (
    <StackedDistribution
      label={label}
      ariaLabel={ariaLabel}
      summary={
        <Flex gap="3" wrap="wrap" mb="2" aria-label={`${ariaLabel} 주요 건수`}>
          <Text size="2" className="ds-chart-tone-label" data-tone="positive">
            긍정 <strong>{counts.positive.toLocaleString('ko-KR')}</strong>건
          </Text>
          <Text size="2" className="ds-chart-tone-label" data-tone="negative">
            부정 <strong>{counts.negative.toLocaleString('ko-KR')}</strong>건
          </Text>
          <Text size="1" color="gray">
            미분류 {counts.unreviewed.toLocaleString('ko-KR')}건
          </Text>
        </Flex>
      }
      total={population.total}
      legend="disclosure"
      totalLabel="분석 대상"
      emptyLabel="분석 대상 없음"
      items={population.items.map((item) => ({
        label: labels[item.label],
        count: item.count,
        tone: item.label,
      }))}
    />
  );
}

function Distribution({ counts, units }: { counts: OpinionCounts; units: number }) {
  return <CountBreakdown total={units} items={distributionItems(counts)} />;
}

const sourceNames = {
  kakao: { short: '카톡', unit: '대화', collected: '수집된 카톡 대화' },
  pokergosu: { short: '포커고수', unit: '게시글', collected: '포커고수 게시글' },
} as const;

export default function CombinedDetails({
  data,
  source,
}: {
  data: CombinedPayload;
  source?: BriefingSource;
}) {
  const selected = data.rows[0];
  const sources: BriefingSource[] = source ? [source] : ['kakao', 'pokergosu'];
  const available = (key: BriefingSource) => key === 'kakao' || data.pokergosu.available;
  return (
    <>
      <Disclosure title={source ? '대상별 수치와 그래프' : '출처별 수치와 그래프'}>
        <Disclosure title={source ? '건수표' : '건수 비교표'}>
          <Text as="p" size="2" color="gray" mb="3">
            {sources
              .map(
                (key) =>
                  `${sourceNames[key].collected} ${data[key].units.toLocaleString('ko-KR')}건`,
              )
              .join(' · ')}
          </Text>
          {sources.length > 1 && (
            <Box display={{ initial: 'block', sm: 'none' }} mb="2">
              <Text size="1" color="gray">
                표를 좌우로 움직여 두 출처를 비교할 수 있습니다.
              </Text>
            </Box>
          )}
          <Table.Root style={{ whiteSpace: 'nowrap' }}>
            <caption>
              <VisuallyHidden>전체 건수 비교</VisuallyHidden>
            </caption>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell rowSpan={2}>대상</Table.ColumnHeaderCell>
                {sources.map((key) => (
                  <Table.ColumnHeaderCell key={key} colSpan={3} align="center" scope="colgroup">
                    {sourceNames[key].short} · {sourceNames[key].unit}
                  </Table.ColumnHeaderCell>
                ))}
              </Table.Row>
              <Table.Row>
                {sources.flatMap((source) => [
                  <Table.ColumnHeaderCell key={`${source}-total`} align="center">
                    전체
                  </Table.ColumnHeaderCell>,
                  <Table.ColumnHeaderCell key={`${source}-positive`} align="center">
                    <Text color={sentimentColors.positive}>긍정</Text>
                  </Table.ColumnHeaderCell>,
                  <Table.ColumnHeaderCell key={`${source}-negative`} align="center">
                    <Text color={sentimentColors.negative}>부정</Text>
                  </Table.ColumnHeaderCell>,
                ])}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.rows.map((row) => (
                <Table.Row key={row.id}>
                  <Table.RowHeaderCell>{row.name}</Table.RowHeaderCell>
                  {sources.flatMap((source) => {
                    const shown = available(source);
                    return [
                      <Table.Cell key={`${source}-total`} align="center">
                        <Text color="gray">
                          {shown ? row[source].units.toLocaleString('ko-KR') : '—'}
                        </Text>
                      </Table.Cell>,
                      <Table.Cell key={`${source}-positive`} align="center">
                        <Text weight="medium" color={sentimentColors.positive}>
                          {shown ? row[source].counts.positive.toLocaleString('ko-KR') : '—'}
                        </Text>
                      </Table.Cell>,
                      <Table.Cell key={`${source}-negative`} align="center">
                        <Text weight="medium" color={sentimentColors.negative}>
                          {shown ? row[source].counts.negative.toLocaleString('ko-KR') : '—'}
                        </Text>
                      </Table.Cell>,
                    ];
                  })}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
          <Box mt="4">
            <Disclosure title="중립·혼합 등 전체 분류 보기">
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>대상</Table.ColumnHeaderCell>
                    {sources.map((key) => (
                      <Table.ColumnHeaderCell key={key}>
                        {sourceNames[key].short}
                      </Table.ColumnHeaderCell>
                    ))}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {data.rows.map((row) => (
                    <Table.Row key={row.id}>
                      <Table.RowHeaderCell>{row.name}</Table.RowHeaderCell>
                      {sources.map((key) => (
                        <Table.Cell key={key}>
                          <Distribution {...row[key]} />
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Disclosure>
          </Box>
        </Disclosure>
        {selected && (
          <Box id="opinion-detail" mb="5">
            <Section
              title={`${selected.name} 상세 분포`}
              description="선택한 대상만 표시합니다. 판단 제외는 그래프와 비율에서 제외합니다."
            >
              <Grid columns={{ initial: '1', md: sources.length > 1 ? '2' : '1' }} gap="5">
                {sources.map((key) => (
                  <OpinionChart
                    key={key}
                    label={`${sourceNames[key].short} · ${sourceNames[key].unit}`}
                    ariaLabel={`${selected.name} ${sourceNames[key].short} 분류 분포`}
                    units={selected[key].units}
                    counts={selected[key].counts}
                  />
                ))}
              </Grid>
            </Section>
          </Box>
        )}
      </Disclosure>{' '}
      {source !== 'kakao' && data.pokergosu.undated > 0 && (
        <Text as="p" size="1" color="gray" mb="4">
          작성 시각 미확인 {data.pokergosu.undated}개 글은 날짜 지정 조회에서 제외합니다.
        </Text>
      )}
    </>
  );
}
