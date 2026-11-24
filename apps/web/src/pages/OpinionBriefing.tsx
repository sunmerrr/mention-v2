import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import { keywordResult } from '@app/shared/monitoring/domain/keyword-briefing';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import {
  type BriefingSource,
  briefingHomeHref,
  combinedKeywordHref,
  combinedQuery,
  combinedScope,
  mentionListHref,
} from '../combined-query';
import { Filters } from '../components/Filters';
import { Empty, Failure, labels, Pending } from '../components/ui';
import {
  Box,
  Button,
  Flex,
  Heading,
  KeywordMentionRanking,
  PageHeader,
  ReportDistribution,
  ReportSection,
  ReportSheet,
  RouteTabs,
  ShareComparison,
  SourceGapPlot,
  TabNav,
  Text,
  WeeklyHeatmap,
  WeeklyPlot,
} from '../design-system';
import CombinedDetails from './CombinedDetails';

function KeywordNavigation({
  data,
  day,
  target,
  source,
}: {
  data: CombinedPayload;
  day: string;
  target: string;
  source?: BriefingSource;
}) {
  const home = briefingHomeHref(day, source);
  return (
    <RouteTabs label="키워드 브리핑 이동" segmented>
      <TabNav.Link active={!target} asChild>
        <Link to={home}>전체 브리핑</Link>
      </TabNav.Link>
      {data.metadata.targets.map(({ name }) => (
        <TabNav.Link key={name} active={name === target} asChild>
          <Link to={combinedKeywordHref(name, day, source)}>{name}</Link>
        </TabNav.Link>
      ))}
    </RouteTabs>
  );
}

type KeywordResult = ReturnType<typeof keywordResult>;
const formatCount = (count: number) => count.toLocaleString('ko-KR');
const formatShare = (count: number, total: number) =>
  (count / total).toLocaleString('ko-KR', {
    style: 'percent',
    maximumFractionDigits: 1,
  });

function WeeklyScope({ data, source }: { data: CombinedPayload; source?: BriefingSource }) {
  const { weeks } = data.weekly;
  const last = weeks.at(-1);
  return (
    <Text as="p" size="2" color="gray" mb="4">
      {weeks[0]?.start} ~ {last?.through} · 월요일 시작
      {last?.partial && ' · * 부분 집계'}
      {source !== 'kakao' && !data.pokergosu.available && ' · 포커고수 데이터 조회 불가'}
    </Text>
  );
}

function resultHeadline(result: KeywordResult) {
  const [first] = result.leaders;
  if (!first) return '분류를 마친 반응이 없습니다';
  const categories = result.leaders.map(({ label }) => labels[label]).join('·');
  return result.leaders.length === 1
    ? `${categories}이 가장 많았습니다`
    : `${categories} 공동 최다`;
}

function leadValue(result: Pick<KeywordResult, 'leaders' | 'classified'>) {
  const [first] = result.leaders;
  if (!first) return '';
  const categories = result.leaders.map(({ label }) => labels[label]).join('·');
  return `${categories} ${result.leaders.length > 1 ? '각 ' : ''}${formatCount(first.count)}건 (${formatShare(first.count, result.classified)})`;
}

function difference(result: KeywordResult) {
  const gap = result.positive - result.negative;
  if (!gap) return result.positive > 0 ? '긍정과 부정 건수가 같았습니다' : '긍정·부정 분류 0건';
  return gap > 0
    ? `긍정이 부정보다 ${formatCount(gap)}건 많았습니다`
    : `부정이 긍정보다 ${formatCount(-gap)}건 많았습니다`;
}

const sourceLabels = { kakao: '카톡', pokergosu: '포커고수' } as const;
const unitNote = (source?: BriefingSource) =>
  source === 'kakao'
    ? '카톡 대화 1개를 1건으로 셉니다.'
    : source === 'pokergosu'
      ? '포커고수 게시글 1개를 1건으로 셉니다.'
      : '카톡 대화와 포커고수 게시글은 각각 1건으로 셉니다.';

