import { type ComponentProps, lazy, type ReactNode, Suspense } from 'react';
import { chartNumber, chartPercent, useChartSelection } from './chart-interaction';
import { Disclosure } from './patterns';
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  TabNav,
  Text,
  VisuallyHidden,
} from './primitives';
import type { DistributionPoint } from './RechartsReportPlots';

const DistributionPlot = lazy(() =>
  import('./RechartsReportPlots').then(({ DistributionPlot }) => ({
    default: DistributionPlot,
  })),
);
const StackedPlot = lazy(() =>
  import('./RechartsReportPlots').then(({ StackedPlot }) => ({
    default: StackedPlot,
  })),
);

export function RouteTabs({
  label,
  segmented = false,
  children,
}: {
  label: string;
  segmented?: boolean;
  children: ReactNode;
}) {
  return (
    <TabNav.Root
      aria-label={label}
      className={segmented ? 'ds-route-tabs ds-route-tabs-segmented' : 'ds-route-tabs'}
      wrap="wrap"
      mb="4"
    >
      {children}
    </TabNav.Root>
  );
}

export function ReportSheet({
  label,
  dashboard = false,
  children,
}: {
  label: string;
  dashboard?: boolean;
  children: ReactNode;
}) {
  return dashboard ? (
    <article className="ds-report-dashboard" aria-label={label}>
      {children}
    </article>
  ) : (
    <Card asChild className="ds-report-sheet">
      <article aria-label={label}>{children}</article>
    </Card>
  );
}

export function ReportSection({
  title,
  description,
  actions,
  card = false,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  card?: boolean;
  children: ReactNode;
}) {
  const Content = card ? Card : Box;
  return (
    <Content asChild className={card ? 'ds-report-card' : 'ds-report-section'}>
      <section>
        <Flex
          justify="between"
          align="start"
          gap="3"
          wrap="wrap"
          className="ds-report-card-heading"
        >
          <Box>
            <Heading as="h3" size="4">
              {title}
            </Heading>
            {description && (
              <Text as="p" size="2" color="gray" mt="1">
                {description}
              </Text>
            )}
          </Box>
          {actions}
        </Flex>
        {children}
      </section>
    </Content>
  );
}

export function ReportDistribution({
  label,
  items,
}: {
  label: string;
  items: DistributionPoint[];
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const selection = useChartSelection();
  const active = items.find(({ tone }) => tone === selection.active);
  return (
    <figure className="ds-report-distribution" aria-label={label}>
      <VisuallyHidden asChild>
        <figcaption>분류 완료 {chartNumber.format(total)}건</figcaption>
      </VisuallyHidden>
      {total > 0 && (
        <div className="ds-report-distribution-body">
          <div className="ds-report-distribution-plot">
            <Suspense fallback={null}>
              <DistributionPlot items={items} selection={selection} />
            </Suspense>
            <div className="ds-report-chart-center" aria-live="polite">
              <Text size="5" weight="bold">
                {chartNumber.format(active?.count ?? total)}건
              </Text>
              <Text size="1" color="gray">
                {active ? `${active.label} · ${chartPercent(active.count / total)}` : '분류 완료'}
              </Text>
            </div>
          </div>
          <Grid asChild columns={{ initial: '2', lg: '4' }} gap="3">
            <ul className="ds-report-values">
              {items.map(({ tone, label, count }) => (
                <li key={tone}>
                  <Button
                    type="button"
                    intent="quiet"
                    className="ds-chart-distribution-option"
                    aria-pressed={tone === selection.selected}
                    data-active={tone === selection.active}
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'mouse') selection.setPreview(tone);
                    }}
                    onPointerLeave={() => selection.setPreview()}
                    onFocus={() => selection.setPreview(tone)}
                    onBlur={() => selection.setPreview()}
                    onClick={() => selection.select(selection.selected === tone ? undefined : tone)}
                  >
                    <Text size="2" weight="bold" className="ds-chart-tone-label" data-tone={tone}>
                      {label}
                    </Text>
                    <span className="ds-chart-distribution-value">
                      <Text size={{ initial: '5', sm: '6' }} weight="bold">
                        {chartPercent(count / total)}
                      </Text>
                      <Text size="2" color="gray">
                        {chartNumber.format(count)}건
                      </Text>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </Grid>
        </div>
      )}
    </figure>
  );
}

export function StackedDistribution({
  label,
  ariaLabel = `${label} 분류 분포`,
  total,
  totalLabel = '전체',
  emptyLabel = '데이터 없음',
  items,
  legend = 'visible',
  summary,
}: {
  label: string;
  ariaLabel?: string;
  legend?: 'visible' | 'disclosure';
  summary?: ReactNode;
  total: number;
  totalLabel?: string;
  emptyLabel?: string;
  items: {
    label: string;
    count: number;
    tone: 'positive' | 'negative' | 'neutral' | 'mixed' | 'uncertain' | 'excluded' | 'unreviewed';
  }[];
}) {
  const visible = items.filter((item) => item.count > 0);
  const percent = (count: number) => (total > 0 ? (count / total) * 100 : 0);
  const percentText = (count: number) =>
    percent(count) > 0 && percent(count) < 0.1
      ? '<0.1%'
      : `${percent(count).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
  const entries = (
    <ul className="ds-stacked-distribution-legend" aria-label={`${ariaLabel} 범례`}>
      {visible.map((item) => (
        <li key={item.label} data-tone={item.tone}>
          <span className="ds-stacked-distribution-dot" aria-hidden="true" />
          <Text size="1">
            {item.label} <strong>{item.count.toLocaleString('ko-KR')}건</strong>{' '}
            <Text color="gray">({percentText(item.count)})</Text>
          </Text>
        </li>
      ))}
    </ul>
  );
  return (
    <figure className="ds-stacked-distribution" aria-label={ariaLabel}>
      <figcaption>
        <Flex justify="between" align="center" gap="2">
          <Text size="2" weight="medium">
            {label}
          </Text>
          <Text size="1" color="gray">
            {totalLabel} {total.toLocaleString('ko-KR')}건
          </Text>
        </Flex>
      </figcaption>
      {summary}
      <Suspense fallback={null}>
        <StackedPlot total={total} items={items} />
      </Suspense>
      {total > 0 ? (
        legend === 'disclosure' ? (
          <Disclosure title={`${label} 세부 분류`}>{entries}</Disclosure>
        ) : (
          entries
        )
      ) : (
        <Text as="p" size="1" color="gray">
          {emptyLabel}
        </Text>
      )}
    </figure>
  );
}

export function CountBreakdown({
  total,
  items,
}: {
  total: number;
  items: {
    label: string;
    count: number;
    color: ComponentProps<typeof Badge>['color'];
  }[];
}) {
  const visible = items.filter((item) => item.count > 0);
  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">
        전체 {total.toLocaleString('ko-KR')}건
      </Text>
      <Flex gap="2" wrap="wrap" aria-label="분류별 건수">
        {visible.length ? (
          visible.map((item) => (
            <Badge key={item.label} color={item.color}>
              {item.label} {item.count.toLocaleString('ko-KR')}건
            </Badge>
          ))
        ) : (
          <Text size="1" color="gray">
            {total ? '분류 내역 없음' : '데이터 없음'}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
