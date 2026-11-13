import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  type KeywordSource,
  sharedPolicy,
} from "../../../../../packages/contracts/src/keyword-policy";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Grid,
  PreviewDisclosure,
  Select,
  SelectionPanel,
  Text,
  TextArea,
  TextField,
} from "../../design-system";
import { api } from "../../queries";
import { useRuntime } from "../../runtime";
import { KeywordSources } from "./KeywordSources";
import {
  ActionForm,
  Choice,
  DataTable,
  Field,
  Multiline,
  Notice,
  num,
  obj,
  Paging,
  Panel,
  type Row,
  rows,
  split,
  strings,
  text,
  useAction,
} from "./shared";

function ForumProcessingStatus() {
  const query = useQuery({
    queryKey: ["source-keyword-processing"],
    queryFn: () => api<{ state: string }>("/api/source-keywords/status"),
    refetchInterval: 2000,
  });
  const status = query.data?.state;
  if (!status || ["idle", "unavailable"].includes(status)) return null;
  return (
    <Text
      as="p"
      size="2"
      color={status === "failed" ? "red" : "gray"}
      role="status"
    >
      {status === "queued" || status === "running"
        ? "포커고수 기존 글의 키워드 갱신 중"
        : status === "failed"
          ? "설정은 저장됐지만 포커고수 기존 글 갱신에 실패했습니다. 다시 저장하면 재시도합니다."
          : "포커고수 키워드 갱신 완료"}
    </Text>
  );
}
function KeywordProcessingStatus() {
  const query = useQuery({
    queryKey: ["keyword-processing"],
    queryFn: () => api<Row>("/api/workspace/keywordProcessing"),
    refetchInterval: (query) =>
      query.state.data?.supported === false
        ? false
        : ["queued", "running"].includes(text(query.state.data?.state))
          ? 2000
          : 30000,
  });
  const value = query.data;
  if (!value?.supported) return null;
  const status = text(value.state);
  if (status === "idle") return null;
  return (
    <Text
      as="p"
      size="2"
      color={status === "failed" ? "red" : "gray"}
      role="status"
    >
      {status === "queued" || status === "running"
        ? "설정 저장 완료 · 기존 데이터와 CSV 갱신 중"
        : status === "failed"
          ? "설정은 저장됐지만 기존 데이터 갱신에 실패했습니다. 다시 저장하면 재시도합니다."
          : "설정 저장 및 기존 데이터·CSV 갱신 완료"}
    </Text>
  );
}
export function Keywords({ data }: { data: Row }) {
  const initial = sharedPolicy(data);
  const [wordText, setWordText] = useState(initial.keywords.join("\n")),
    [sources, setSources] = useState(initial.sources);
  const [groups, setGroups] = useState(rows(initial.keyword_groups)),
    [suggestions, setSuggestions] = useState<Row[]>([]),
    [sample, setSample] = useState(""),
    [check, setCheck] = useState<Row>();
  const words = split(wordText);
  const state = useAction();
  const [expandedGroup, setExpandedGroup] = useState<string>();
  const [editRules, setEditRules] = useState(false);
  return (
    <>
      <Panel title="공통 대상·별칭과 출처별 수집 설정">
        <KeywordProcessingStatus />
        <ForumProcessingStatus />
        <ActionForm
          action="keyword-settings"
          build={(f) => {
            const keywords = words;
            const keyword_groups = groups.map((g) => ({
              ...g,
              kind: text(g.kind) || "other",
              keywords: strings(g.keywords)
                .map((k) => k.trim())
                .filter((k) => keywords.includes(k)),
            }));
            return {
              keywords,
              exclude_keywords: split(f.get("exclude_keywords")),
              keyword_groups,
              ...(data.keyword_policy_supported
                ? {
                    keyword_policy: {
                      version: 1,
                      keywords,
                      keyword_groups,
                      sources: {
                        kakao: {
                          disabled: sources.kakao.disabled.filter((w) =>
                            keywords.includes(w),
                          ),
                        },
                        pokergosu: {
                          disabled: sources.pokergosu.disabled.filter((w) =>
                            keywords.includes(w),
                          ),
                        },
                      },
                    },
                    keyword_policy_token: data.keyword_policy_token,
                  }
                : {}),
            };
          }}
        >
          <KeywordSources
            words={words}
            groups={groups}
            sources={sources}
            supported={data.keyword_policy_supported === true}
            onChange={setSources}
            onAdd={(word, target, source: KeywordSource | "both") => {
              setWordText((prev) => [...split(prev), word].join("\n"));
              setGroups((prev) =>
                prev.map((g) =>
                  text(g.id) === target
                    ? { ...g, keywords: [...strings(g.keywords), word] }
                    : g,
                ),
              );
              setSources((prev) => ({
                kakao: {
                  disabled:
                    source === "pokergosu"
                      ? [...prev.kakao.disabled, word]
                      : prev.kakao.disabled,
                },
                pokergosu: {
                  disabled:
                    source === "kakao"
                      ? [...prev.pokergosu.disabled, word]
                      : prev.pokergosu.disabled,
                },
              }));
            }}
          />
          <PreviewDisclosure
            title="포함·제외 문구 직접 편집"
            open={editRules}
            onOpenChange={setEditRules}
            preview={
              <Text size="1" color="gray">
                포함 키워드와 카톡 제외 문구
              </Text>
            }
          >
            <Grid columns={{ initial: "1", md: "2" }} gap="5">
              <Multiline
                name="keywords"
                label="포함 키워드 · 한 줄에 하나"
                value={wordText}
                onChange={setWordText}
                rows={12}
              />
              <Multiline
                name="exclude_keywords"
                label="제외 키워드 · 한 줄에 하나"
                value={strings(data.exclude_keywords).join("\n")}
                rows={12}
              />
            </Grid>
          </PreviewDisclosure>
          <Text as="p" size="1" color="gray">
            제외 문구는 카톡에만 적용합니다. 제외 키워드의 회차 숫자는 자동으로
            일반화합니다. 예: ‘오버레이 헌터 25회차 정모’는 다른 회차도
            제외합니다.
          </Text>
          <Flex justify="between" align="center" gap="3" wrap="wrap">
            <Text size="2" weight="medium">
              대상별 하위 키워드 묶음
            </Text>
            <Flex gap="3" wrap="wrap">
              <Button
                type="button"
                intent="quiet"
                size="1"
                loading={state.busy}
                onClick={async () => {
                  const result = await state.run("keyword-check", {
                    keywords: data.keywords,
                    keyword_groups: groups,
                    suggest_groups: true,
                  });
                  if (result) setSuggestions(rows(result.suggestions));
                }}
              >
                자동 묶음 제안
              </Button>
              <Button
                type="button"
                intent="secondary"
                size="1"
                onClick={() => {
                  const id = `target_${Date.now()}`;
                  setGroups([
                    ...groups,
                    { id, name: "새 대상", kind: "other", keywords: [] },
                  ]);
                  setExpandedGroup(id);
                }}
              >
                <Plus size={14} />
                묶음 추가
              </Button>
            </Flex>
          </Flex>
          <div className="keyword-group-list">
            {groups.map((group, index) => {
              const id = text(group.id),
                name = text(group.name),
                keywords = [
                  ...new Set(
                    strings(group.keywords)
                      .map((keyword) => keyword.trim())
                      .filter(Boolean),
                  ),
                ];
              return (
                <PreviewDisclosure
                  key={id}
                  title={name || "이름 없는 대상"}
                  metadata={
                    <Badge color="gray">
                      {(
                        {
                          service: "서비스",
                          person: "인물",
                          event: "대회",
                          other: "기타",
                        } as Record<string, string>
                      )[text(group.kind)] || "기타"}
                    </Badge>
                  }
                  preview={
                    <Flex gap="2" align="center" wrap="wrap">
                      {keywords.slice(0, 5).map((keyword) => (
                        <Badge
                          color="gray"
                          variant="outline"
                          key={keyword}
                          className="keyword-preview"
                        >
                          {keyword}
                        </Badge>
                      ))}
                      {keywords.length > 5 && (
                        <Text size="1" color="gray">
                          외 {keywords.length - 5}개
                        </Text>
                      )}
                      {!keywords.length && (
                        <Text size="1" color="gray">
                          하위 키워드를 추가하세요
                        </Text>
                      )}
                    </Flex>
                  }
                  open={expandedGroup === id}
                  onOpenChange={(open) =>
                    setExpandedGroup((current) =>
                      open ? id : current === id ? undefined : current,
                    )
                  }
                >
                  <Grid columns={{ initial: "1", sm: "2" }} gap="4" mb="4">
                    <Box>
                      <Text
                        as="label"
                        htmlFor={`group-name-${id}`}
                        size="2"
                        weight="medium"
                        mb="2"
                        style={{ display: "block" }}
                      >
                        대상 이름
                      </Text>
                      <TextField.Root
                        id={`group-name-${id}`}
                        aria-label="대상 이름"
                        value={name}
                        onChange={(event) =>
                          setGroups(
                            groups.map((value, i) =>
                              i === index
                                ? { ...value, name: event.target.value }
                                : value,
                            ),
                          )
                        }
                      />
                    </Box>
                    <Box>
                      <Text as="p" size="2" weight="medium" mb="2">
                        유형
                      </Text>
                      <Select.Root
                        name={`kind-${index}`}
                        value={text(group.kind) || "other"}
                        onValueChange={(kind) =>
                          setGroups(
                            groups.map((value, i) =>
                              i === index ? { ...value, kind } : value,
                            ),
                          )
                        }
                      >
                        <Select.Trigger aria-label={`${name} 유형`}>
                          {(
                            {
                              service: "서비스",
                              person: "인물",
                              event: "대회",
                              other: "기타",
                            } as Record<string, string>
                          )[text(group.kind)] || "기타"}
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="service">서비스</Select.Item>
                          <Select.Item value="person">인물</Select.Item>
                          <Select.Item value="event">대회</Select.Item>
                          <Select.Item value="other">기타</Select.Item>
                        </Select.Content>
                      </Select.Root>
                    </Box>
                  </Grid>
                  <Text
                    as="label"
                    htmlFor={`group-keywords-${id}`}
                    size="2"
                    weight="medium"
                    mb="2"
                    style={{ display: "block" }}
                  >
                    하위 키워드 · 한 줄에 하나
                  </Text>
                  <TextArea
                    id={`group-keywords-${id}`}
                    aria-label={`${name} 하위 키워드`}
                    rows={5}
                    value={strings(group.keywords).join("\n")}
                    onChange={(event) =>
                      setGroups(
                        groups.map((value, i) =>
                          i === index
                            ? {
                                ...value,
                                keywords: event.target.value.split("\n"),
                              }
                            : value,
                        ),
                      )
                    }
                  />
                  <Flex justify="end" mt="3">
                    <Button
                      type="button"
                      intent="quiet"
                      color="red"
                      size="1"
                      onClick={() => {
                        setGroups(groups.filter((_, i) => i !== index));
                        setExpandedGroup(undefined);
                      }}
                    >
                      <Trash2 size={14} />
                      묶음 삭제
                    </Button>
                  </Flex>
                </PreviewDisclosure>
              );
            })}
          </div>
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
function RoomTransferIcon({ toExcluded }: { toExcluded: boolean }) {
  return (
    <>
      <Box
        as="span"
        display={{ initial: "none", md: "inline-block" }}
        aria-hidden="true"
      >
        {toExcluded ? (
          <ArrowRightToLine size={16} strokeWidth={1.75} />
        ) : (
          <ArrowLeftToLine size={16} strokeWidth={1.75} />
        )}
      </Box>
      <Box
        as="span"
        display={{ initial: "inline-block", md: "none" }}
        aria-hidden="true"
      >
        {toExcluded ? (
          <ArrowDownToLine size={16} strokeWidth={1.75} />
        ) : (
          <ArrowUpToLine size={16} strokeWidth={1.75} />
        )}
      </Box>
    </>
  );
}
export function Rooms({ data }: { data: Row }) {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<{
    included: string[];
    excluded: string[];
  }>({ included: [], excluded: [] });
  const state = useAction();
  const { writesEnabled } = useRuntime();
  return (
    <>
      <form
        className="room-search"
        key={params.get("q") || ""}
        onSubmit={(event) => {
          event.preventDefault();
          const q = String(
            new FormData(event.currentTarget).get("q") || "",
          ).trim();
          setParams(q ? { q } : {});
        }}
      >
        <TextField.Root
          name="q"
          aria-label="방 이름 검색"
          placeholder="방 이름 검색"
          defaultValue={params.get("q") || ""}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button type="submit" intent="secondary">
          검색
        </Button>
        {params.get("q") && (
          <Button intent="quiet" type="button" onClick={() => setParams({})}>
            초기화
          </Button>
        )}
      </form>
      <Text as="p" size="2" color="gray" mb="4">
        참여한 방은 기본 포함합니다. 분석에서 제외해도 기존 기록은 유지되며,
        가이드 응답·예약 발송에는 영향을 주지 않습니다.
      </Text>
      <Notice state={state} />
      <Grid columns={{ initial: "1", md: "2" }} gap="5">
        {(["included", "excluded"] as const).map((key) => {
          const page = obj(data[key]);
          const rooms = rows(page.rooms);
          const ids = rooms.map((room) => text(room.id));
          const chosen = selected[key].filter((id) => ids.includes(id));
          const isIncluded = key === "included";
          return (
            <SelectionPanel
              key={key}
              title={isIncluded ? "분석 포함" : "분석 제외"}
              description={`총 ${num(page.total)}개 방${params.get("q") ? " · 검색 결과" : ""}`}
              items={rooms.map((room) => ({
                id: text(room.id),
                label: text(room.name),
              }))}
              selected={chosen}
              disabled={state.busy || !writesEnabled}
              onSelectionChange={(values) =>
                setSelected((previous) => ({ ...previous, [key]: values }))
              }
              action={
                chosen.length > 0 ? (
                  <Button
                    intent="secondary"
                    disabled={!writesEnabled || state.busy}
                    loading={state.busy}
                    onClick={async () => {
                      const result = await state.run("room-settings", {
                        room_ids: chosen,
                        excluded: isIncluded,
                      });
                      if (result)
                        setSelected((previous) => ({ ...previous, [key]: [] }));
                    }}
                  >
                    {!isIncluded && <RoomTransferIcon toExcluded={false} />}
                    {isIncluded ? "제외로 이동" : "포함으로 이동"} ·{" "}
                    {chosen.length}
                    {isIncluded && <RoomTransferIcon toExcluded />}
                  </Button>
                ) : undefined
              }
              empty={
                params.get("q")
                  ? "검색 결과가 없습니다."
                  : isIncluded
                    ? "분석에 포함된 방이 없습니다."
                    : "분석에서 제외한 방이 없습니다."
              }
              footer={
                num(page.pages) > 1 ? (
                  <Paging data={page} pageKey={`${key}_page`} />
                ) : undefined
              }
            />
          );
        })}
      </Grid>
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
