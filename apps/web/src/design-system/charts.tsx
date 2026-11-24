import { lazy, type ReactNode, Suspense, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  chartNumber as number,
  chartPercent as percent,
  useChartMotion,
  useChartSelection,
} from './chart-interaction';
import { KeywordWordCloud } from './KeywordWordCloud';
import { Disclosure } from './patterns';
import { Badge, Button, Table, Text, TextLink, VisuallyHidden } from './primitives';
import type { ComparisonPoint } from './RechartsReportPlots';
import type { SourceGapRow } from './SourceGapScatter';

type KeywordMentionRow = {
  name: string;
  variants: string[];
  kakao: number;
  pokergosu: number | null;
  total: number;
};
const sourceLabels = { kakao: '카톡', pokergosu: '포커고수' } as const;
const sourceKeys = ['kakao', 'pokergosu'] as const;

export function KeywordMentionRanking({
  rows,
  relatedRows = [],
  mentionHref,
  sourceHref,
}: {
  rows: KeywordMentionRow[];
  relatedRows?: KeywordMentionRow[];
  mentionHref?: (row: KeywordMentionRow) => string;
  sourceHref?: (row: KeywordMentionRow, source: keyof typeof sourceLabels) => string;
}) {
  const hasRelated = relatedRows.length > 0;
  if (!rows.length && !hasRelated)
    return (
      <Text as="p" size="2" color="gray">
        선택한 기간에 일치한 하위 키워드가 없습니다.
      </Text>
    );

  const linkedRows = [
    ...rows.map((row) => ({
      ...row,
      href: mentionHref?.(row),
      related: false,
    })),
    ...relatedRows.map((row) => ({ ...row, href: undefined, related: true })),
  ];
  if (hasRelated) linkedRows.sort((a, b) => b.total - a.total);
  return (
    <div className="ds-keyword-mentions">
      <Table.Root size="1" className="ds-keyword-mention-table">
        <caption>
          <VisuallyHidden>
            {hasRelated ? '하위 키워드·연관어 언급 순위' : '하위 키워드 언급 순위'}
          </VisuallyHidden>
        </caption>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>순위</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{hasRelated ? '키워드' : '하위 키워드'}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">합계</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">카톡</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">포커고수</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {linkedRows.map((row) => {
            const { name, variants, total, href, related } = row;
            return (
              <Table.Row key={name}>
                <Table.Cell>
                  <Text color="gray">{linkedRows.findIndex((row) => row.total === total) + 1}</Text>
                </Table.Cell>
                <Table.RowHeaderCell>
                  {href ? (
                    <TextLink asChild weight="bold" underline="always">
                      <Link to={href}>{name}</Link>
                    </TextLink>
                  ) : (
                    <Text weight="bold">{name}</Text>
                  )}
                  {related && (
                    <Badge size="1" color="gray" ml="1">
                      연관어
                    </Badge>
                  )}
                  {variants.length > 0 && (
                    <Text as="div" size="1" color="gray">
                      {variants.join(' · ')}
                    </Text>
                  )}
                </Table.RowHeaderCell>
                <Table.Cell justify="end">
                  <Text weight="bold">{number.format(total)}</Text>
                </Table.Cell>
                {sourceKeys.map((source) => {
                  const count = row[source];
                  const value = count === null ? '–' : number.format(count);
                  const url = !related && count && sourceHref?.(row, source);
                  return (
                    <Table.Cell key={source} justify="end">
                      {url ? (
                        <TextLink asChild underline="always">
                          <Link to={url} aria-label={`${name} ${sourceLabels[source]} ${value}건`}>
                            {value}
                          </Link>
                        </TextLink>
                      ) : (
                        value
                      )}
                    </Table.Cell>
                  );
                })}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
      <KeywordWordCloud rows={linkedRows} />
    </div>
  );
}

const SourceGapScatter = lazy(() => import('./SourceGapScatter'));

const SharePlot = lazy(() =>
  import('./RechartsReportPlots').then(({ SharePlot }) => ({
    default: SharePlot,
  })),
);
const WeeklyChart = lazy(() =>
  import('./RechartsReportPlots').then(({ WeeklyChart }) => ({
    default: WeeklyChart,
  })),
);

function ChartReadout({
  columns,
  rows,
}: {
  columns: string[];
  rows: { id: string; name: string; values: ReactNode[] }[];
}) {
  return (
    <Disclosure title="키워드별 수치">
      <Table.Root size="1" className="ds-chart-readout">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>키워드</Table.ColumnHeaderCell>
            {columns.map((column) => (
              <Table.ColumnHeaderCell key={column}>{column}</Table.ColumnHeaderCell>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map(({ id, name, values }) => (
            <Table.Row key={id}>
              <Table.RowHeaderCell>{name}</Table.RowHeaderCell>
              {columns.map((column, index) => (
                <Table.Cell key={column}>{values[index]}</Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Disclosure>
  );
}

export function ShareComparison({
  label,
  rows,
  showValues = true,
}: {
  label: string;
  rows: ComparisonPoint[];
  showValues?: boolean;
}) {
  const selection = useChartSelection();
  const active = rows.find(({ id }) => id === selection.active) ?? rows[0];
  return (
    <figure className="ds-analysis-chart" aria-label={label}>
      <Suspense fallback={null}>
        <SharePlot rows={rows} selection={selection} />
      </Suspense>
      {active && (
        <VisuallyHidden aria-live="polite">
          <span>
            <strong>{active.name}</strong>
          </span>
          <span data-tone="negative">
            <i />
            부정 <strong>{percent(active.negative / active.classified)}</strong>
          </span>
          <span data-tone="positive">
            <i />
            긍정 <strong>{percent(active.positive / active.classified)}</strong>
          </span>
          <span>분류 {number.format(active.classified)}건</span>
          {active.note && <span>{active.note}</span>}
        </VisuallyHidden>
      )}
      {showValues && (
        <ChartReadout
          columns={['부정', '긍정', '분류']}
          rows={rows.map((row) => ({
            id: row.id,
            name: row.name,
            values: [
              percent(row.negative / row.classified),
              percent(row.positive / row.classified),
              <>
                {number.format(row.classified)}건
                {row.note && (
                  <Text as="div" size="1" color="gray">
                    {row.note}
                  </Text>
                )}
              </>,
            ],
          }))}
        />
      )}
    </figure>
  );
}

const sourceRowHeight = 55;
const sourceAxisHeight = 27;
const sourceRowHeading = 15;
const minimumSourceSample = 5;

function comparable(row: SourceGapRow) {
  return row.kakao.classified > 0 && row.pokergosu.classified > 0;
}

function smallSample(row: SourceGapRow) {
  return (
    comparable(row) &&
    Math.min(row.kakao.classified, row.pokergosu.classified) < minimumSourceSample
  );
}

function SourceValue({ value }: { value: SourceGapRow['kakao'] }) {
  return value.classified ? (
    <>
      <strong>{percent(value.negative / value.classified)}</strong>
      <Text as="div" size="1" color="gray">
        {number.format(value.negative)}/{number.format(value.classified)}건
      </Text>
    </>
  ) : (
    '분류 없음'
  );
}

function GapReadout({ row }: { row: SourceGapRow }) {
  const { kakao, pokergosu } = row;
  const both = comparable(row);
  const delta = both
    ? 100 * (kakao.negative / kakao.classified - pokergosu.negative / pokergosu.classified)
    : 0;
  const gap = Math.abs(delta) < 0.1 ? '0.1%p 미만' : `${number.format(Math.abs(delta))}%p`;
  return (
    <div className="ds-source-gap-readout" role="status">
      <div className="ds-source-gap-header">
        <Text
          as="span"
          size="3"
          weight="bold"
          className="ds-source-gap-active-name"
          title={row.name}
        >
          {row.name}
        </Text>
        <Badge size="2" color={both && delta ? 'iris' : 'gray'}>
          {both
            ? delta
              ? `${delta > 0 ? '카톡' : '포커고수'} +${gap}`
              : '동률'
            : '출처 한 곳만 분류됨'}
        </Badge>
      </div>
      <Text as="p" size="1" color={smallSample(row) ? 'amber' : 'gray'}>
        {smallSample(row)
          ? `표본 적음 · 한 출처의 분류가 ${minimumSourceSample}건 미만`
          : '출처별 분류 완료 건수 기준'}
      </Text>
      <div className="ds-source-gap-metrics">
        {sourceKeys.map((source) => {
          const value = row[source];
          return (
            <div className="ds-source-gap-metric" key={source} data-source={source}>
              <Text size="1" weight="medium" as="span" className="ds-source-gap-metric-label">
                <i aria-hidden="true" />
                {sourceLabels[source]}
              </Text>
              <Text size="5" weight="bold" as="p">
                {value.classified ? percent(value.negative / value.classified) : '–'}
              </Text>
              <Text size="1" color="gray" as="p">
                {value.classified
                  ? `부정 ${number.format(value.negative)}건 / 분류 ${number.format(value.classified)}건`
                  : '분류 없음'}
              </Text>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SourceGapPlot({
  label,
  rows,
  showValues = true,
}: {
  label: string;
  rows: SourceGapRow[];
  showValues?: boolean;
}) {
  const plotted = useMemo(
    () => rows.filter(({ kakao, pokergosu }) => kakao.classified || pokergosu.classified),
    [rows],
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const selected =
    plotted.find(({ id }) => id === selectedId) ??
    plotted.find((row) => comparable(row) && !smallSample(row)) ??
    plotted.find(comparable) ??
    plotted[0];
  const active = plotted.find(({ id }) => id === previewId) ?? selected;

  return (
    <figure aria-label={label} className="ds-analysis-chart">
      {!active ? (
        <Text as="p" size="2" color="gray">
          선택한 기간에 출처별 분류 결과가 없습니다.
        </Text>
      ) : (
        <>
          <GapReadout row={active} />
          <div
            className="ds-source-gap-plot"
            style={{
              height: plotted.length * sourceRowHeight + sourceAxisHeight + sourceRowHeading,
            }}
          >
            <Suspense fallback={null}>
              <SourceGapScatter
                rows={plotted}
                activeIndex={plotted.indexOf(active)}
                rowHeight={sourceRowHeight}
                axisHeight={sourceAxisHeight}
                headingHeight={sourceRowHeading}
              />
            </Suspense>
            <div className="ds-source-gap-options" style={{ paddingBottom: sourceAxisHeight }}>
              {plotted.map((row) => (
                <Button
                  type="button"
                  intent="quiet"
                  key={row.id}
                  aria-label={`${row.name} 출처 비교`}
                  aria-description={`카톡 분류 ${number.format(row.kakao.classified)}건 · 포커고수 분류 ${number.format(row.pokergosu.classified)}건`}
                  aria-pressed={row.id === selected?.id}
                  data-active={row.id === active.id}
                  className="ds-source-gap-option"
                  style={{ height: sourceRowHeight }}
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse') setPreviewId(row.id);
                  }}
                  onPointerLeave={() => setPreviewId(undefined)}
                  onClick={() => {
                    setPreviewId(undefined);
                    setSelectedId(row.id);
                  }}
                >
                  <span className="ds-chart-row-heading">
                    <span className="ds-chart-row-name" title={row.name}>
                      {row.name}
                    </span>
                    <span className="ds-chart-row-metrics">
                      {sourceKeys.map((source) => (
                        <span key={source}>
                          {sourceLabels[source]} {number.format(row[source].classified)}건
                        </span>
                      ))}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </div>
          {showValues && (
            <ChartReadout
              columns={['카톡', '포커고수']}
              rows={plotted.map(({ id, name, kakao, pokergosu }) => ({
                id,
                name,
                values: [
                  <SourceValue key="kakao" value={kakao} />,
                  <SourceValue key="pokergosu" value={pokergosu} />,
                ],
              }))}
            />
          )}
        </>
      )}
    </figure>
  );
}

type ChartWeek = { start: string; through: string; partial: boolean };
function shortDay(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function weekTick(week: ChartWeek) {
  return shortDay(week.start) + (week.partial ? '*' : '');
}

function WeekLabel({ week }: { week: ChartWeek }) {
  return (
    <time dateTime={week.start} title={`${week.start} ~ ${week.through}`}>
      <span className="ds-week-month">{Number(week.start.slice(5, 7))}/</span>
      {Number(week.start.slice(8))}
      {week.partial && (
        <>
          <sup aria-hidden="true">*</sup>
          <VisuallyHidden>부분 집계</VisuallyHidden>
        </>
      )}
    </time>
  );
}

type HeatRow = { id: string; name: string; values: (number | null)[] };
const compactCount = new Intl.NumberFormat('ko-KR', { notation: 'compact' });

export function WeeklyHeatmap({
  label,
  weeks,
  rows,
}: {
  label: string;
  weeks: ChartWeek[];
  rows: HeatRow[];
}) {
  const ref = useRef<HTMLElement>(null);
  const animate = useChartMotion(ref);
  const peak = Math.max(0, ...rows.flatMap(({ values }) => values.map((value) => value ?? 0)));
  const dates = weeks.map(weekTick);
  const selection = useChartSelection();
  const activeRow = rows.find(({ id }) =>
    dates.some((date) => `${id}:${date}` === selection.active),
  );
  const activeIndex = dates.findIndex((date) => `${activeRow?.id}:${date}` === selection.active);
  const activeValue = activeRow?.values[activeIndex];
  const activeWeek = weeks[activeIndex];
  return (
    <figure
      className="ds-analysis-chart"
      aria-label={label}
      ref={ref}
      data-chart-reveal={animate || undefined}
    >
      <div className="ds-heatmap-header">
        <div className="ds-chart-readout" aria-live="polite">
          {activeRow && activeWeek && (
            <Text size="1">
              {activeRow.name} · <WeekLabel week={activeWeek} /> 주 ·{' '}
              <strong>
                {activeValue == null ? '기록 없음' : `${number.format(activeValue)}건`}
              </strong>
            </Text>
          )}
        </div>
        {peak > 0 && (
          <div className="ds-heatmap-key" aria-hidden="true">
            <span>0건</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <i key={level} data-level={level} />
            ))}
            <span>{number.format(peak)}건</span>
          </div>
        )}
      </div>
      <table className="ds-heatmap">
        <caption>
          <VisuallyHidden>{label}, 단위 건</VisuallyHidden>
        </caption>
        <thead>
          <tr>
            <th scope="col">키워드</th>
            {weeks.map((week) => (
              <th key={week.start} scope="col">
                <WeekLabel week={week} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, values }) => (
            <tr key={id}>
              <th scope="row">{name}</th>
              {weeks.map((week, index) => {
                const value = values[index];
                const key = `${id}:${dates[index]}`;
                const text = value == null ? '기록 없음' : `${number.format(value)}건`;
                return (
                  <td
                    key={week.start}
                    data-level={
                      value == null ? 'missing' : Math.ceil((value / Math.max(1, peak)) * 4)
                    }
                  >
                    <Button
                      type="button"
                      intent="quiet"
                      className="ds-heatmap-cell"
                      aria-label={`${name} ${dates[index]} 주, ${text}`}
                      aria-pressed={key === selection.selected}
                      data-active={key === selection.active}
                      onPointerEnter={(event) => {
                        if (event.pointerType === 'mouse') selection.setPreview(key);
                      }}
                      onPointerLeave={() => selection.setPreview()}
                      onFocus={() => selection.setPreview(key)}
                      onBlur={() => selection.setPreview()}
                      onClick={() => selection.select(key)}
                    >
                      {value == null ? (
                        '–'
                      ) : value < 1000 ? (
                        number.format(value)
                      ) : (
                        <>
                          <span className="ds-heatmap-exact">{number.format(value)}</span>
                          <span className="ds-heatmap-compact">{compactCount.format(value)}</span>
                        </>
                      )}
                    </Button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

type WeeklyValue = { classified: number; positive: number; negative: number };
const sentiments = [
  { key: 'positive', label: '긍정' },
  { key: 'negative', label: '부정' },
] as const;

export function WeeklyPlot({
  label,
  weeks,
  values,
  variant,
}: {
  label: string;
  weeks: ChartWeek[];
  values: (WeeklyValue | null)[];
  variant: 'share' | 'volume';
}) {
  const isShare = variant === 'share';
  const chart = weeks.map((week, index) => {
    const value = values[index];
    return {
      week: weekTick(week),
      classified: value?.classified ?? null,
      positive: value?.classified ? (100 * value.positive) / value.classified : null,
      negative: value?.classified ? (100 * value.negative) / value.classified : null,
    };
  });
  const latestIndex = values.reduce(
    (latest, value, index) => (value?.classified ? index : latest),
    -1,
  );
  const selection = useChartSelection(chart[latestIndex]?.week ?? chart.at(-1)?.week);
  const activeIndex = chart.findIndex(({ week }) => week === selection.active);
  const active = values[activeIndex];
  const optionLabels = weeks.map((week, index) => {
    const value = values[index];
    const result =
      value == null
        ? '기록 없음'
        : isShare
          ? value.classified
            ? `긍정 ${percent(value.positive / value.classified)}, 부정 ${percent(value.negative / value.classified)}`
            : '분류 없음'
          : `분류 ${number.format(value.classified)}건`;
    return `${week.start} ~ ${week.through}${week.partial ? ', 부분 집계' : ''}, ${result}`;
  });

  const activeWeek = weeks[activeIndex];
  return (
    <figure className="ds-analysis-chart" aria-label={label}>
      <div className="ds-line-legend ds-chart-readout" aria-live="polite">
        {activeWeek && (
          <span className="ds-chart-muted">
            <WeekLabel week={activeWeek} /> 주
          </span>
        )}
        {isShare ? (
          sentiments.map(({ key, label }) => (
            <span key={key} data-tone={key}>
              <i />
              {label}
              {active?.classified ? (
                <strong>{percent(active[key] / active.classified)}</strong>
              ) : (
                <span>
                  –<VisuallyHidden>비율 없음</VisuallyHidden>
                </span>
              )}
            </span>
          ))
        ) : (
          <span>
            <strong>{active ? `분류 ${number.format(active.classified)}건` : '기록 없음'}</strong>
          </span>
        )}
      </div>
      {chart.length > 0 && (
        <Suspense fallback={null}>
          <WeeklyChart
            data={chart}
            variant={variant}
            selection={selection}
            optionLabels={optionLabels}
          />
        </Suspense>
      )}
      <VisuallyHidden asChild>
        <ul>
          {weeks.map((week, index) => (
            <li key={week.start}>{optionLabels[index]}</li>
          ))}
        </ul>
      </VisuallyHidden>
      {isShare && !values.some((value) => value?.classified) && (
        <Text as="p" size="2" color="gray">
          이 기간에 비율을 표시할 주가 없습니다.
        </Text>
      )}
    </figure>
  );
}