function SourceComparison({ result, data }: { result: KeywordResult; data: CombinedPayload }) {
  return (
    <ReportSection card title="출처별 결과">
      <Flex direction="column" gap="3" className="ds-briefing-source-results">
        {(['kakao', 'pokergosu'] as const).map((source) => {
          const counts = result.sources[source];
          return (
            <Box key={source}>
              <Heading as="h3" size="3" mb="1">
                {sourceLabels[source]}
              </Heading>
              {!data[source].available ? (
                <Text as="p" size="2" color="gray">
                  수집 데이터 없음
                </Text>
              ) : counts.classified === 0 ? (
                <Text as="p" size="2" color="gray">
                  분류 완료 0건
                </Text>
              ) : (
                <>
                  <Text as="p" size="3" weight="medium">
                    {leadValue(counts)} {counts.leaders.length > 1 ? '공동 최다' : '최다'}
                  </Text>
                  <Text as="p" size="2" color="gray">
                    {formatCount(counts.classified)}건 중 긍정 {formatCount(counts.positive)}건 ·
                    부정 {formatCount(counts.negative)}건
                  </Text>
                </>
              )}
            </Box>
          );
        })}
      </Flex>
      <Text as="p" size="1" color="gray" mt="4">
        카톡 대화와 포커고수 게시글은 각각 1건으로 셉니다. 판단 제외 건은 집계에서 뺐습니다.
      </Text>
    </ReportSection>
  );
}

function KeywordMentionsSection({
  data,
  source,
}: {
  data: CombinedPayload;
  source?: BriefingSource;
}) {
  const related = data.relatedKeywords ?? [];
  const origin = source ? `/${source}` : '/';
  return (
    <ReportSection
      card
      title={
        data.scope.target
          ? related.length
            ? '하위 키워드와 연관어'
            : '하위 키워드 언급'
          : '전체 하위 키워드 언급'
      }
      description="등록된 키워드를 선택하면 해당 글과 대화를 볼 수 있습니다."
    >
      <KeywordMentionRanking
        rows={data.keywordMentions}
        relatedRows={related}
        sources={source ? [source] : undefined}
        mentionHref={({ name, pokergosu }) =>
          mentionListHref(name, data.scope, source ?? (pokergosu ? 'pokergosu' : 'kakao'), origin)
        }
        sourceHref={({ name }, listSource) => mentionListHref(name, data.scope, listSource, origin)}
      />
      {(data.keywordMentions.length > 0 || related.length > 0) && (
        <Text as="p" size="1" color="gray" mt="3">
          {source === 'kakao'
            ? '카톡 대화를 확인해 키워드별로 대화당 1건을 셉니다.'
            : source === 'pokergosu'
              ? '포커고수 게시글·댓글을 확인해 키워드별로 게시글당 1건을 셉니다.'
              : '카톡 대화와 포커고수 게시글·댓글을 확인해 키워드별로 대화 또는 게시글당 1건을 셉니다.'}{' '}
          한 기록이 여러 키워드에 잡힐 수 있고, 띄어쓰기·기호만 다른 표기는 묶었습니다.
          {related.length > 0 && ' 연관어는 이 대상이 언급된 기록 중 2건 이상에 등장한 단어입니다.'}
          {source !== 'kakao' &&
            !data.pokergosu.available &&
            ' 포커고수 집계는 현재 확인할 수 없습니다.'}
        </Text>
      )}
    </ReportSection>
  );
}

function KeywordDetail({ data, source }: { data: CombinedPayload; source?: BriefingSource }) {
  const row = data.rows[0];
  if (!row) return <Empty>등록된 키워드를 찾을 수 없습니다.</Empty>;
  const result = keywordResult(row.kakao.counts, row.pokergosu.counts);
  const [leader] = result.leaders;
  const directionalLeader =
    result.leaders.length === 1 &&
    leader &&
    (leader.label === 'positive' || leader.label === 'negative');
  const headline = directionalLeader ? difference(result) : resultHeadline(result);
  const sourceSplit =
    !source && result.leaders.length === 1 && leader && data.pokergosu.available
      ? result.sources.kakao.distribution.find((item) => item.label === leader.label)?.count
      : undefined;
  const weekly = data.weekly.rows.find(({ id }) => id === row.id);
  return (
    <>
      <ReportSheet dashboard label={`${row.name} ${source ? sourceLabels[source] : '종합'} 결과`}>
        <div className="ds-keyword-overview">
          <ReportSection
            card
            title={source ? '분류 결과' : '종합 분류'}
            description={headline}
            actions={
              result.reviewable > 0 && (
                <div className="ds-classification-progress">
                  <Text size="2" weight="bold" as="p">
                    {formatCount(result.reviewable)}건 중 {formatCount(result.classified)}건 완료
                  </Text>
                  {result.reviewable > result.classified && (
                    <Text size="1" color="gray" as="p">
                      미분류 {formatCount(result.unreviewed)}건 · 판단 보류{' '}
                      {formatCount(result.uncertain)}건
                    </Text>
                  )}
                </div>
              )
            }
          >
            {result.classified > 0 ? (
              <>
                <ReportDistribution
                  label={source ? '분류 분포' : '종합 분류 분포'}
                  items={result.distribution.map(({ label, count }) => ({
                    label: labels[label],
                    tone: label,
                    count,
                  }))}
                />
                {!directionalLeader && result.positive + result.negative > 0 && (
                  <Text as="p" size="2" mt="3">
                    {difference(result)}.
                  </Text>
                )}
                {leader && sourceSplit !== undefined && (
                  <Text as="p" size="2" mt="3">
                    {labels[leader.label]} {formatCount(leader.count)}건 중 카톡{' '}
                    {formatCount(sourceSplit)}건, 포커고수 {formatCount(leader.count - sourceSplit)}
                    건입니다.
                  </Text>
                )}
              </>
            ) : (
              <figure
                className="ds-analysis-chart"
                aria-label={source ? '분류 분포' : '종합 분류 분포'}
              >
                <Empty>선택한 기간에 분류를 마친 반응이 없습니다.</Empty>
              </figure>
            )}
          </ReportSection>
          {!source && result.classified > 0 && <SourceComparison result={result} data={data} />}
        </div>
        <KeywordMentionsSection data={data} source={source} />
        {weekly && (
          <>
            <ReportSection card title="주간 긍정·부정 비율">
              <WeeklyScope data={data} source={source} />
              <WeeklyPlot
                label="주간 긍정·부정 비율"
                weeks={data.weekly.weeks}
                values={weekly.values}
                variant="share"
              />
              <Text as="p" size="1" color="gray">
                분모에 중립과 혼합을 포함합니다. 분류가 없는 주에는 비율을 표시하지 않습니다.
              </Text>
            </ReportSection>
            <ReportSection card title="주간 분류 건수">
              <WeeklyPlot
                label="주간 분류 건수"
                weeks={data.weekly.weeks}
                values={weekly.values}
                variant="volume"
              />
              <Text as="p" size="1" color="gray">
                위 비율의 분모입니다. ‘–’는 이 키워드의 날짜가 확인된 기록이 없는 주입니다.
              </Text>
            </ReportSection>
          </>
        )}
      </ReportSheet>
      <CombinedDetails data={data} source={source} />
    </>
  );
}

