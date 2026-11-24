import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import type {
  EmergingTerm,
  KeywordWeekChange,
  NotableChange,
  RepresentativeOpinion,
} from '@app/shared/monitoring/domain/briefing-insights';
import { shareSampleMinimum } from '@app/shared/monitoring/domain/briefing-insights';
import { ArrowUpRight } from 'lucide-react';
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

function ChangeLine({ change }: { change: NotableChange }) {
  if (change.kind === 'mentions')
    return (
      <>
        언급 {count(change.from)} → {count(change.to)}건{' '}
        <Text weight="bold">({mentionDelta(change.from, change.to)})</Text>
      </>
    );
  return (
    <>
      <span className="ds-chart-tone-label" data-tone={change.kind}>
        {change.kind === 'negative' ? '부정' : '긍정'} 비율
      </span>{' '}
      {percent(change.from)} → {percent(change.to)}{' '}
      <Text weight="bold">({shareDelta(change.from, change.to)})</Text>
    </>
  );
}

/** Index card: only the material week-over-week moves. */
export function WeeklyChangesCard({
  insights,
  day,
  source,
}: {
  insights: Insights;
  day: string;
  source?: BriefingSource;
}) {
  if (!insights.comparison) return null;
  return (
    <ReportSection card title="지난주 달라진 점" description={comparisonLabel(insights)}>
      {insights.notable.length ? (
        <ul className="ds-briefing-change-list">
          {insights.notable.map((change) => (
            <li key={`${change.target}:${change.kind}`}>
              <TextLink asChild weight="bold">
                <Link to={combinedKeywordHref(change.target, day, source)}>{change.target}</Link>
              </TextLink>{' '}
              <ChangeLine change={change} />
            </li>
          ))}
        </ul>
      ) : (
        <Text as="p" size="2">
          지난주와 비교해 크게 달라진 키워드가 없습니다.
        </Text>
      )}
      <Text as="p" size="1" color="gray" mt="3">
        언급은 10건 이상에서 30% 넘게, 긍정·부정 비율은 10%p 넘게 움직인 경우만 보여줍니다. 비율은
        두 주 모두 분류 {shareSampleMinimum}건 이상일 때만 비교합니다.
      </Text>
    </ReportSection>
  );
}

function ShareCell({ label, value }: { label: string; value: KeywordWeekChange['negativeShare'] }) {
  return (
    <div>
      <Text as="p" size="1" color="gray">
        {label}
      </Text>
      {value ? (
        <Text as="p" size="3" weight="bold">
          {percent(value.from)} → {percent(value.to)}{' '}
          <Text size="2" color="gray" weight="regular">
            {shareDelta(value.from, value.to)}
          </Text>
        </Text>
      ) : (
        <Text as="p" size="2" color="gray">
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
        <div>
          <Text as="p" size="1" color="gray">
            언급
          </Text>
          <Text as="p" size="3" weight="bold">
            {count(change.mentions.from)} → {count(change.mentions.to)}건{' '}
            <Text size="2" color="gray" weight="regular">
              {mentionDelta(change.mentions.from, change.mentions.to)}
            </Text>
          </Text>
        </div>
        <ShareCell label="긍정 비율" value={change.positiveShare} />
        <ShareCell label="부정 비율" value={change.negativeShare} />
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

function ReasonColumn({
  label,
  items,
  origin,
}: {
  label: 'positive' | 'negative';
  items: RepresentativeOpinion[];
  origin: string;
}) {
  return (
    <div>
      <Text as="p" size="2" weight="bold" className="ds-chart-tone-label" data-tone={label} mb="2">
        {label === 'positive' ? '긍정' : '부정'}
      </Text>
      {items.length ? (
        <ul className="ds-briefing-reason-list">
          {items.map((item) => (
            <Reason key={`${item.source}:${item.id}`} item={item} origin={origin} />
          ))}
        </ul>
      ) : (
        <Text as="p" size="2" color="gray">
          요약이 저장된 의견이 없습니다.
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
        {rows.map(({ target, positive, negative }) => (
          <section
            key={target}
            className="ds-briefing-reason-row"
            aria-label={`${target} 대표 의견`}
          >
            <TextLink asChild weight="bold">
              <Link to={combinedKeywordHref(target, day, source)}>{target}</Link>
            </TextLink>
            <ReasonColumn label="positive" items={positive.slice(0, 1)} origin={origin} />
            <ReasonColumn label="negative" items={negative.slice(0, 1)} origin={origin} />
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

function TermList({ terms, showTarget }: { terms: EmergingTerm[]; showTarget: boolean }) {
  return (
    <ul className="ds-briefing-term-list">
      {terms.map((term) => (
        <li key={`${term.target}:${term.name}`}>
          <Text size="3" weight="bold">
            {term.name}
          </Text>
          {showTarget && term.target && term.target !== term.name && (
            <Text size="1" color="gray">
              {term.target}
            </Text>
          )}
          <Badge size="1" color={term.kind === 'new' ? 'iris' : 'amber'} variant="soft">
            {term.kind === 'new' ? '새로 등장' : '급증'}
          </Badge>
          <Text size="1" color="gray">
            최근 7일 {count(term.recent)}건
            {term.kind === 'rising' && ` · 이전 4주 ${count(term.prior)}건`}
          </Text>
        </li>
      ))}
    </ul>
  );
}

const emergingNote =
  '최근 7일을 그 전 4주와 비교합니다. 새로 등장은 이전 4주 0건에서 2건 이상, 급증은 4건 이상이면서 이전 주 평균의 2배 이상입니다. 평균은 수집 기록이 있는 기간으로만 냅니다.';

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
