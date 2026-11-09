import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { labels, time } from "../../components/ui";
import { Box, Button, Checkbox, Flex, Grid, Text } from "../../design-system";
import { workspaceQuery } from "../../workspace-query";
import { Highlight } from "./Records";
import {
  Action,
  ActionForm,
  Choice,
  Field,
  Multiline,
  Notice,
  num,
  obj,
  Panel,
  type Row,
  rows,
  strings,
  text,
  useAction,
} from "./shared";
export function useContextExpansion(id: string, conversation = false) {
  const state = useAction();
  const [result, setResult] = useState("");
  const [direction, setDirection] = useState<"before" | "after">("before");
  async function expand(next: "before" | "after") {
    setDirection(next);
    setResult("");
    const r = await state.run("context-expand", {
      id,
      conversation,
      direction: next,
      minutes: next === "before" ? 30 : 15,
    });
    if (r)
      setResult(
        `${num(next === "before" ? r.added_before : r.added_after)}개 추가 · ${r.complete ? "조회 범위 확인" : "일부 구간 미확인 또는 다음 수신 대기"}`,
      );
  }
  return { state, result, direction, expand };
}
export function ContextExpandButton({
  controller,
  direction,
}: {
  controller: ReturnType<typeof useContextExpansion>;
  direction: "before" | "after";
}) {
  const active = controller.direction === direction;
  return (
    <Box className="context-expand">
      <Button
        intent="quiet"
        loading={active && controller.state.busy}
        disabled={controller.state.busy}
        onClick={() => controller.expand(direction)}
      >
        {direction === "before" ? (
          <ChevronUp size={14} />
        ) : (
          <ChevronDown size={14} />
        )}
        {direction === "before" ? "이전" : "이후"} 대화 더 불러오기
      </Button>
      {active && (
        <>
          <Notice state={controller.state} />
          <ContextResult value={controller.result} />
        </>
      )}
    </Box>
  );
}
export function ContextActions({
  id,
  conversation = false,
}: {
  id: string;
  conversation?: boolean;
}) {
  const controller = useContextExpansion(id, conversation);
  return (
    <Flex gap="3" wrap="wrap" mb="4">
      <ContextExpandButton controller={controller} direction="before" />
      <ContextExpandButton controller={controller} direction="after" />
    </Flex>
  );
}
function ContextResult({ value }: { value: unknown }) {
  return value ? (
    <Text as="p" size="2">
      {text(value)}
    </Text>
  ) : null;
}
export function Relevance({
  id,
  logId,
  conversation = false,
  onReview,
}: {
  id: string;
  logId: string;
  conversation?: boolean;
  onReview?: (ids: unknown[]) => void;
}) {
  const state = useAction(),
    [undo, setUndo] = useState<unknown[]>([]);
  return (
    <Box mt="3">
      <Flex gap="2" wrap="wrap">
        {Object.entries({
          related: "관련 대화",
          unrelated: "관련 없음",
          pending: "판단 대기",
        }).map(([relation, label]) => (
          <Button
            key={relation}
            variant="ghost"
            size="1"
            color="gray"
            loading={state.busy}
            onClick={async () => {
              const r = await state.run(
                conversation ? "conversation-message-review" : "episode-review",
                { id, log_id: logId, relation },
              );
              if (r) {
                const ids = Array.isArray(r.undo_ids) ? r.undo_ids : [];
                onReview?.(ids);
                setUndo(
                  conversation
                    ? Array.isArray(r.undo_ids)
                      ? r.undo_ids
                      : []
                    : [],
                );
              }
            }}
          >
            {label}
          </Button>
        ))}
        {undo.length > 0 && (
          <Button
            variant="soft"
            size="1"
            onClick={async () => {
              for (const history_id of undo)
                await state.run("review-undo", { history_id });
              setUndo([]);
            }}
          >
            방금 변경 되돌리기
          </Button>
        )}
      </Flex>
      <Notice state={state} />
    </Box>
  );
}
export function BookmarkSource({
  id,
  kind,
  embedded = false,
}: {
  id: string;
  kind: "conversation" | "episode";
  embedded?: boolean;
}) {
  const search = `?kind=${kind}&source_id=${id}`,
    query = useQuery(workspaceQuery("bookmarks", search));
  const data = query.data || {},
    existing = rows(data.items)[0] || {};
  const form = (
    <Box mt="4">
      <ActionForm
        action="bookmark-save"
        build={(f) => ({
          kind,
          source_id: id,
          category: f.get("category"),
          status: f.get("status"),
          owner: f.get("owner"),
          note: f.get("note"),
        })}
      >
        <Grid columns={{ initial: "1", sm: "3" }} gap="3">
          <Choice
            name="category"
            label="분류"
            value={text(existing.category) || "other"}
            options={{
              complaint: "불만",
              purchase_intent: "이용·구매 의향",
              improvement: "개선 요청",
              question: "확인할 질문",
              other: "기타",
            }}
          />
          <Choice
            name="status"
            label="상태"
            value={text(existing.status) || "todo"}
            options={{
              todo: "확인 대기",
              in_progress: "처리 중",
              done: "처리 완료",
            }}
          />
          <Field name="owner" label="담당자" value={text(existing.owner)} />
        </Grid>
        <Multiline name="note" label="메모" value={text(existing.note)} />
      </ActionForm>
    </Box>
  );
  return embedded ? (
    form
  ) : (
    <details className="background-message">
      <summary>중요 대화로 보관 · 담당자·메모 관리</summary>
      {form}
    </details>
  );
}
function Feedback({ id, message }: { id: string; message: Row }) {
  const note = obj(message.feedback_annotation);
  return (
    <details className="background-message">
      <summary>피드백 주제·반응 평가</summary>
      <Box mt="3">
        <ActionForm
          action="feedback-review"
          build={(f) => ({
            id,
            log_id: message.log_id,
            topics: f.getAll("topic"),
            stance: f.get("stance"),
            note: f.get("note"),
          })}
        >
          <Flex gap="3" wrap="wrap">
            {Object.entries({
              price: "가격",
              benefit: "혜택",
              intent: "이용·구매 의향",
              usability: "이용 경험",
              other: "기타",
            }).map(([k, l]) => (
              <Text as="label" size="2" key={k}>
                <Checkbox
                  name="topic"
                  value={k}
                  defaultChecked={strings(note.topics).includes(k)}
                />{" "}
                {l}
              </Text>
            ))}
          </Flex>
          <Choice
            name="stance"
            label="반응"
            value={text(note.stance) || "uncertain"}
            options={Object.fromEntries(
              Object.entries(labels).filter(([k]) => k !== "unreviewed"),
            )}
          />
          <Multiline name="note" label="평가 메모" value={text(note.note)} />
        </ActionForm>
        {!!message.feedback_annotation && (
          <Box mt="3">
            <Action
              action="feedback-review"
              input={{ id, log_id: message.log_id, clear: true }}
            >
              피드백 표기 지우기
            </Action>
          </Box>
        )}
      </Box>
    </details>
  );
}
export function Episode({ data }: { data: Row }) {
  const id = text(data.id),
    last = obj(data.last_review),
    keywords = strings(data.current_matches);
  return (
    <>
      <Text as="p" size="2" color="gray" mb="4">
        {text(data.room)} · {time(num(data.anchor_ms))}
      </Text>
      <Panel title={text(data.title)}>
        <Text as="p" size="2" mb="4">
          확보된 이전 맥락 {num(data.before_count)}개 · 이후 맥락{" "}
          {num(data.after_count)}개
        </Text>
        <ContextActions id={id} />
        <Flex gap="3" wrap="wrap">
          {!!last.id && (
            <Action action="review-undo" input={{ history_id: last.id }}>
              최근 관련성 변경 되돌리기
            </Action>
          )}
          {data.kind === "campaign" && !!data.active && (
            <Action action="campaign-stop" input={{ id }}>
              반응 관찰 종료
            </Action>
          )}
        </Flex>
        <Grid columns={{ initial: "1", md: "2" }} gap="4" mt="4">
          <ActionForm
            action="episode-review"
            submit="여론 평가 저장"
            build={(f) => ({ id, verdict: f.get("verdict") })}
          >
            <Choice
              name="verdict"
              label="대화 여론"
              value={text(data.verdict)}
              options={labels}
            />
          </ActionForm>
          <ActionForm
            action="episode-quality"
            submit="분석 대상 분류 저장"
            build={(f) => ({ id, choice: f.get("choice") })}
          >
            <Choice
              name="choice"
              label="대화 성격"
              value={text(data.analysis_override) || "auto"}
              options={{
                auto: "자동 판정",
                discussion: "분석할 대화",
                promotion: "홍보·정보 도배",
              }}
            />
          </ActionForm>
        </Grid>
        <Text as="p" size="1" color="gray" mt="4">
          {strings(obj(data.quality).reasons).join(" · ")}
        </Text>
        {data.kind === "mention" && (
          <Box mt="4">
            <ActionForm
              action="mention-correction"
              submit="키워드 의미 판정 저장"
              build={(f) => ({
                id,
                label: f.get("label"),
                reason: f.get("reason"),
              })}
            >
              <Choice
                name="label"
                label="우리 서비스와 관련된 언급인가요?"
                value={text(obj(data.correction).label) || "auto"}
                options={{
                  auto: "자동 판정",
                  relevant: "서비스 관련",
                  off_target: "다른 의미의 키워드",
                }}
              />
              <Field
                name="reason"
                label="판정 이유"
                value={text(obj(data.correction).reason)}
              />
            </ActionForm>
          </Box>
        )}
      </Panel>
      <BookmarkSource id={id} kind="episode" />
      <Panel title="원문과 앞뒤 맥락">
        {rows(data.messages).map((m) => {
          const content = (
            <Box className="message" py="4" key={text(m.log_id)}>
              <Flex gap="3" align="center">
                <Text size="2" weight="medium">
                  {text(m.author_name) || "참여자"}
                </Text>
                <Text size="1" color="gray">
                  {time(num(m.time_ms))} ·{" "}
                  {
                    (
                      {
                        before: "이전",
                        anchor: "기준 발언",
                        after: "이후",
                      } as Record<string, string>
                    )[text(m.role)]
                  }{" "}
                  ·{" "}
                  {
                    (
                      {
                        related: "관련",
                        unrelated: "무관",
                        pending: "판단 대기",
                      } as Record<string, string>
                    )[text(m.relation)]
                  }
                </Text>
              </Flex>
              <Text as="p" className="message-copy" size="2" mt="3">
                <Highlight value={text(m.text)} keywords={keywords} />
              </Text>
              <Flex gap="3" mt="3">
                {rows(m.photos).map((p, _i) => (
                  <a
                    href={text(p.url)}
                    key={text(p.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      className="chat-photo"
                      src={text(p.thumbnail || p.url)}
                      alt="저장된 첨부 이미지"
                      loading="lazy"
                    />
                  </a>
                ))}
              </Flex>
              {m.role !== "anchor" && (
                <Relevance id={id} logId={text(m.log_id)} />
              )}
              {data.kind === "campaign" &&
                m.role === "after" &&
                m.relation === "related" &&
                !m.own && <Feedback id={id} message={m} />}
            </Box>
          );
          return m.context_folded ? (
            <details key={text(m.log_id)} className="background-message">
              <summary>
                사진·링크·홍보 추정 자료 · {time(num(m.time_ms))}
              </summary>
              {content}
            </details>
          ) : (
            content
          );
        })}
      </Panel>
      <Panel title="수집 공백·주의 기록">
        {rows(data.gaps).map((g, _i) => (
          <Text as="p" size="2" key={text(g.id)}>
            {text(g.at)} · {text(g.reason)} ·{" "}
            {g.resolved ? "범위 복구 확인" : "미확인"}
          </Text>
        ))}
      </Panel>
    </>
  );
}

export function UndoReview({
  ids,
  onDone,
}: {
  ids: unknown[];
  onDone: () => void;
}) {
  const state = useAction();
  return ids.length ? (
    <Box mb="4">
      <Button
        size="2"
        variant="soft"
        loading={state.busy}
        onClick={async () => {
          for (const history_id of ids) {
            const result = await state.run("review-undo", { history_id });
            if (!result) return;
          }
          onDone();
        }}
      >
        최근 관련성 변경 되돌리기
      </Button>
      <Notice state={state} />
    </Box>
  ) : null;
}
