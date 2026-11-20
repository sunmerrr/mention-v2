import sharp from 'sharp';

const colors = { background: '#eef2f6', foreground: '#142336', muted: '#43536a', card: '#ffffff' };
function escapeXml(value: string) {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && (code < 0xd800 || code > 0xdfff) && code !== 0xfffe && code !== 0xffff)
      );
    })
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const object = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const short = (value: unknown, size: number) => {
  const characters = [
    ...String(value ?? '')
      .replace(/\s+/gu, ' ')
      .trim(),
  ];
  return characters.length > size
    ? `${characters.slice(0, size - 1).join('')}…`
    : characters.join('');
};

export async function briefingImage(report: Record<string, unknown>) {
  const targets = (Array.isArray(report.targets) ? report.targets.map(object) : [])
    .filter((row) => number(row.mentions) || number(row.conversations))
    .sort(
      (a, b) =>
        number(b.mentions) - number(a.mentions) ||
        number(b.conversations) - number(a.conversations),
    )
    .slice(0, 8);
  const height = 278 + Math.max(1, targets.length) * 112;
  const text = (
    x: number,
    y: number,
    size: number,
    value: string,
    fill = colors.foreground,
    weight = 400,
  ) =>
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(value)}</text>`;
  const rows = targets
    .map((row, index) => {
      const y = 154 + index * 112;
      const delta = number(row.delta);
      const sample = (Array.isArray(row.evidence) ? row.evidence.map(object) : []).find(
        (entry) => entry.verdict !== 'unreviewed' && (entry.summary || entry.text),
      );
      return `<rect x="40" y="${y}" width="1120" height="96" rx="12" fill="${colors.card}"/>${text(
        64,
        y + 34,
        25,
        short(row.target, 24),
        colors.foreground,
        700,
      )}${text(
        650,
        y + 33,
        20,
        `언급 ${number(row.mentions)}건 · 전일 ${delta > 0 ? '+' : ''}${delta} · 분류 ${number(row.reviewed)}/${number(row.conversations)}`,
        colors.muted,
      )}${text(
        64,
        y + 65,
        18,
        `긍정 ${number(row.positive)}   부정 ${number(row.negative)}   중립 ${number(row.neutral)}   혼합 ${number(row.mixed)}   보류 ${number(row.uncertain)}   제외 ${number(row.excluded)}`,
      )}${
        sample ? text(64, y + 88, 15, short(sample.summary || sample.text, 64), colors.muted) : ''
      }`;
    })
    .join('');
  const coverage = object(object(report.coverage).counts);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="${colors.background}"/><g font-family="Noto Sans CJK KR, Apple SD Gothic Neo, sans-serif">${text(42, 70, 40, `${short(report.day, 10)} 일일 브리핑`, colors.foreground, 700)}${text(44, 116, 23, `대화 ${number(report.conversations)}개 · 검토 ${number(report.reviewed)}개 · 중요 대화 ${number(report.open_bookmarks)}개`, colors.muted)}${rows || text(45, 208, 20, '이 날짜의 집계 기록이 없습니다.', colors.muted)}${text(44, height - 66, 18, `수집 공백 ${number(coverage.open)} · 미완전 복구 ${number(coverage.partial)} · 범위 미확인 ${number(coverage.legacy)}`, colors.muted)}${text(44, height - 34, 16, report.partial_day ? '오늘의 집계는 진행 중입니다.' : '저장된 대화와 분류 결과 기준', colors.muted)}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
