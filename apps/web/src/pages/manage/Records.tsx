import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { time } from "../../components/ui";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Select,
  Text,
} from "../../design-system";
import {
  Action,
  ActionForm,
  Choice,
  DataTable,
  Field,
  FilterForm,
  Multiline,
  num,
  obj,
  Paging,
  Panel,
  type Row,
  rows,
  SourceLink,
  strings,
  text,
} from "./shared";
export function Highlight({
  value,
  keywords,
}: {
  value: string;
  keywords: string[];
}) {
  const escaped = keywords
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return <>{value}</>;
  const parts = value.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  let offset = 0;
  const fragments = parts.map((part, index) => {
    const fragment = { value: part, start: offset, matched: index % 2 === 1 };
    offset += part.length;
    return fragment;
  });
  return (
    <>
      {fragments.map((fragment) =>
        fragment.matched ? (
          <mark key={fragment.start}>{fragment.value}</mark>
        ) : (
          fragment.value
        ),
      )}
    </>
  );
}
export function Messages({ data }: { data: Row }) {
  const [p, set] = useSearchParams(),
    day = text(data.day),
    keywords = strings(data.keywords);
  return (
    <>
      <FilterForm>
        <Choice
          name="day"
          label="날짜"
          value={day}
          options={{
            all: "전체 저장 기간",
            ...Object.fromEntries(strings(data.days).map((d) => [d, d])),
          }}
        />
        <Choice
          name="room"
          label="채팅방"
          value={p.get("room") || "all"}
          options={{
            all: "모든 방",
            ...Object.fromEntries(
              rows(data.rooms).map((r) => [text(r.id), text(r.name)]),
            ),
          }}
        />
        <Field
          name="q"
          type="search"
          label="본문 검색"
          value={p.get("q") || ""}
        />
      </FilterForm>
      <Panel
        title="메시지 기록"
        action={
          <Flex gap="2">
            <Button asChild variant="soft" size="2">
              <a href={`/results.json?${p}`}>JSON 다운로드</a>
            </Button>
            {day !== "all" && (
              <>
                <Button asChild variant="soft" size="2">
                  <a href={`/download/${day}.csv`}>메시지 CSV</a>
                </Button>
                <Button asChild variant="soft" size="2">
                  <a href={`/download/context-${day}.csv`}>맥락 CSV</a>
                </Button>
              </>
            )}
          </Flex>
        }
      >
        {rows(data.messages).map((m) => (
          <Box
            className="message"
            key={`${text(m.room_id)}:${text(m.log_id)}`}
            py="4"
          >
            <Flex gap="3" wrap="wrap" align="center">
              <Text size="2" weight="medium">
                {text(m.room)}
              </Text>
              <Text size="1" color="gray">
                {text(m.author_name) || "참여자"} · {text(m.display_at)}
              </Text>
              <Badge color="gray">
                {m.source === "live"
                  ? "실시간"
                  : m.source === "recovery"
                    ? "복구"
                    : "저장 기록"}
              </Badge>
            </Flex>
            <Text as="p" mt="3" size="2" className="message-copy">
              <Highlight value={text(m.text)} keywords={keywords} />
            </Text>
            <Flex gap="3" wrap="wrap" mt="3">
              {rows(m.photos).map((photo, _i) => (
                <a
                  key={text(photo.url)}
                  href={text(photo.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    className="chat-photo"
                    src={text(photo.thumbnail || photo.url)}
                    alt="저장된 대화 첨부 이미지"
                    loading="lazy"
                  />
                </a>
              ))}
            </Flex>
            {!!m.photo_status && m.photo_status !== "saved" && (
              <Text as="p" size="1" color="gray">
                사진 상태: {text(m.photo_status)}
              </Text>
            )}
          </Box>
        ))}
        {!rows(data.messages).length && (
          <Text color="gray" size="2">
            해당 조건의 저장 메시지가 없습니다.
          </Text>
        )}
        <Flex gap="3" mt="4">
          <Button
            variant="soft"
            disabled={!p.get("before")}
            onClick={() => {
              const next = new URLSearchParams(p);
              next.delete("before");
              set(next);
            }}
          >
            최신 기록
          </Button>
          <Button
            variant="soft"
            disabled={!data.next_before}
            onClick={() => {
              const next = new URLSearchParams(p);
              next.set("before", text(data.next_before));
              set(next);
            }}
          >
            이전 메시지 더 보기
          </Button>
        </Flex>
      </Panel>
      <details className="background-message">
        <summary>키워드 집계</summary>
        {rows(data.keyword_groups).map((group) => (
          <Box key={text(group.id)} mt="4">
            <Text size="2" weight="medium">
              {text(group.name)} · 메시지 {num(group.message_count)}개
            </Text>
            <Flex gap="2" wrap="wrap" mt="2">
              {strings(group.keywords).map((keyword) => (
                <Badge color="gray" key={keyword}>
                  {keyword} {num(obj(data.keyword_counts)[keyword])}
                </Badge>
              ))}
            </Flex>
          </Box>
        ))}
      </details>
      <details className="background-message">
        <summary>날짜별 CSV 다운로드</summary>
        <Flex gap="3" wrap="wrap" mt="3">
          {strings(data.days).map((d) => (
            <Button asChild key={d} size="1" variant="soft">
              <a href={`/download/${d}.csv`}>{d}</a>
            </Button>
          ))}
        </Flex>
      </details>
    </>
  );
}
function Evidence({ items }: { items: unknown }) {
  return (
    <>
      {rows(items).map((e, _i) => (
        <Card
          key={text(
            e.id ||
              e.href ||
              `${text(e.room)}:${text(e.time_ms)}:${text(e.log_id)}`,
          )}
          mt="3"
        >
          <SourceLink item={e}>{text(e.summary) || text(e.text)}</SourceLink>
          <Text size="1" color="gray">
            {text(e.room)}
          </Text>
        </Card>
      ))}
    </>
  );
}
export function Trends({ data }: { data: Row }) {
  const [p] = useSearchParams();
  return (
    <>
      <FilterForm>
        <Field
          type="date"
          name="from"
          label="시작 날짜"
          value={text(data.start)}
        />
        <Field type="date" name="to" label="종료 날짜" value={text(data.end)} />
        <Choice
          label="분석 대상"
          name="target"
          value={p.get("target") || "all"}
          options={{
            all: "모든 대상",
            ...Object.fromEntries(strings(data.targets).map((t) => [t, t])),
          }}
        />
      </FilterForm>
      <Text as="p" size="2" color="gray" mb="4">
        {text(data.note)}
      </Text>
      <Panel title="최근 날짜 언급 변화">
        <DataTable
          columns={["대상", "최근 날짜", "직전 날짜", "증감"]}
          items={rows(data.comparisons).map((r) => [
            text(r.target),
            text(r.current),
            text(r.previous),
            r.delta == null
              ? "비교 없음"
              : `${num(r.delta) > 0 ? "+" : ""}${text(r.delta)}`,
          ])}
        />
      </Panel>
      <Panel title="날짜별 여론과 근거">
        <DataTable
          columns={[
            "날짜 / 대상",
            "언급 / 대화",
            "확정 분류",
            "긍정 / 부정 / 중립 / 혼합 / 보류",
            "원문 근거",
          ]}
          items={rows(data.rows).map((r) => [
            `${text(r.day)} · ${text(r.target)}`,
            `${num(r.mentions)} / ${num(r.conversations)}`,
            `${num(r.reviewed)} / ${num(r.conversations)}`,
            ["positive", "negative", "neutral", "mixed", "uncertain"]
              .map((k) => num(r[k]))
              .join(" / "),
            <details key={`${text(r.day)}:${text(r.target)}`}>
              <summary>근거 {rows(r.evidence).length}개</summary>
              <Evidence items={r.evidence} />
            </details>,
          ])}
        />
      </Panel>
    </>
  );
}
export function Bookmarks({ data }: { data: Row }) {
  const [p] = useSearchParams();
  return (
    <>
      <FilterForm>
        <Choice
          name="status"
          label="처리 상태"
          value={p.get("status") || "all"}
          options={{
            all: "전체",
            ...Object.fromEntries(
              Object.entries(obj(data.states)).map(([k, v]) => [k, text(v)]),
            ),
          }}
        />
        <Choice
          name="category"
          label="분류"
          value={p.get("category") || "all"}
          options={{
            all: "전체",
            ...Object.fromEntries(
              Object.entries(obj(data.categories)).map(([k, v]) => [
                k,
                text(v),
              ]),
            ),
          }}
        />
        <Field name="owner" label="담당자" value={p.get("owner") || ""} />
        <Field
          name="q"
          label="제목·메모 검색"
          type="search"
          value={p.get("q") || ""}
        />
        <Choice
          name="archived"
          label="보관 범위"
          value={p.get("archived") || "0"}
          options={{ "0": "보관 중", "1": "숨긴 항목" }}
        />
      </FilterForm>
      {rows(data.items).map((item) => (
        <Panel
          key={text(item.id)}
          title={text(item.title)}
          action={<SourceLink item={item}>원문 대화</SourceLink>}
        >
          <Text as="p" size="2" color="gray" mb="4">
            {text(item.room)} · {time(num(item.event_ms))}
          </Text>
          <ActionForm
            action="bookmark-save"
            build={(f) => ({
              kind: item.kind,
              source_id: item.source_id,
              category: f.get("category"),
              status: f.get("status"),
              owner: f.get("owner"),
              note: f.get("note"),
            })}
          >
            <Grid columns={{ initial: "1", md: "3" }} gap="3">
              <Choice
                name="category"
                label="분류"
                value={text(item.category)}
                options={Object.fromEntries(
                  Object.entries(obj(data.categories)).map(([k, v]) => [
                    k,
                    text(v),
                  ]),
                )}
              />
              <Choice
                name="status"
                label="상태"
                value={text(item.status)}
                options={Object.fromEntries(
                  Object.entries(obj(data.states)).map(([k, v]) => [
                    k,
                    text(v),
                  ]),
                )}
              />
              <Field name="owner" label="담당자" value={text(item.owner)} />
            </Grid>
            <Multiline name="note" label="메모" value={text(item.note)} />
          </ActionForm>
          <Box mt="3">
            <Action
              action="bookmark-archive"
              input={{ id: item.id, archived: !item.archived }}
            >
              {item.archived ? "보관함으로 복원" : "보관함에서 숨기기"}
            </Action>
          </Box>
        </Panel>
      ))}
      <Paging data={data} />
    </>
  );
}
function AliasCandidate({
  candidate: a,
  groups,
}: {
  candidate: Row;
  groups: Row[];
}) {
  const proposed = groups.find((g) => g.id === a.group_id);
  const [selected, setSelected] = useState(proposed ? text(proposed.id) : "");
  const related = a.method === "cooccurrence";
  return (
    <Panel
      title={`${text(a.token)} → ${proposed ? text(proposed.name) : "대상 미정"}`}
    >
      <Flex gap="2" align="center" wrap="wrap" mb="3">
        <Badge color={related ? "gray" : "iris"}>
          {related
            ? "함께 언급된 표현"
            : a.method === "spelling"
              ? "철자 유사"
              : "표기 후보"}
        </Badge>
        <Text size="2">
          {proposed
            ? related
              ? `${text(proposed.name)}과 함께 등장한 표현입니다.`
              : a.method === "spelling"
                ? `${text(proposed.name)}의 ${strings(a.similar_to).length ? `‘${strings(a.similar_to).join("’, ‘")}’` : "기존 표현"}과 철자가 비슷해 제안됐습니다.`
                : `${text(proposed.name)}의 다른 표기로 검토할 후보입니다.`
            : "어느 대상의 별칭인지 불분명합니다. 직접 대상을 선택해 주세요."}
        </Text>
      </Flex>
      <Text as="p" size="2" color="gray">
        {text(a.reason)}
      </Text>
      <Text as="p" size="1" color="gray" mt="2">
        홍보 제외 대화 {num(a.occurrences)}건 · 서로 다른 본문{" "}
        {num(a.distinct_texts)}개 · 참여자 {num(a.authors)}명
      </Text>
      <details className="alias-evidence">
        <summary>근거 대화 {rows(a.examples).length}개 보기</summary>
        <Evidence items={a.examples} />
      </details>
      <Box mt="4">
        <ActionForm
          action="alias-decision"
          submit="선택한 대상의 별칭으로 추가"
          submitDisabled={!selected}
          build={(f) => ({
            token: a.token,
            decision: "applied",
            group_id: f.get("group_id"),
          })}
        >
          <Box>
            <Text as="div" size="2" weight="medium" mb="2">
              추가할 대상
            </Text>
            <Select.Root
              name="group_id"
              value={selected}
              onValueChange={setSelected}
            >
              <Select.Trigger
                aria-label={`${text(a.token)}을 추가할 대상`}
                placeholder="대상을 직접 선택하세요"
              >
                {text(groups.find((g) => g.id === selected)?.name) || undefined}
              </Select.Trigger>
              <Select.Content>
                {groups.map((g) => (
                  <Select.Item key={text(g.id)} value={text(g.id)}>
                    {text(g.name)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>
        </ActionForm>
      </Box>
      <Box mt="3">
        <Action
          action="alias-decision"
          input={{ token: a.token, decision: "dismissed" }}
        >
          별칭 아님 · 제외
        </Action>
      </Box>
    </Panel>
  );
}
export function Aliases({ data }: { data: Row }) {
  const candidates = rows(data.candidates),
    groups = rows(data.groups);
  const primary = candidates.filter(
      (a) =>
        a.method !== "cooccurrence" && groups.some((g) => g.id === a.group_id),
    ),
    related = candidates.filter((a) => !primary.includes(a));
  return (
    <>
      <Text as="p" size="2" color="gray" mb="2">
        {text(data.note)}
      </Text>
      <Text as="p" size="1" color="gray" mb="5">
        최근 {num(data.days)}일 · 대화 {num(data.scanned)}개 검사 · 홍보·안내{" "}
        {num(data.promotion_messages_excluded)}개 제외 · 기존 키워드로 인식되는
        표현 {num(data.already_recognized_excluded)}개 제외
        {data.captured_at
          ? ` · 생성 ${time(Date.parse(text(data.captured_at)))}`
          : ""}
      </Text>
      {primary.map((a) => (
        <AliasCandidate
          key={`${text(a.token)}:${text(a.group_id)}`}
          candidate={a}
          groups={groups}
        />
      ))}
      {!!related.length && (
        <details className="alias-related">
          <summary>대상 확인이 필요한 표현 {related.length}개</summary>
          <Text as="p" size="2" color="gray" my="3">
            제안 대상이 불명확하거나 단순히 함께 언급된 표현입니다. 어느 대상의
            실제 별칭인지 확인한 뒤 추가해 주세요.
          </Text>
          {related.map((a) => (
            <AliasCandidate
              key={`${text(a.token)}:${text(a.group_id)}`}
              candidate={a}
              groups={groups}
            />
          ))}
        </details>
      )}
      {!candidates.length && (
        <Panel title="새 별칭 후보">
          <Text size="2" color="gray">
            홍보를 제외한 대화에서 현재 검토할 후보가 없습니다.
          </Text>
        </Panel>
      )}
      <Paging data={data} />
      <Panel title="처리한 후보">
        <DataTable
          columns={["표현", "대상", "결과", "변경"]}
          items={rows(data.decisions).map((d) => [
            text(d.token),
            text(groups.find((g) => g.id === d.group_id)?.name) || "—",
            d.decision === "applied" ? "추가됨" : "제외됨",
            d.decision === "dismissed" ? (
              <Action
                key={text(d.token)}
                action="alias-decision"
                input={{ token: d.token, decision: "reset" }}
              >
                다시 검토
              </Action>
            ) : null,
          ])}
        />
      </Panel>
    </>
  );
}
