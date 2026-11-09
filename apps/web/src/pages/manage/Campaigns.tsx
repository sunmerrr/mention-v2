import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { labels, time } from "../../components/ui";
import {
  Box,
  Button,
  Callout,
  Checkbox,
  Flex,
  Grid,
  Text,
} from "../../design-system";
import { useRuntime } from "../../runtime";
import {
  Choice,
  DataTable,
  Field,
  Multiline,
  Notice,
  num,
  obj,
  Panel,
  type Row,
  rows,
  text,
  useAction,
} from "./shared";
export function Campaigns({ data }: { data: Row }) {
  const runtime = useRuntime(),
    state = useAction(),
    navigate = useNavigate(),
    request = useRef("");
  const [mode, setMode] = useState("manual");
  const [pending, setPending] = useState<Row | null>(null),
    [pendingError, setPendingError] = useState("");
  const pendingKey = "mention-campaign-send-pending";
  useEffect(() => {
    try {
      const saved = localStorage.getItem(pendingKey);
      if (!saved) return;
      const record = obj(JSON.parse(saved));
      if (
        !record.request_id ||
        !record.room_id ||
        !record.seed ||
        !record.title
      )
        throw Error();
      setPending(record);
    } catch {
      setPendingError(
        "기존 발송 요청 기록을 확인할 수 없습니다. 실제 발송 결과를 먼저 확인해 주세요.",
      );
    }
  }, []);
  return (
    <>
      <Panel title="새 반응 관찰">
        <Text as="p" size="2" color="gray" mb="4">
          이미 보낸 질문을 등록하거나, 로컬에서 질문을 직접 발송하고 반응을
          관찰합니다.
        </Text>
        <Flex gap="3" mb="4">
          <Button
            variant={mode === "manual" ? "solid" : "soft"}
            onClick={() => setMode("manual")}
          >
            이미 보낸 질문 등록
          </Button>
          <Button
            variant={mode === "send" ? "solid" : "soft"}
            disabled={!runtime.local}
            onClick={() => setMode("send")}
          >
            질문 직접 발송
          </Button>
        </Flex>
        {mode === "send" && pending && (
          <Callout.Root mb="4">
            <Callout.Text>
              확인 중인 기존 요청: {text(pending.title)}
              <br />
              {text(pending.seed)}
              <br />새 질문을 보내지 않고 이 요청의 상태를 확인합니다.
            </Callout.Text>
          </Callout.Root>
        )}
        {mode === "send" && pendingError && (
          <Text as="p" color="red">
            {pendingError}
          </Text>
        )}
        <form
          key={mode + text(pending?.request_id)}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            let input: Row = {
              room_id: f.get("room_id"),
              title: f.get("title"),
              seed: f.get("seed"),
              duration: Number(f.get("duration")),
            };
            if (mode === "send") {
              if (pendingError) return;
              if (pending) input = pending;
              else {
                input.request_id = crypto.randomUUID();
                try {
                  localStorage.setItem(pendingKey, JSON.stringify(input));
                } catch {
                  setPendingError(
                    "요청 ID를 보존할 수 없어 발송을 시작하지 않았습니다.",
                  );
                  return;
                }
                setPending(input);
              }
            } else {
              request.current ||= crypto.randomUUID();
              input.request_id = request.current;
              input.anchor_ms = new Date(
                `${f.get("start")}:00+09:00`,
              ).getTime();
            }
            const r = await state.run(
              mode === "send" ? "campaign-send" : "campaign-start",
              input,
            );
            if (r?.id) {
              if (mode === "send") localStorage.removeItem(pendingKey);
              navigate(`/episode?id=${text(r.id)}`);
            }
          }}
        >
          <fieldset
            disabled={mode === "send" && !!pending}
            className="plain-fieldset"
          >
            <Grid columns={{ initial: "1", md: "2" }} gap="4">
              <Choice
                name="room_id"
                label="대상 방"
                value={text(pending?.room_id)}
                options={Object.fromEntries(
                  rows(data.rooms).map((r) => [text(r.id), text(r.name)]),
                )}
              />
              <Field
                name="title"
                label="관찰 제목"
                value={text(pending?.title)}
                required
              />
              <Choice
                name="duration"
                label="관찰 시간"
                value={text(pending?.duration) || "30"}
                options={{
                  "5": "5분",
                  "15": "15분",
                  "30": "30분",
                  "60": "60분",
                }}
              />
              {mode === "manual" && (
                <Field
                  name="start"
                  label="질문을 보낸 시각 · 한국 시간"
                  type="datetime-local"
                  required
                />
              )}
            </Grid>
            <Box mt="4">
              <Multiline
                name="seed"
                label="질문 원문"
                value={text(pending?.seed)}
                rows={4}
              />
            </Box>
          </fieldset>
          <Button
            type="submit"
            mt="4"
            loading={state.busy}
            disabled={
              !runtime.writesEnabled ||
              (mode === "send" && (!data.connected || !!pendingError))
            }
          >
            {mode === "send" ? "이 질문 발송·동일 요청 상태 확인" : "관찰 시작"}
          </Button>
          <Notice state={state} />
          {mode === "send" && (
            <Text as="p" size="1" color="gray" mt="3">
              결과가 불확실하면 같은 요청 ID로 상태만 확인합니다. 새 요청으로
              재발송하지 않습니다.
            </Text>
          )}
        </form>
      </Panel>
      <Panel title="반응 관찰 목록">
        <DataTable
          columns={["관찰", "방", "확인된 피드백", "상태"]}
          items={rows(data.campaigns).map((c) => [
            <Link key={text(c.id)} to={`/episode?id=${text(c.id)}`}>
              {text(c.title)}
            </Link>,
            text(c.room),
            text(c.feedback_count),
            c.active ? "관찰 중" : "종료",
          ])}
        />
      </Panel>
    </>
  );
}
export function Responses({ data }: { data: Row }) {
  const [p, set] = useSearchParams(),
    [selected, choose] = useState(
      (p.get("ids") || "").split(",").filter(Boolean),
    );
  return (
    <>
      <Panel title="비교할 질문 선택">
        <Flex direction="column" gap="3">
          {rows(data.options).map((c) => (
            <Text as="label" size="2" key={text(c.id)}>
              <Checkbox
                checked={selected.includes(text(c.id))}
                onCheckedChange={(v) =>
                  choose(
                    v
                      ? [...selected, text(c.id)].slice(0, 6)
                      : selected.filter((id) => id !== c.id),
                  )
                }
              />{" "}
              {text(c.title)} · {text(c.room)}
            </Text>
          ))}
        </Flex>
        <Button
          mt="4"
          disabled={!selected.length}
          onClick={() => set({ ids: selected.join(",") })}
        >
          선택한 질문 비교 · 최대 6개
        </Button>
      </Panel>
      <Text as="p" size="2" color="gray" mb="4">
        {text(data.note)}
      </Text>
      {rows(data.campaigns).map((c) => (
        <Panel
          key={text(c.id)}
          title={text(c.title)}
          action={
            <Button asChild variant="soft">
              <Link to={`/episode?id=${text(c.id)}`}>원문·피드백 평가</Link>
            </Button>
          }
        >
          <Text as="p" size="2">
            {text(c.seed)}
          </Text>
          <Text as="p" size="2" color="gray" mt="3">
            확인된 반응 {num(c.confirmed)}개 · 직접 표기 {num(c.labeled)}개 ·
            관찰 {num(c.duration_minutes)}분
          </Text>
          <Grid columns={{ initial: "1", sm: "2" }} gap="4" mt="4">
            <DataTable
              columns={["주제", "발언"]}
              items={Object.entries(obj(c.topics)).map(([key, n]) => [
                text(obj(data.topics)[key]),
                text(n),
              ])}
            />
            <DataTable
              columns={["반응", "발언"]}
              items={Object.entries(obj(c.stances)).map(([key, n]) => [
                labels[key as keyof typeof labels] || key,
                text(n),
              ])}
            />
          </Grid>
          {rows(c.evidence).map((m) => (
            <Box className="message" py="3" key={text(m.log_id)}>
              <Text className="message-copy">{text(m.text)}</Text>
              <Text as="p" size="1" color="gray" mt="2">
                {text(m.author)} · {time(num(m.time_ms))} · {text(m.note)}
              </Text>
            </Box>
          ))}
        </Panel>
      ))}
    </>
  );
}
