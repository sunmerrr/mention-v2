import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import type {
  EmergingTerm,
  RepresentativeOpinion,
} from '@app/shared/monitoring/domain/briefing-insights';
import { shareSampleMinimum } from '@app/shared/monitoring/domain/briefing-insights';
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type BriefingSource, combinedKeywordHref } from '../combined-query';
import { Badge, ReportSection, Text, TextLink } from '../design-system';
import { relatedHref } from '../navigation';

type Insights = CombinedPayload['insights'];
const sourceLabels = { kakao: '카톡', pokergosu: '포커고수' } as const;
const count = (n: number) => n.toLocaleString('ko-KR');
const percent = (share: number) => `${Math.round(share * 100)}%`;
const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const dayFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
});

function comparisonLabel(insights: Insights) {
  const pair = insights.comparison;
  if (!pair) return '';
  return `${shortDay(pair.current.start)}~${shortDay(pair.current.through)} 주를 그 전 주(${shortDay(pair.previous.start)}~${shortDay(pair.previous.through)})와 비교했습니다.`;
}

function shareDelta(from: number, to: number) {
  const points = Math.round((to - from) * 100);
  return `${points > 0 ? '+' : points < 0 ? '−' : '±'}${Math.abs(points)}%p`;
}

function mentionDelta(from: number, to: number) {
  if (!from) return to ? '새로 집계' : '변화 없음';
  const rate = Math.round(((to - from) / from) * 100);
  return `${rate > 0 ? '+' : rate < 0 ? '−' : '±'}${Math.abs(rate)}%`;
}

type Metric = 'mentions' | 'positive' | 'negative';
const metricLabels: Record<Metric, string> = {
  mentions: '언급',
  positive: '긍정 비율',
  negative: '부정 비율',
};

/** Rising negative or falling positive share reads as a warning; volume is neutral. */
function signalOf(metric: Metric, from: number, to: number) {
  if (to === from || metric === 'mentions') return 'neutral';
  return to > from === (metric === 'positive') ? 'good' : 'bad';
}

function DeltaChip({ metric, from, to }: { metric: Metric; from: number; to: number }) {
  const Icon = to > from ? TrendingUp : to < from ? TrendingDown : Minus;
  return (
    <span className="ds-briefing-delta" data-signal={signalOf(metric, from, to)}>
      <Icon size={13} aria-hidden="true" />
      {metric === 'mentions' ? mentionDelta(from, to) : shareDelta(from, to)}
    </span>
  );
}

function Values({ metric, from, to }: { metric: Metric; from: number; to: number }) {
  const format = (value: number) => (metric === 'mentions' ? `${count(value)}건` : percent(value));
  return (
    <span className="ds-briefing-values">
      <span className="ds-briefing-values-from">{format(from)}</span>
      <span className="ds-briefing-arrow" aria-hidden="true">
        →
      </span>
      <span className="ds-briefing-values-to">{format(to)}</span>
    </span>
  );
}

type Weekly = CombinedPayload['weekly'];
type WeekValue = NonNullable<Weekly['rows'][number]['values'][number]>;

const verbs = {
  negative: ['부정 비율이 올랐습니다', '부정 비율이 내렸습니다'],
  positive: ['긍정 비율이 올랐습니다', '긍정 비율이 내렸습니다'],
  mentions: ['언급이 늘었습니다', '언급이 줄었습니다'],
} as const;

function weekMetric(metric: Metric, value: WeekValue | null) {
  if (!value) return null;
  if (metric === 'mentions') return value.mentions;
  return value.classified >= shareSampleMinimum ? value[metric] / value.classified : null;
}

/** Weekly bars up to the compared week; the two compared weeks are labeled and colored. */
function WeekBars({
  metric,
  weeks,
  values,
  previous,
  current,
}: {
  metric: Metric;
  weeks: Weekly['weeks'];
  values: Weekly['rows'][number]['values'];
  previous: number;
  current: number;
}) {
  // Start at the first week with data, at most eight weeks back, and always include both compared weeks.
  const earliest = Math.max(0, current - 7);
  const withData = values.findIndex(
    (value, index) => index >= earliest && weekMetric(metric, value) !== null,
  );
  const first = Math.min(previous, withData < 0 ? previous : withData);
  const points = weeks.slice(first, current + 1).map((week, offset) => {
    const index = first + offset;
    return { week, index, value: weekMetric(metric, values[index] ?? null) };
  });
  const top = metric === 'mentions' ? Math.max(1, ...points.map(({ value }) => value ?? 0)) : 1;
  const format = (value: number) => (metric === 'mentions' ? count(value) : percent(value));
  return (
    <div className="ds-briefing-bars" data-metric={metric}>
      {points.map(({ week, index, value }) => {
        const role = index === current ? 'current' : index === previous ? 'previous' : 'other';
        return (
          <div key={week.start} className="ds-briefing-bar" data-role={role}>
            <span className="ds-briefing-bar-value">
              {role !== 'other' && (value === null ? '표본 부족' : format(value))}
            </span>
            <span className="ds-briefing-bar-track">
              {value !== null && (
                <span
                  className="ds-briefing-bar-fill"
                  style={{ blockSize: `${Math.max(value / top, 0.02) * 100}%` }}
                />
              )}
            </span>
            <span className="ds-briefing-bar-week">{shortDay(week.start)}</span>
          </div>
        );
      })}
    </div>
  );
}

