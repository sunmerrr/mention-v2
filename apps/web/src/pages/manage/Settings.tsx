import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Grid,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ActionForm,
  Choice,
  CountBadge,
  DataTable,
  Field,
  FilterForm,
  Multiline,
  Notice,
  Paging,
  Panel,
  type Row,
  rows,
  split,
  strings,
  text,
  useAction,
} from "./shared";
export function Keywords({ data }: { data: Row }) {
  const [groups, setGroups] = useState(rows(data.keyword_groups)),
    [suggestions, setSuggestions] = useState<Row[]>([]),
    [sample, setSample] = useState(""),
    [check, setCheck] = useState<Row>();
  const state = useAction();
  return (
    <>
      <Panel title="수집 키워드와 제외 키워드">
        <ActionForm
          action="keyword-settings"
          build={(f) => {
            const keywords = split(f.get("keywords"));
            return {
              keywords,
              exclude_keywords: split(f.get("exclude_keywords")),
              keyword_groups: groups.map((g, i) => ({
                ...g,
                kind: f.get(`kind-${i}`),
                keywords: strings(g.keywords)
                  .map((k) => k.trim())
                  .filter((k) => keywords.includes(k)),
              })),
            };
          }}
        >
          <Grid columns={{ initial: "1", md: "2" }} gap="5">
            <Multiline
              name="keywords"
              label="포함 키워드 · 한 줄에 하나"
              value={strings(data.keywords).join("\n")}
              rows={12}
            />
            <Box>
              <Multiline
                name="exclude_keywords"
                label="제외 키워드 · 한 줄에 하나"
                value={strings(data.exclude_keywords).join("\n")}
                rows={8}
              />
              <Text as="p" size="2" color="gray" mt="2">
                회차 숫자는 자동으로 일반화합니다. 예: 오버레이 헌터 25회차 정모
                → 다른 회차도 제외합니다.
              </Text>
            </Box>
          </Grid>
          <Text size="2" weight="medium">
            대상별 하위 키워드 묶음
          </Text>
          {groups.map((g, i) => (
            <Card key={text(g.id)}>
              <Grid columns={{ initial: "1", md: "3" }} gap="3">
                <TextField.Root
                  aria-label="대상 이름"
                  value={text(g.name)}
                  onChange={(e) =>
                    setGroups(
                      groups.map((v, j) =>
                        j === i ? { ...v, name: e.target.value } : v,
                      ),
                    )
                  }
                />
                <Choice
                  name={`kind-${i}`}
                  label="유형"
                  value={text(g.kind)}
                  options={{
                    service: "서비스",
                    person: "인물",
                    event: "대회",
                    other: "기타",
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  color="red"
                  onClick={() => setGroups(groups.filter((_, j) => j !== i))}
                >
                  묶음 삭제
                </Button>
              </Grid>
              <TextArea
                className="alias-editor"
                aria-label={`${text(g.name)} 하위 키워드`}
                value={strings(g.keywords).join("\n")}
                onChange={(e) =>
                  setGroups(
                    groups.map((v, j) =>
                      j === i
                        ? { ...v, keywords: e.target.value.split("\n") }
                        : v,
                    ),
                  )
                }
              />
            </Card>
          ))}
          <Flex gap="3" wrap="wrap">
            <Button
              type="button"
              variant="soft"
              onClick={() =>
                setGroups([
                  ...groups,
                  {
                    id: `target_${Date.now()}`,
                    name: "새 대상",
                    kind: "other",
                    keywords: [],
                  },
                ])
              }
            >
              대상 묶음 추가
            </Button>
            <Button
              type="button"
              variant="soft"
              loading={state.busy}
              onClick={async () => {
                const r = await state.run("keyword-check", {
                  keywords: data.keywords,
                  keyword_groups: groups,
                  suggest_groups: true,
                });
                if (r) setSuggestions(rows(r.suggestions));
              }}
            >
              자동 묶음 제안 보기
            </Button>
          </Flex>
          {suggestions.map((s, i) => (
            <Flex key={text(s.keyword)} gap="3" align="center">
              <Text size="2">
                {text(s.keyword)} → {text(s.name)}
              </Text>
              <Button
                type="button"
                size="1"
                variant="soft"
                onClick={() => {
                  setGroups((prev) => {
                    const exists = prev.some((g) => g.id === s.group_id);
                    const cleaned: Row[] = prev.map((g) => ({
                      ...g,
                      keywords: strings(g.keywords).filter(
                        (k) => k !== s.keyword,
                      ),
                    }));
                    return exists
                      ? cleaned.map((g) =>
                          g.id === s.group_id
                            ? {
                                ...g,
                                keywords: [...strings(g.keywords), s.keyword],
                              }
                            : g,
                        )
                      : [
                          ...cleaned,
                          {
                            id: s.group_id,
                            name: s.name,
                            kind: s.kind,
                            keywords: [s.keyword],
                          },
                        ];
                  });
                  setSuggestions(suggestions.filter((_, j) => j !== i));
                }}
              >
                묶음에 적용
              </Button>
            </Flex>
          ))}
          <Notice state={state} />
        </ActionForm>
      </Panel>
      <Panel title="수집 규칙 시험">
        <TextField.Root
          aria-label="시험 메시지"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="메시지를 입력하세요"
        />
        <Button
          mt="3"
          variant="soft"
          onClick={async () => {
            const r = await state.run("keyword-check", {
              sample,
              keywords: data.keywords,
              exclude_keywords: data.exclude_keywords,
              keyword_groups: groups,
            });
            if (r) setCheck(r);
          }}
        >
          현재 저장 규칙으로 확인
        </Button>
        {check && (
          <Text as="p" mt="3" size="2">
            {check.save ? "수집 대상" : "수집 제외"} · 포함:{" "}
            {strings(check.matched).join(", ") || "없음"} · 제외:{" "}
            {strings(check.excluded).join(", ") || "없음"}
          </Text>
        )}
      </Panel>
    </>
  );
}
export function Rooms({ data }: { data: Row }) {
  const [p] = useSearchParams(),
    [selected, set] = useState<string[]>([]);
  const state = useAction();
  return (
    <>
      <FilterForm>
        <Field name="q" label="방 이름 검색" value={p.get("q") || ""} />
        <Choice
          name="state"
          label="수집 상태"
          value={p.get("state") || "all"}
          options={{
            all: "참여 중 전체",
            active: "분석 포함",
            excluded: "분석 제외",
            inactive: "미참여",
          }}
        />
        <Field
          name="day"
          label="집계 날짜"
          type="date"
          value={text(data.day)}
        />
      </FilterForm>
      <Panel title="수집 대상" action={<CountBadge value={data.total} />}>
        <Text as="p" size="2" color="gray" mb="4">
          참여한 방은 기본 포함합니다. 분석 제외는 가이드 응답·예약 발송 중지와
          별개입니다. 기존 저장 기록은 유지합니다.
        </Text>
        <Flex gap="3" mb="4">
          <Button
            variant="soft"
            disabled={!selected.length || state.busy}
            onClick={async () => {
              await state.run("room-settings", {
                room_ids: selected,
                excluded: false,
              });
              set([]);
            }}
          >
            선택한 방 분석 포함
          </Button>
          <Button
            variant="soft"
            color="gray"
            disabled={!selected.length || state.busy}
            onClick={async () => {
              await state.run("room-settings", {
                room_ids: selected,
                excluded: true,
              });
              set([]);
            }}
          >
            선택한 방 분석 제외
          </Button>
        </Flex>
        <Notice state={state} />
        <DataTable
          columns={["선택", "방 이름", "분석 상태", "저장 메시지"]}
          items={rows(data.rooms).map((r) => [
            <Checkbox
              key={text(r.id)}
              aria-label={`${text(r.name)} 선택`}
              checked={selected.includes(text(r.id))}
              onCheckedChange={(v) =>
                set(
                  v
                    ? [...selected, text(r.id)]
                    : selected.filter((x) => x !== r.id),
                )
              }
            />,
            text(r.name),
            <Badge key={text(r.id)} color={r.excluded ? "gray" : "jade"}>
              {r.excluded ? "제외" : "포함"}
            </Badge>,
            text(r.count),
          ])}
        />
        <Paging data={data} />
      </Panel>
    </>
  );
}
export function Guide({ data }: { data: Row }) {
  const [p] = useSearchParams(),
    room = p.get("room"),
    guides = rows(data.guides);
  const guide = guides.find((g) => g.room_id === room);
  const [references, setReferences] = useState<(Row & { _key: string })[]>(
    rows(guide?.references).map((r, i) => ({ ...r, _key: `reference_${i}` })),
  );
  return (
    <>
      <Panel title="가이드 관리 방">
        <DataTable
          columns={["방", "수집", "응답", "키워드 / 호명 / 자료", "기록"]}
          items={guides.map((g) => [
            <Link key={text(g.room_id)} to={`/guide?room=${text(g.room_id)}`}>
              {text(g.name)}
            </Link>,
            g.enabled ? "켜짐" : "꺼짐",
            g.respond ? "켜짐" : "꺼짐",
            `${strings(g.keywords).length} / ${strings(g.names).length} / ${rows(g.references).length}`,
            text(g.count),
          ])}
        />
      </Panel>
      {room && guide && (
        <Panel title={`${text(guide.name)} 설정`}>
          <ActionForm
            action="guide-settings"
            build={(f) => ({
              room_id: room,
              enabled: f.get("enabled") === "on",
              respond: f.get("respond") === "on",
              keywords: split(f.get("keywords")),
              names: split(f.get("names")),
              references: references
                .map((_, i) => ({
                  kind: f.get(`kind-${i}`),
                  label: f.get(`label-${i}`),
                  value: f.get(`value-${i}`),
                }))
                .filter((r) => r.value),
            })}
          >
            <Flex gap="5">
              <Text as="label" size="2">
                <Checkbox name="enabled" defaultChecked={!!guide.enabled} />{" "}
                가이드 수집
              </Text>
              <Text as="label" size="2">
                <Checkbox name="respond" defaultChecked={!!guide.respond} />{" "}
                가이드 응답
              </Text>
            </Flex>
            <Grid columns={{ initial: "1", md: "2" }} gap="4">
              <Multiline
                label="전용 키워드"
                name="keywords"
                value={strings(guide.keywords).join("\n")}
              />
              <Multiline
                label="응답 이름"
                name="names"
                value={strings(guide.names).join("\n")}
              />
            </Grid>
            <Text size="2" weight="medium">
              참고 자료
            </Text>
            {references.map((r, i) => (
              <Grid key={r._key} columns={{ initial: "1", md: "3" }} gap="3">
                <Choice
                  name={`kind-${i}`}
                  label="자료 종류"
                  value={text(r.kind)}
                  options={{ website: "웹사이트", document: "문서" }}
                />
                <Field
                  label="자료 이름"
                  name={`label-${i}`}
                  value={text(r.label)}
                />
                <Field
                  label="주소 또는 문서 경로"
                  name={`value-${i}`}
                  value={text(r.value)}
                />
                <Button
                  type="button"
                  size="1"
                  variant="ghost"
                  color="red"
                  onClick={() =>
                    setReferences(
                      references.filter((ref) => ref._key !== r._key),
                    )
                  }
                >
                  자료 삭제
                </Button>
              </Grid>
            ))}
            <Button
              type="button"
              variant="soft"
              onClick={() =>
                setReferences([
                  ...references,
                  {
                    _key: crypto.randomUUID(),
                    kind: "website",
                    label: "",
                    value: "",
                  },
                ])
              }
            >
              참고 자료 추가
            </Button>
          </ActionForm>
        </Panel>
      )}
      {!room && (
        <Panel title="새 방 가이드 설정">
          <ActionForm
            action="guide-settings"
            build={(f) => ({
              room_id: f.get("room_id"),
              enabled: false,
              respond: false,
              keywords: [],
              names: [],
              references: [],
            })}
            submit="가이드 관리에 추가"
          >
            <Choice
              label="참여 중인 방"
              name="room_id"
              options={Object.fromEntries(
                rows(data.available_rooms).map((r) => [
                  text(r.id),
                  text(r.name),
                ]),
              )}
            />
            <Text size="2" color="gray">
              추가 후 수집·응답을 별도로 설정합니다. 발송 허용 목록은 확대하지
              않습니다.
            </Text>
          </ActionForm>
        </Panel>
      )}
      {room && (
        <Panel title="최근 가이드 메시지">
          <DataTable
            columns={["시각", "참여자", "내용"]}
            items={rows(data.messages).map((m) => [
              text(m.observed_at),
              text(m.author_name),
              <Text key={text(m.log_id)} className="message-copy">
                {text(m.text)}
              </Text>,
            ])}
          />
        </Panel>
      )}
    </>
  );
}