function BriefingIndex({
  data,
  day,
  source,
}: {
  data: CombinedPayload;
  day: string;
  source?: BriefingSource;
}) {
  const results = data.rows
    .map((row) => ({
      row,
      result: keywordResult(row.kakao.counts, row.pokergosu.counts),
    }))
    .sort((a, b) => b.result.classified - a.result.classified);
  const plotted = results.filter(({ result }) => result.classified > 0);
  const waiting = results.filter(({ result }) => result.classified === 0);
  const gaps = results
    .map(({ row, result }) => {
      const { kakao, pokergosu } = result.sources;
      return {
        id: row.id,
        name: row.name,
        kakao,
        pokergosu,
        gap:
          kakao.classified && pokergosu.classified
            ? Math.abs(
                kakao.negative / kakao.classified - pokergosu.negative / pokergosu.classified,
              )
            : -1,
      };
    })
    .sort((a, b) => b.gap - a.gap);
  const leadingWith = (label: 'positive' | 'negative') =>
    plotted.find(({ result }) => result.leaders.length === 1 && result.leaders[0]?.label === label);
  const positive = leadingWith('positive');
  const negative = leadingWith('negative');
  const highlights = [positive, negative].filter((entry) => entry !== undefined);
  const keywordLink = (name: string) => (
    <Button intent="quiet" size="2" asChild>
      <Link to={combinedKeywordHref(name, day, source)} aria-label={`${name} 상세 브리핑`}>
        <strong>{name}</strong>
        <ArrowUpRight size={12} />
      </Link>
    </Button>
  );
  return (
    <ReportSheet dashboard label={`${source ? sourceLabels[source] : '종합'} 여론 보고서`}>
      <div className="ds-overview-comparisons">
        {(plotted.length > 0 || waiting.length > 0) && (
          <ReportSection card title="키워드별 긍정·부정 비교">
            {highlights.length > 0 && (
              <div className="ds-briefing-highlights">
                {highlights.map(({ row, result }) => (
                  <div key={row.id}>
                    {keywordLink(row.name)}
                    <Text as="p" size="3" weight="bold">
                      {leadValue(result)}
                    </Text>
                  </div>
                ))}
              </div>
            )}
            {plotted.length ? (
              <ShareComparison
                label="키워드별 긍정·부정 비교"
                showValues={false}
                rows={plotted.map(({ row, result }) => ({
                  id: row.id,
                  name: row.name,
                  classified: result.classified,
                  negative: result.negative,
                  positive: result.positive,
                  href: combinedKeywordHref(row.name, day, source),
                  note: result.leaders.some(({ label }) => label === 'neutral' || label === 'mixed')
                    ? `${result.leaders.map(({ label }) => labels[label]).join('·')} ${result.leaders.length > 1 ? '동률' : '최다'}`
                    : undefined,
                }))}
              />
            ) : (
              <figure className="ds-analysis-chart" aria-label="키워드별 긍정·부정 비교">
                <Empty>선택한 기간에 분류를 마친 반응이 없습니다.</Empty>
              </figure>
            )}
            {waiting.length > 0 && (
              <Flex align="center" gap="2" wrap="wrap" mt="4">
                <Text size="1" color="gray">
                  분류 완료 0건
                </Text>
                {waiting.map(({ row }) => (
                  <Box key={row.id}>{keywordLink(row.name)}</Box>
                ))}
              </Flex>
            )}
            {plotted.length > 0 && (
              <Text as="p" size="1" color="gray" mt="4">
                분모에 중립과 혼합을 포함합니다. {unitNote(source)}
              </Text>
            )}
          </ReportSection>
        )}
        {!source && (
          <ReportSection card title="카톡·포커고수의 부정 비율 차이">
            <SourceGapPlot label="카톡·포커고수의 부정 비율 차이" rows={gaps} showValues={false} />
            {!data.pokergosu.available && (
              <Text as="p" size="2" color="gray" mt="3">
                포커고수 데이터 조회 불가
              </Text>
            )}
          </ReportSection>
        )}
      </div>
      <KeywordMentionsSection data={data} source={source} />
      <ReportSection card title="키워드별 주간 언급량">
        <WeeklyScope data={data} source={source} />
        <WeeklyHeatmap
          label="키워드별 주간 언급량"
          weeks={data.weekly.weeks}
          rows={data.weekly.rows.map(({ id, name, values }) => ({
            id,
            name,
            values: values.map((value) => value?.mentions ?? null),
          }))}
        />
        <Text as="p" size="1" color="gray" mt="3">
          단위 건. {unitNote(source)} 판단 제외 건은 뺐습니다. ‘–’는 이 키워드의 날짜가 확인된
          기록이 없는 주입니다.
        </Text>
      </ReportSection>
    </ReportSheet>
  );
}

const briefingTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function BriefingTime({ at }: { at: number | null }) {
  if (at === null) return '미확인';
  const parts = briefingTimeFormat.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((piece) => piece.type === type)?.value;
  return (
    <time dateTime={new Date(at).toISOString()}>
      {Number(part('month'))}.{Number(part('day'))} {part('hour')}:{part('minute')}
    </time>
  );
}

export default function Combined() {
  const { pathname, search } = useLocation();
  const scope = combinedScope(pathname, search);
  const detail = Boolean(scope.target);
  const { source } = scope;
  const pageTitle = source ? `${sourceLabels[source]} 여론` : '종합 여론';
  const query = useQuery({
    ...combinedQuery(scope),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  return (
    <>
      {data && (
        <KeywordNavigation
          data={data}
          day={scope.day}
          target={detail ? scope.target : ''}
          source={source}
        />
      )}
      <PageHeader
        className="ds-briefing-page-heading"
        title={detail ? `${scope.target} 여론` : pageTitle}
        actions={<Filters showTarget={false} />}
      >
        {data && !query.isPlaceholderData && (
          <div className="ds-briefing-status">
            <div className="ds-briefing-times">
              {!scope.day && (
                <Text as="span" size="1" color="gray" className="ds-briefing-period">
                  전체 기간
                </Text>
              )}
              <Text as="span" size="1" color="gray">
                집계 기준 <BriefingTime at={data.briefing.generatedAt} />
              </Text>
              {source !== 'kakao' && (
                <Text as="span" size="1" color="gray">
                  포커고수 마지막 수집 <BriefingTime at={data.briefing.pokergosuCollectedAt} />
                </Text>
              )}
            </div>
            <Button
              intent="quiet"
              size="1"
              aria-label="집계 결과 새로고침"
              title="집계 결과 새로고침"
              loading={query.isFetching}
              onClick={() => void query.refetch({ cancelRefetch: false })}
            >
              <RefreshCw size={13} />
              <span className="ds-briefing-refresh-label">집계 결과 새로고침</span>
            </Button>
          </div>
        )}
      </PageHeader>
      {query.isRefetchError && data && (
        <Text as="p" size="1" color="gray" mb="3" role="status">
          새로고침에 실패했습니다. 화면의 집계 기준 시각을 확인해 주세요.
        </Text>
      )}
      {query.isPending || query.isPlaceholderData ? (
        <Pending />
      ) : !data ? (
        <Failure error={query.error} retry={query.refetch} />
      ) : detail ? (
        <KeywordDetail data={data} source={source} />
      ) : (
        <BriefingIndex data={data} day={scope.day} source={source} />
      )}
    </>
  );
}