function sampleNote(metric: Metric, value: WeekValue | null) {
  if (!value) return '';
  if (metric === 'mentions')
    return `언급 ${count(value.mentions)}건 중 분류 ${count(value.classified)}건`;
  return `분류 ${count(value.classified)}건 중 ${metric === 'negative' ? '부정' : '긍정'} ${count(value[metric])}건`;
}

/** Index card: only the material week-over-week moves, each with its weekly trend. */
export function WeeklyChangesCard({
  insights,
  weekly,
  day,
  source,
}: {
  insights: Insights;
  weekly: Weekly;
  day: string;
  source?: BriefingSource;
}) {
  const pair = insights.comparison;
  if (!pair) return null;
  const current = weekly.weeks.findIndex(({ start }) => start === pair.current.start);
  const previous = weekly.weeks.findIndex(({ start }) => start === pair.previous.start);
  return (
    <ReportSection card title="지난주 달라진 점" description={comparisonLabel(insights)}>
      {insights.notable.length ? (
        <ul className="ds-briefing-change-cards">
          {insights.notable.map((change) => {
            const row = weekly.rows.find(({ name }) => name === change.target);
            const signal = signalOf(change.kind, change.from, change.to);
            return (
              <li
                key={`${change.target}:${change.kind}`}
                className="ds-briefing-change-card"
                data-signal={signal}
                data-metric={change.kind}
              >
                <div className="ds-briefing-change-head">
                  <TextLink asChild weight="bold" size="3">
                    <Link to={combinedKeywordHref(change.target, day, source)}>
                      {change.target}
                    </Link>
                  </TextLink>
                  <DeltaChip metric={change.kind} from={change.from} to={change.to} />
                </div>
                <p className="ds-briefing-change-sentence">
                  {verbs[change.kind][change.to >= change.from ? 0 : 1]}
                </p>
                <Values metric={change.kind} from={change.from} to={change.to} />
                {row && current >= 0 && previous >= 0 && (
                  <WeekBars
                    metric={change.kind}
                    weeks={weekly.weeks}
                    values={row.values}
                    previous={previous}
                    current={current}
                  />
                )}
                <Text as="p" size="1" color="gray">
                  {shortDay(pair.current.start)} 주{' '}
                  {sampleNote(change.kind, row?.values[current] ?? null)}
                </Text>
              </li>
            );
          })}
        </ul>
      ) : (
        <Text as="p" size="2">
          지난주와 비교해 크게 달라진 키워드가 없습니다.
        </Text>
      )}
      <Text as="p" size="1" color="gray" mt="3">
        언급 10건 이상에서 ±30%, 비율 ±10%p 이상 움직인 경우만 보여줍니다. 비율은 분류{' '}
        {shareSampleMinimum}건 이상인 주만 계산합니다. 막대는 주별 값이고, 색이 진한 막대가 비교한
        두 주입니다.
      </Text>
    </ReportSection>
  );
}

function ChangeTile({
  metric,
  value,
}: {
  metric: Metric;
  value: { from: number; to: number } | null;
}) {
  return (
    <div className="ds-briefing-change-tile">
      <span className="ds-chart-tone-label" data-tone={metric === 'mentions' ? undefined : metric}>
        {metricLabels[metric]}
      </span>
      {value ? (
        <>
          <Values metric={metric} from={value.from} to={value.to} />
          <DeltaChip metric={metric} from={value.from} to={value.to} />
        </>
      ) : (
        <Text size="2" color="gray" className="ds-briefing-change-empty">
          표본 부족
        </Text>
      )}
    </div>
  );
}

