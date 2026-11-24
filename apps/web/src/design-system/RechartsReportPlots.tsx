import { type ComponentProps, type CSSProperties, type ReactNode, useId } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { type ChartSelection, chartNumber, chartPercent, useChartSize } from './chart-interaction';
import { Button, TextLink } from './primitives';

export type ComparisonPoint = {
  id: string;
  name: string;
  classified: number;
  positive: number;
  negative: number;
  note?: string;
  href?: string;
};

export type DistributionPoint = {
  label: string;
  tone: 'positive' | 'negative' | 'neutral' | 'mixed';
  count: number;
};

type WeeklyDatum = {
  week: string;
  classified: number | null;
  positive: number | null;
  negative: number | null;
};

export const chartColor = (tone: string) => `var(--mention-chart-${tone})`;
const axisColor = 'var(--mention-border)';
const gridColor = 'var(--mention-border-subtle)';
export const reportAxis = {
  axisLine: { stroke: axisColor },
  tickLine: false,
  tickMargin: 7,
  tick: { fill: 'var(--mention-text-secondary)', fontSize: 11 },
  interval: 0,
} as const;

function ChartTargets({
  style,
  items,
  selection,
}: {
  style: CSSProperties;
  items: { id: string; title: string; label?: ReactNode }[];
  selection: ChartSelection;
}) {
  return (
    <div className="ds-chart-targets" style={style}>
      {items.map(({ id, title, label }) => (
        <Button
          key={id}
          type="button"
          intent="quiet"
          aria-label={title}
          aria-pressed={id === selection.selected}
          data-active={id === selection.active}
          className="ds-chart-target"
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') selection.setPreview(id);
          }}
          onPointerLeave={() => selection.setPreview()}
          onFocus={() => selection.setPreview(id)}
          onBlur={() => selection.setPreview()}
          onClick={() => selection.select(id)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

type BarGeometry = { x: number; y: number; width: number; height: number };

type ComparisonBarProps = BarGeometry & {
  fill: string;
  payload: { id: string };
};

function comparisonBar({ x, y, width, height, fill, payload }: ComparisonBarProps) {
  return (
    <rect
      data-keyword={payload.id}
      x={Math.min(x, x + width)}
      y={y}
      width={Math.abs(width)}
      height={height}
      rx={4}
      fill={fill}
    />
  );
}

function comparisonLabel(
  tone: 'negative' | 'positive',
  { value, viewBox }: { value?: string | number | null; viewBox?: object },
) {
  const { x, y, width, height } = (viewBox ?? {}) as Partial<BarGeometry>;
  if (typeof value !== 'number' || x == null || y == null || width == null || height == null)
    return null;

  const label = chartPercent(Math.abs(value) / 100);
  const gap = 4;
  const fitsInside = Math.abs(width) >= label.length * 7 + gap * 2;
  const direction = tone === 'negative' ? -1 : 1;
  return (
    <text
      className="ds-chart-bar-label"
      data-tone={tone}
      data-placement={fitsInside ? 'inside' : 'outside'}
      x={fitsInside ? x + width / 2 : x + width + direction * gap}
      y={y + height / 2}
      dominantBaseline="central"
      textAnchor={fitsInside ? 'middle' : tone === 'negative' ? 'end' : 'start'}
    >
      {label}
    </text>
  );
}

export function SharePlot({
  rows,
  selection,
}: {
  rows: ComparisonPoint[];
  selection: ChartSelection;
}) {
  const { ref, width, motion, motionKey } = useChartSize(256);
  const chartId = useId();
  const top = 15;
  const bottom = 25;
  const rowHeight = 57;
  const height = rows.length * rowHeight + top + bottom;
  const ticks = width < 350 ? [-100, 0, 100] : [-100, -50, 0, 50, 100];
  const data = rows.map(({ id, negative, positive, classified }) => ({
    id,
    negative: (-100 * negative) / classified,
    positive: (100 * positive) / classified,
  }));
  return (
    <div className="ds-chart-plot ds-share-plot" ref={ref}>
      <div aria-hidden="true">
        <BarChart
          key={motionKey}
          id={`${chartId}-plot`}
          layout="vertical"
          width={width}
          height={height}
          data={data}
          stackOffset="sign"
          barSize={16}
          margin={{ left: 18, right: 18, top, bottom: 0 }}
          accessibilityLayer={false}
        >
          <CartesianGrid horizontal={false} stroke={gridColor} strokeDasharray="2 4" />
          <XAxis
            {...reportAxis}
            height={bottom}
            ticks={ticks}
            domain={[-100, 100]}
            type="number"
            tickFormatter={(value: number) => `${Math.abs(value)}%`}
          />
          <YAxis
            {...reportAxis}
            width={0}
            type="category"
            dataKey="id"
            axisLine={false}
            tick={false}
          />
          <ReferenceLine x={0} stroke={axisColor} />
          {(['negative', 'positive'] as const).map((tone) => (
            <Bar
              key={tone}
              id={`${chartId}-${tone}`}
              dataKey={tone}
              fill={chartColor(tone)}
              stackId="sentiment"
              shape={(props: unknown) => comparisonBar(props as ComparisonBarProps)}
              {...motion}
            >
              <LabelList dataKey={tone} content={(props) => comparisonLabel(tone, props)} />
            </Bar>
          ))}
        </BarChart>
      </div>
      <div
        className="ds-chart-targets ds-share-rows"
        style={{ inset: `0 0 ${bottom}px`, gridAutoRows: `${rowHeight}px` }}
      >
        {rows.map(({ id, name, classified, href }) => (
          <div className="ds-share-row" key={id}>
            <div className="ds-chart-row-heading">
              {href ? (
                <TextLink asChild className="ds-chart-row-name" underline="always">
                  <Link to={href}>{name}</Link>
                </TextLink>
              ) : (
                <span className="ds-chart-row-name">{name}</span>
              )}
              <span className="ds-chart-row-metrics">
                <span>분류 {chartNumber.format(classified)}건</span>
              </span>
            </div>
            <Button
              type="button"
              intent="quiet"
              aria-label={`${name} 긍정·부정 비교`}
              aria-pressed={id === selection.selected}
              className="ds-chart-target"
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') selection.setPreview(id);
              }}
              onPointerLeave={() => selection.setPreview()}
              onFocus={() => selection.setPreview(id)}
              onBlur={() => selection.setPreview()}
              onClick={() => selection.select(id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function volumeLabel({ value, viewBox }: { value?: string | number | null; viewBox?: object }) {
  const { x, y, width } = (viewBox ?? {}) as Partial<BarGeometry>;
  if (typeof value !== 'number' || x == null || y == null || width == null) return null;
  return (
    <text className="ds-chart-annotation" textAnchor="middle" x={x + width / 2} y={y - 4}>
      {chartNumber.format(value)}
    </text>
  );
}

function negativePoint({
  cx,
  cy,
  stroke,
  index,
}: {
  cx?: number;
  cy?: number;
  stroke?: string;
  index: number;
}) {
  if (cx == null || cy == null) return <g key={index} />;
  return (
    <rect
      key={index}
      x={cx - 4}
      y={cy - 4}
      width={8}
      height={8}
      rx={1}
      fill="none"
      stroke={stroke}
      strokeWidth={2}
    />
  );
}

export function WeeklyChart({
  data,
  variant,
  selection,
  optionLabels,
}: {
  data: WeeklyDatum[];
  variant: 'share' | 'volume';
  selection: ChartSelection;
  optionLabels: string[];
}) {
  const { ref, width, ready, motion, motionKey } = useChartSize(256);
  const chartId = useId();
  const height = 187;
  const isShare = variant === 'share';
  const margin = { top: 15, bottom: 0, left: 0, right: 13 };
  const axisLeft = 38;
  const axisBottom = 26;
  const bandWidth = (width - axisLeft - margin.right) / data.length;
  const ticks = data
    .filter(
      (_, index) =>
        bandWidth >= 37 ||
        index === data.length - 1 ||
        (index % 2 === 0 && index < data.length - 2),
    )
    .map(({ week }) => week);
  const axes = [
    <CartesianGrid key="grid" vertical={false} stroke={gridColor} strokeDasharray="2 4" />,
    <XAxis
      key="weeks"
      {...reportAxis}
      height={axisBottom}
      dataKey="week"
      scale="band"
      ticks={ticks}
    />,
    <YAxis
      key="values"
      {...reportAxis}
      width={axisLeft}
      tickMargin={5}
      domain={
        isShare ? [0, 100] : [0, Math.max(4, ...data.map(({ classified }) => classified ?? 0))]
      }
      ticks={isShare ? [0, 25, 50, 75, 100] : undefined}
      tickCount={5}
      tickFormatter={(value: number) => (isShare ? `${value}%` : chartNumber.format(value))}
    />,
  ];
  const chartProps = {
    id: `${chartId}-plot`,
    width,
    height,
    margin,
    data,
    accessibilityLayer: false,
  };
  return (
    <div className="ds-chart-plot" ref={ref} data-ready={ready || undefined}>
      <div aria-hidden="true">
        {isShare ? (
          <LineChart key={motionKey} {...chartProps}>
            {axes}
            <Line
              id={`${chartId}-positive`}
              dataKey="positive"
              stroke={chartColor('positive')}
              strokeWidth={2}
              dot={{ r: 3, fill: chartColor('positive'), stroke: 'none' }}
              {...motion}
            />
            <Line
              id={`${chartId}-negative`}
              dataKey="negative"
              stroke={chartColor('negative')}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={negativePoint}
              {...motion}
            />
          </LineChart>
        ) : (
          <BarChart key={motionKey} {...chartProps}>
            {axes}
            <Bar
              id={chartId}
              dataKey="classified"
              barSize={Math.min(28, bandWidth * 0.7)}
              radius={3}
              fill={chartColor('volume')}
              {...motion}
            >
              <LabelList dataKey="classified" content={volumeLabel} />
            </Bar>
          </BarChart>
        )}
      </div>
      <ChartTargets
        style={{
          inset: `${margin.top}px ${margin.right}px ${axisBottom}px ${axisLeft}px`,
          gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
        }}
        items={data.map(({ week }, index) => ({
          id: week,
          title: optionLabels[index] ?? week,
        }))}
        selection={selection}
      />
    </div>
  );
}

export function DistributionPlot({
  items,
  selection,
}: {
  items: DistributionPoint[];
  selection: ChartSelection;
}) {
  const { ref, width, motion, motionKey } = useChartSize(138);
  const chartId = useId();
  const visible = items.filter(({ count }) => count > 0);
  return (
    <div className="ds-chart-plot" ref={ref} aria-hidden="true">
      <PieChart
        key={motionKey}
        id={`${chartId}-plot`}
        width={width}
        height={188}
        margin={{ top: 9, bottom: 9, left: 9, right: 9 }}
      >
        <Pie
          id={chartId}
          data={visible.map(({ label, count, tone }) => ({
            name: label,
            value: count,
            tone,
            fill: chartColor(tone),
          }))}
          dataKey="value"
          innerRadius="73%"
          outerRadius="100%"
          paddingAngle={1}
          cornerRadius={3}
          stroke="none"
          activeIndex={visible.findIndex(({ tone }) => tone === selection.active)}
          activeShape={(props: ComponentProps<typeof Sector>) => (
            <Sector {...props} outerRadius={(props.outerRadius ?? 0) + 5} />
          )}
          {...motion}
          onMouseEnter={(_, index) => selection.setPreview(visible[index]?.tone)}
          onMouseLeave={() => selection.setPreview()}
          onClick={(_, index) => selection.select(visible[index]?.tone)}
        />
      </PieChart>
    </div>
  );
}

export function StackedPlot({
  total,
  items,
}: {
  total: number;
  items: { tone: string; count: number; label: string }[];
}) {
  const { ref, width, motion, motionKey } = useChartSize(180);
  const chartId = useId();
  const datum = Object.fromEntries(items.map(({ tone, count }) => [tone, count]));
  return (
    <div className="ds-chart-plot ds-chart-stack" ref={ref}>
      {total > 0 && (
        <BarChart
          key={motionKey}
          id={`${chartId}-plot`}
          width={width}
          height={12}
          layout="vertical"
          data={[{ ...datum, name: '분류' }]}
          margin={{ top: 0, bottom: 0, left: 0, right: 0 }}
          barSize={12}
        >
          <XAxis type="number" domain={[0, total]} allowDataOverflow hide />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip
            cursor={false}
            isAnimationActive={false}
            formatter={(value, name) => [`${chartNumber.format(Number(value))}건`, name]}
            labelStyle={{ display: 'none' }}
            contentStyle={{
              background: 'var(--mention-bg-surface)',
              border: '1px solid var(--mention-border)',
              borderRadius: 'var(--mention-radius-control)',
              fontSize: 12,
            }}
          />
          {items
            .filter(({ count }) => count > 0)
            .map(({ label, tone, count }) => (
              <Bar
                id={`${chartId}-${tone}`}
                key={tone}
                dataKey={tone}
                name={label}
                stackId="distribution"
                fill={chartColor(tone)}
                {...motion}
                shape={(props: unknown) => {
                  const { x, y, width, height } = props as BarGeometry;
                  return (
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill={chartColor(tone)}
                      tabIndex={0}
                      aria-label={`${label} ${chartNumber.format(count)}건`}
                    />
                  );
                }}
              />
            ))}
        </BarChart>
      )}
    </div>
  );
}
