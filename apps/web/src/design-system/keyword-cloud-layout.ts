export const cloudWidth = 320;
export const cloudPadding = 10;
const minimumHeight = 228;
const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

export type CloudRow = {
  name: string;
  total: number;
  href?: string;
  related?: boolean;
};
export type CloudWord = CloudRow & {
  x: number;
  y: number;
  fontSize: number;
  lines: { text: string; width: number }[];
  lineHeight: number;
  labelWidth: number;
  labelHeight: number;
  tone: number;
};

export function cloudFontSize(total: number, largest: number) {
  return 13 + 25 * Math.sqrt(total / largest);
}

function wrapLabel(name: string, ctx: CanvasRenderingContext2D) {
  const maxWidth = cloudWidth * 0.75;
  const lines: CloudWord['lines'] = [];
  let text = '';
  let textWidth = 0;
  for (const { segment } of segmenter.segment(name)) {
    const candidate = text + segment;
    const width = ctx.measureText(candidate).width;
    if (text && width > maxWidth) {
      lines.push({ text, width: textWidth });
      text = segment;
      textWidth = ctx.measureText(segment).width;
    } else {
      text = candidate;
      textWidth = width;
    }
  }
  lines.push({ text, width: textWidth });
  return lines;
}

export async function layoutKeywordCloud(rows: CloudRow[], font: string) {
  const { default: CloudLayout } = await import('d3-cloud');
  const mask = document.createElement('canvas');
  const ctx = mask.getContext('2d');
  if (!ctx) return undefined;
  const largest = rows[0]?.total || 1;
  const layout = new CloudLayout()
    .overflow(false)
    .strategy('rectangular')
    .random(() => 0.5);
  const sprites = rows.map((row, index) => {
    const fontSize = cloudFontSize(row.total, largest);
    ctx.font = `700 ${fontSize}px ${font}`;
    const lines = wrapLabel(row.name, ctx);
    const lineHeight = fontSize * 1.24;
    const labelWidth = Math.max(...lines.map(({ width }) => width));
    const labelHeight = lineHeight * lines.length;
    // Pack the full link rectangles, including multiline words and hit-area spacing.
    mask.width = Math.ceil(labelWidth + 8);
    mask.height = Math.ceil(labelHeight + 8);
    ctx.fillRect(0, 0, mask.width, mask.height);
    return layout.getSprite(mask, {
      datum: {
        ...row,
        fontSize,
        lines,
        lineHeight,
        labelWidth,
        labelHeight,
        tone: index % 5,
      },
    });
  });
  if (sprites.some((sprite) => !sprite)) return undefined;

  const area = sprites.reduce(
    (sum, sprite) => sum + (sprite?.imageWidth ?? 0) * (sprite?.imageHeight ?? 0),
    0,
  );
  let height = Math.max(
    minimumHeight,
    Math.ceil(area / (cloudWidth * 0.55)),
    ...sprites.map((sprite) => (sprite?.imageHeight ?? 0) + 16),
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    layout.clear();
    layout.size([cloudWidth - 2 * cloudPadding, height]);
    const words: CloudWord[] = [];
    for (const sprite of sprites) {
      if (!sprite) break;
      const word = layout.place(sprite, { x: 0, y: 0 });
      if (!word) break;
      words.push({ ...word.datum, x: word.x + cloudWidth / 2, y: word.y });
    }
    if (words.length === rows.length) {
      const middle = Math.ceil(
        Math.max(
          minimumHeight / 2,
          ...words.map(({ labelHeight, y }) => Math.abs(y) + labelHeight / 2 + cloudPadding),
        ),
      );
      return { words, middle };
    }
    height = Math.ceil(height * 1.5);
  }
  return undefined;
}

export type PlacedCloud = NonNullable<Awaited<ReturnType<typeof layoutKeywordCloud>>>;