/** Detail card: the selected keyword's numbers for both weeks, without thresholds. */
export function KeywordChangeCard({ insights, target }: { insights: Insights; target: string }) {
  const change = insights.changes.find((item) => item.target === target);
  if (!insights.comparison || !change) return null;
  return (
    <ReportSection card title="지난주 대비" description={comparisonLabel(insights)}>
      <div className="ds-briefing-change-grid">
        <ChangeTile metric="mentions" value={change.mentions} />
        <ChangeTile metric="positive" value={change.positiveShare} />
        <ChangeTile metric="negative" value={change.negativeShare} />
      </div>
      <Text as="p" size="1" color="gray" mt="3">
        비율은 두 주 모두 분류 {shareSampleMinimum}건 이상일 때만 비교합니다.
      </Text>
    </ReportSection>
  );
}

function Reason({ item, origin }: { item: RepresentativeOpinion; origin: string }) {
  return (
    <li className="ds-briefing-reason" data-tone={item.label}>
      <Text as="p" size="2" className="ds-briefing-reason-summary">
        {item.summary}
      </Text>
      <Text as="p" size="1" color="gray" mt="1">
        {sourceLabels[item.source]}
        {item.title && ` · ${item.title}`} · {dayFormat.format(item.at)}{' '}
        <TextLink asChild size="1">
          <Link to={relatedHref(item.href, origin)} aria-label={`${item.target} 원문 보기`}>
            원문
            <ArrowUpRight size={11} aria-hidden="true" />
          </Link>
        </TextLink>
      </Text>
    </li>
  );
}

const stanceLabels = { positive: '긍정', negative: '부정' } as const;

function ReasonColumn({
  label,
  items,
  origin,
  heading = true,
}: {
  label: 'positive' | 'negative';
  items: RepresentativeOpinion[];
  origin: string;
  /** The index card names the stance once in its header row on wide screens. */
  heading?: boolean;
}) {
  return (
    <div className="ds-briefing-reason-column" data-heading={heading ? 'always' : 'narrow'}>
      <Text as="p" size="2" weight="bold" className="ds-briefing-stance" data-tone={label} mb="2">
        {stanceLabels[label]}
      </Text>
      {items.length ? (
        <ul className="ds-briefing-reason-list">
          {items.map((item) => (
            <Reason key={`${item.source}:${item.id}`} item={item} origin={origin} />
          ))}
        </ul>
      ) : (
        <Text as="p" size="2" color="gray" className="ds-briefing-reason-empty">
          요약이 저장된 {stanceLabels[label]} 의견이 없습니다.
        </Text>
      )}
    </div>
  );
}

const reasonsNote =
  '분류할 때 저장한 요약을 최근 순으로 보여줍니다. 카톡은 메시지 3개 이상인 대화를 먼저 고릅니다.';

/** Index card: one positive and one negative reason per keyword. */
export function RepresentativesCard({
  insights,
  day,
  source,
}: {
  insights: Insights;
  day: string;
  source?: BriefingSource;
}) {
  const origin = source ? `/${source}` : '/';
  const rows = insights.representatives.filter(
    ({ positive, negative }) => positive.length + negative.length > 0,
  );
  if (!rows.length) return null;
  return (
    <ReportSection card title="키워드별 대표 의견" description="긍정·부정으로 분류된 이유입니다.">
      <div className="ds-briefing-reason-rows">
        <div className="ds-briefing-reason-head" aria-hidden="true">
          <span />
          <span className="ds-briefing-stance" data-tone="positive">
            긍정 이유
          </span>
          <span className="ds-briefing-stance" data-tone="negative">
            부정 이유
          </span>
        </div>
        {rows.map(({ target, positive, negative }) => (
          <section
            key={target}
            className="ds-briefing-reason-row"
            aria-label={`${target} 대표 의견`}
          >
            <TextLink asChild weight="bold" size="3" className="ds-briefing-reason-target">
              <Link to={combinedKeywordHref(target, day, source)}>
                {target}
                <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            </TextLink>
            <ReasonColumn
              label="positive"
              items={positive.slice(0, 1)}
              origin={origin}
              heading={false}
            />
            <ReasonColumn
              label="negative"
              items={negative.slice(0, 1)}
              origin={origin}
              heading={false}
            />
          </section>
        ))}
      </div>
      <Text as="p" size="1" color="gray" mt="3">
        {reasonsNote} 키워드를 누르면 의견을 더 볼 수 있습니다.
      </Text>
    </ReportSection>
  );
}

