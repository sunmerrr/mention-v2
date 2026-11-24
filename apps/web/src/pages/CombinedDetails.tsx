import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import {
  type OpinionCounts,
  opinionChartPopulation,
  opinionLabels,
} from '@app/shared/monitoring/domain/source-opinions';
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

export default function CombinedDetails({ data }: { data: CombinedPayload }) {
  const selected = data.rows[0];
  return (
    <>
      <Disclosure title="출처별 수치와 그래프">
        <Disclosure title="건수 비교표">
          <Text as="p" size="2" color="gray" mb="3">
            수집된 카톡 대화 {data.kakao.units.toLocaleString('ko-KR')}건 · 포커고수 게시글{' '}
            {data.pokergosu.units.toLocaleString('ko-KR')}건
          </Text>
          <Box display={{ initial: 'block', sm: 'none' }} mb="2">
            <Text size="1" color="gray">
              표를 좌우로 움직여 두 출처를 비교할 수 있습니다.
            </Text>
          </Box>
          <Table.Root style={{ whiteSpace: 'nowrap' }}>
            <caption>
              <VisuallyHidden>전체 건수 비교</VisuallyHidden>
            </caption>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell rowSpan={2}>대상</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell colSpan={3} align="center" scope="colgroup">
                  카톡 · 대화
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell colSpan={3} align="center" scope="colgroup">
                  포커고수 · 게시글
                </Table.ColumnHeaderCell>
              </Table.Row>
              <Table.Row>
                {(['kakao', 'pokergosu'] as const).flatMap((source) => [
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
                  {(['kakao', 'pokergosu'] as const).flatMap((source) => {
                    const available = source === 'kakao' || data.pokergosu.available;
                    return [
                      <Table.Cell key={`${source}-total`} align="center">
                        <Text color="gray">
                          {available ? row[source].units.toLocaleString('ko-KR') : '—'}
                        </Text>
                      </Table.Cell>,
                      <Table.Cell key={`${source}-positive`} align="center">
                        <Text weight="medium" color={sentimentColors.positive}>
                          {available ? row[source].counts.positive.toLocaleString('ko-KR') : '—'}
                        </Text>
                      </Table.Cell>,
                      <Table.Cell key={`${source}-negative`} align="center">
                        <Text weight="medium" color={sentimentColors.negative}>
                          {available ? row[source].counts.negative.toLocaleString('ko-KR') : '—'}
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
                    <Table.ColumnHeaderCell>카톡</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>포커고수</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {data.rows.map((row) => (
                    <Table.Row key={row.id}>
                      <Table.RowHeaderCell>{row.name}</Table.RowHeaderCell>
                      <Table.Cell>
                        <Distribution {...row.kakao} />
                      </Table.Cell>
                      <Table.Cell>
                        <Distribution {...row.pokergosu} />
                      </Table.Cell>
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
              <Grid columns={{ initial: '1', md: '2' }} gap="5">
                <OpinionChart
                  label="카톡 · 대화"
                  ariaLabel={`${selected.name} 카톡 분류 분포`}
                  units={selected.kakao.units}
                  counts={selected.kakao.counts}
                />
                <OpinionChart
                  label="포커고수 · 게시글"
                  ariaLabel={`${selected.name} 포커고수 분류 분포`}
                  units={selected.pokergosu.units}
                  counts={selected.pokergosu.counts}
                />
              </Grid>
            </Section>
          </Box>
        )}
      </Disclosure>{' '}
      {data.pokergosu.undated > 0 && (
        <Text as="p" size="1" color="gray" mb="4">
          작성 시각 미확인 {data.pokergosu.undated}개 글은 날짜 지정 조회에서 제외합니다.
        </Text>
      )}
    </>
  );
}
