import { useId } from 'react';
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { useChartSize } from './chart-interaction';
import { reportAxis } from './RechartsReportPlots';

const gapSources = ['kakao', 'pokergosu'] as const;
const markerSize = 64;
export type SourceGapRow = {
  id: string;
  name: string;
  kakao: { classified: number; negative: number };
  pokergosu: { classified: number; negative: number };
};

type GapPoint = {
  cx: number;
  cy: number;
  size: number;
  payload: { source: (typeof gapSources)[number] };
};

function GapMarker({ cx, cy, size, payload }: GapPoint) {
  return (
    <g
      transform={`translate(${cx}, ${cy}) scale(${Math.sqrt(size / markerSize)})`}
      data-source={payload.source}
    >
      <circle className="ds-gap-halo" r={10} />
      {payload.source === 'pokergosu' ? (
        <rect
          className="ds-gap-node"
          x={-4}
          y={-4}
          width={8}
          height={8}
          rx={1}
          transform="rotate(45)"
        />
      ) : (
        <circle className="ds-gap-node" r={5} />
      )}
    </g>
  );
}

export default function SourceGapScatter({
  rows,
  activeIndex,
  rowHeight,
  axisHeight,
  headingHeight,
}: {
  rows: SourceGapRow[];
  activeIndex: number;
  rowHeight: number;
  axisHeight: number;
  headingHeight: number;
}) {
  const { ref, width, motion, motionKey } = useChartSize(160);
  const chartId = useId();
  const ticks = width < 220 ? [0, 50, 100] : [0, 25, 50, 75, 100];
  return (
    <div className="ds-source-gap-graphic" ref={ref} aria-hidden="true">
      <ScatterChart
        key={motionKey}
        id={`${chartId}-plot`}
        width={width}
        height={rows.length * rowHeight + axisHeight + headingHeight}
        margin={{ top: headingHeight, right: 18, bottom: 0, left: 18 }}
        accessibilityLayer={false}
      >
        <CartesianGrid horizontal={false} stroke="var(--mention-border)" strokeDasharray="2 4" />
        <XAxis
          {...reportAxis}
          type="number"
          dataKey="x"
          height={axisHeight}
          domain={[0, 100]}
          ticks={ticks}
          tickFormatter={(value: number) => `${value}%`}
        />
        <YAxis type="number" dataKey="y" hide reversed domain={[-0.5, rows.length - 0.5]} />
        <ZAxis range={[markerSize, markerSize]} />
        {rows.map((row, index) => (
          <Scatter
            key={row.id}
            id={`${chartId}-${index}`}
            className={`ds-gap-markers${index === activeIndex ? ' ds-gap-active' : ''}`}
            data={gapSources.flatMap((source) =>
              row[source].classified
                ? [
                    {
                      x: (100 * row[source].negative) / row[source].classified,
                      y: index,
                      source,
                    },
                  ]
                : [],
            )}
            shape={(props: unknown) => GapMarker(props as GapPoint)}
            line={{ className: 'ds-gap-link' }}
            {...motion}
          />
        ))}
      </ScatterChart>
    </div>
  );
}
