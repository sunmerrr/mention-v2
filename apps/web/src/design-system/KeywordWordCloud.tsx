import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChartMotion } from './chart-interaction';

import {
  type CloudRow,
  type CloudWord,
  cloudFontSize,
  layoutKeywordCloud,
  type PlacedCloud,
  cloudPadding as padding,
  cloudWidth as width,
} from './keyword-cloud-layout';

function KeywordLinks({ rows }: { rows: CloudRow[] }) {
  const largest = rows[0]?.total || 1;
  return rows.map(({ name, href, total, related }, index) => {
    const props = {
      className: 'ds-keyword-cloud-fallback-word',
      'data-tone': index % 5,
      'data-related': related || undefined,
      style: { fontSize: cloudFontSize(total, largest) * 0.75 },
      children: name,
    };
    return href ? (
      <Link key={name} to={href} aria-label={`${name} 언급 글·대화 보기`} {...props} />
    ) : (
      <span key={name} {...props} />
    );
  });
}

function WordLabel({ word, middle }: { word: CloudWord; middle: number }) {
  const { x, y, fontSize, lines, lineHeight, tone } = word;
  return (
    <text
      x={x}
      y={y + middle}
      fontSize={fontSize}
      dominantBaseline="central"
      textAnchor="middle"
      data-tone={tone}
      data-related={word.related || undefined}
    >
      {lines.map((line, index) => {
        const offset = (index - (lines.length - 1) / 2) * lineHeight;
        return (
          <tspan
            key={offset}
            x={x}
            dy={index === 0 ? offset : lineHeight}
            textLength={line.width}
            lengthAdjust="spacingAndGlyphs"
            xmlSpace="preserve"
          >
            {line.text}
          </tspan>
        );
      })}
    </text>
  );
}

function MagnifiedWord({
  word,
  middle,
  focused,
}: {
  word: CloudWord;
  middle: number;
  focused: boolean;
}) {
  const { x, y, labelWidth, labelHeight } = word;
  const height = middle * 2;
  const zoom = Math.min(
    1.16,
    (width - 2 * padding) / labelWidth,
    (height - 2 * padding) / labelHeight,
  );
  const left = padding + (labelWidth * zoom) / 2;
  const top = padding + (labelHeight * zoom) / 2;
  const shiftX = Math.min(width - left, Math.max(left, x)) - x;
  const shiftY = Math.min(height - top, Math.max(top, y + middle)) - (y + middle);
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: The SVG overlay has no link or focus target and duplicates the active word visually.
    <g
      aria-hidden="true"
      focusable="false"
      pointerEvents="none"
      className="ds-keyword-cloud-magnified"
      data-focused={focused || undefined}
      style={{
        transformOrigin: `${x}px ${y + middle}px`,
        transform: `translate(${shiftX}px, ${shiftY}px) scale(${zoom})`,
      }}
    >
      <WordLabel word={word} middle={middle} />
    </g>
  );
}

export function KeywordWordCloud({ rows }: { rows: CloudRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const animate = useChartMotion(ref);
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [layout, setLayout] = useState<{
    rows: CloudRow[];
    cloud: PlacedCloud;
  }>();
  const [linksFocused, setLinksFocused] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let current = true;
    const font =
      getComputedStyle(element).getPropertyValue('--mention-font-family').trim() || 'sans-serif';

    void document.fonts.ready
      .then(() => (current ? layoutKeywordCloud(rows, font) : undefined))
      .then((cloud) => {
        if (current && cloud) setLayout({ rows, cloud });
      })
      .catch(() => {
        // The server-rendered links remain usable if canvas or the library is unavailable.
      });

    return () => {
      current = false;
    };
  }, [rows]);

  const placed = layout?.rows === rows && !linksFocused ? layout.cloud : undefined;
  const active = placed?.words.find(({ name }) => name === (hovered ?? focused));
  const middle = placed?.middle ?? 0;
  return (
    <div className="ds-keyword-cloud" ref={ref} data-chart-reveal={animate || undefined}>
      {placed ? (
        <svg
          aria-hidden={placed.words.every(({ href }) => !href) || undefined}
          viewBox={`0 0 ${width} ${2 * middle}`}
        >
          <title>
            {rows.some(({ related }) => related)
              ? '하위 키워드 및 연관어 워드클라우드'
              : '하위 키워드 워드클라우드'}
          </title>
          {placed.words.map((word) => {
            const { name, href, x, y, labelWidth, labelHeight } = word;
            return href ? (
              <Link
                key={name}
                to={href}
                className="ds-keyword-cloud-link"
                aria-label={`${name} 언급 글·대화 보기`}
                data-magnified={active?.name === name || undefined}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setHovered(name);
                }}
                onPointerLeave={() => setHovered(undefined)}
                onFocus={(event) => {
                  if (event.currentTarget.matches(':focus-visible')) setFocused(name);
                }}
                onBlur={() => setFocused(undefined)}
              >
                <rect
                  className="ds-keyword-cloud-target"
                  x={x - labelWidth / 2 - 2}
                  y={y + middle - labelHeight / 2 - 2}
                  width={labelWidth + 4}
                  height={labelHeight + 4}
                />
                <WordLabel word={word} middle={middle} />
              </Link>
            ) : (
              <WordLabel key={name} word={word} middle={middle} />
            );
          })}
          {active && (
            <MagnifiedWord
              key={active.name}
              word={active}
              middle={middle}
              focused={focused === active.name}
            />
          )}
        </svg>
      ) : (
        <div
          className="ds-keyword-cloud-fallback"
          onFocusCapture={() => setLinksFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setLinksFocused(false);
          }}
        >
          <KeywordLinks rows={rows} />
        </div>
      )}
    </div>
  );
}