/** Detail card: up to three reasons for each stance. */
export function KeywordReasonsCard({
  insights,
  target,
  source,
}: {
  insights: Insights;
  target: string;
  source?: BriefingSource;
}) {
  const row = insights.representatives.find((item) => item.target === target);
  if (!row) return null;
  return (
    <ReportSection card title="긍정·부정 이유" description="분류된 의견의 요약입니다.">
      <div className="ds-briefing-reason-columns">
        <ReasonColumn label="positive" items={row.positive} origin={source ? `/${source}` : '/'} />
        <ReasonColumn label="negative" items={row.negative} origin={source ? `/${source}` : '/'} />
      </div>
      <Text as="p" size="1" color="gray" mt="3">
        {reasonsNote}
      </Text>
    </ReportSection>
  );
}

function TermChip({ term, showTarget }: { term: EmergingTerm; showTarget: boolean }) {
  return (
    <li className="ds-briefing-term" data-kind={term.kind}>
      <span className="ds-briefing-term-name">{term.name}</span>
      {showTarget && term.target && term.target !== term.name && (
        <span className="ds-briefing-term-target">{term.target}</span>
      )}
      <span className="ds-briefing-term-count">
        {term.kind === 'rising' && (
          <>
            <span className="ds-briefing-values-from">4주 {count(term.prior)}</span>
            <span className="ds-briefing-arrow" aria-hidden="true">
              →
            </span>
          </>
        )}
        <span className="ds-briefing-values-to">7일 {count(term.recent)}건</span>
      </span>
    </li>
  );
}

function TermList({ terms, showTarget }: { terms: EmergingTerm[]; showTarget: boolean }) {
  const groups = [
    { kind: 'new' as const, label: '새로 등장', color: 'iris' as const },
    { kind: 'rising' as const, label: '급증', color: 'amber' as const },
  ];
  return (
    <div className="ds-briefing-term-groups">
      {groups.map(({ kind, label, color }) => {
        const items = terms.filter((term) => term.kind === kind);
        if (!items.length) return null;
        return (
          <div key={kind} className="ds-briefing-term-group">
            <Badge size="2" color={color} variant="soft">
              {label} {items.length}
            </Badge>
            <ul className="ds-briefing-term-list">
              {items.map((term) => (
                <TermChip key={`${term.target}:${term.name}`} term={term} showTarget={showTarget} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const emergingNote =
  '새로 등장: 이전 4주 0건 → 최근 7일 2건 이상. 급증: 최근 7일 4건 이상이면서 이전 주 평균의 2배 이상(수집 기록이 있는 주로만 평균).';

function EmptyTerms({ priorWeeks, children }: { priorWeeks: number; children: string }) {
  return (
    <Text as="p" size="2">
      {priorWeeks < 1 ? '비교할 이전 기록이 1주 미만이라 아직 판단하지 않습니다.' : children}
    </Text>
  );
}

/** Index card: subkeywords that started or surged in the last seven days. */
export function EmergingCard({ insights }: { insights: Insights }) {
  const emerging = insights.emerging;
  if (!emerging) return null;
  return (
    <ReportSection
      card
      title="새로 떠오른 키워드"
      description={`${shortDay(emerging.window.recent.from)}~${shortDay(emerging.window.recent.through)} 기준`}
    >
      {emerging.subkeywords.length ? (
        <TermList terms={emerging.subkeywords} showTarget />
      ) : (
        <EmptyTerms priorWeeks={emerging.priorWeeks}>
          최근 7일에 새로 등장하거나 급증한 하위 키워드가 없습니다.
        </EmptyTerms>
      )}
      <Text as="p" size="1" color="gray" mt="3">
        {emergingNote}
      </Text>
    </ReportSection>
  );
}

/** Detail card: new related words and subkeywords for the selected keyword. */
export function KeywordEmergingCard({ insights }: { insights: Insights }) {
  const emerging = insights.emerging;
  if (!emerging) return null;
  const terms = [...emerging.subkeywords, ...emerging.related];
  return (
    <ReportSection
      card
      title="새로 떠오른 단어"
      description={`${shortDay(emerging.window.recent.from)}~${shortDay(emerging.window.recent.through)} 기준 · 하위 키워드와 연관어`}
    >
      {terms.length ? (
        <TermList terms={terms} showTarget={false} />
      ) : (
        <EmptyTerms priorWeeks={emerging.priorWeeks}>
          최근 7일에 새로 등장하거나 급증한 단어가 없습니다.
        </EmptyTerms>
      )}
      <Text as="p" size="1" color="gray" mt="3">
        {emergingNote}
      </Text>
    </ReportSection>
  );
}
