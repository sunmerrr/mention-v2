import { useQuery } from "@tanstack/react-query";
import { labels } from "../../components/ui";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Grid,
  Text,
} from "../../design-system";
import { workspaceQuery } from "../../workspace-query";
import {
  Action,
  ActionForm,
  DataTable,
  Field,
  FilterForm,
  num,
  obj,
  Paging,
  Panel,
  type Row,
  rows,
  SourceLink,
  text,
} from "./shared";
export function Operations({ data }: { data: Row }) {
  const coverage = obj(data.coverage),
    backup = obj(data.backup),
    health = obj(data.health),
    counts = obj(coverage.counts);
  return (
    <>
      <Grid columns={{ initial: "1", sm: "3" }} gap="4" mb="5">
        <Panel title="수집 상태">
          <Badge color={health.state === "monitoring" ? "jade" : "amber"}>
            {text(health.label) || text(health.state)}
          </Badge>
          <Text as="p" size="2" mt="3">
            {text(health.reason)}
          </Text>
          <Text as="p" size="1" color="gray" mt="2">
            {text(health.action)}
          </Text>
        </Panel>
        <Panel title="열린 수집 공백">
          <Text size="7" weight="bold">
            {num(counts.open)}
          </Text>
        </Panel>
        <Panel title="확인할 복구 구간">
          <Text size="7" weight="bold">
            {num(counts.partial) + num(counts.legacy)}
          </Text>
        </Panel>
      </Grid>
      <Panel title="수집 공백 기록">
        <Text as="p" size="2" color="gray" mb="4">
          {text(coverage.note)}
        </Text>
        <DataTable
          columns={["방", "시작", "종료", "상태", "근거"]}
          items={rows(coverage.intervals).map((r) => [
            text(r.room),
            text(r.start_at),
            text(r.end_at) || "진행 중",
            (
              {
                open: "공백 진행",
                partial: "일부 미확인",
                recovered: "범위 복구 확인",
                legacy: "과거 경고",
              } as Record<string, string>
            )[text(r.status)] || text(r.status),
            `${text(r.reason)} · ${text(r.certainty)}`,
          ])}
        />
        <Paging data={coverage} />
      </Panel>
      <Panel title="최근 이력 복구 시도">
        <DataTable
          columns={["방", "조회 시각", "이전 지점 도달", "조회 기록"]}
          items={rows(coverage.recoveries).map((r) => [
            text(r.room),
            text(r.at),
            r.reached ? "확인" : "미확인",
            text(r.records),
          ])}
        />
      </Panel>
      <Panel
        title="백업과 복구 검증"
        action={
          <Action action="backup-create" input={{}} localOnly>
            지금 백업
          </Action>
        }
      >
        <Text as="p" size="2" mb="2">
          {text(backup.policy)}
        </Text>
        <Text as="p" size="2" color="gray" mb="4">
          {text(backup.scope)}
        </Text>
        {!!backup.busy && <Badge color="amber">백업 작업 진행 중</Badge>}
        {!!backup.error && <Text color="red">{text(backup.error)}</Text>}
        <DataTable
          columns={["백업", "크기", "복구 검증", "작업"]}
          items={rows(backup.backups).map((b) => [
            text(b.created_at),
            `${(num(b.bytes) / 1024 / 1024).toFixed(1)} MB`,
            text(b.restore_tested_at) || "아직 확인 안 함",
            <Action
              key={text(b.id)}
              action="backup-verify"
              input={{ id: b.id }}
              localOnly
            >
              사본 복구 검증
            </Action>,
          ])}
        />
        <Text as="p" size="1" color="gray" mt="4">
          복구 검증은 별도 임시 사본에서 실행합니다. 운영 DB를 덮어쓰거나
          수집기를 재시작하지 않습니다.
        </Text>
      </Panel>
    </>
  );
}
export function Briefing({ data }: { data: Row }) {
  const report = obj(data.report),
    day = text(report.day),
    delivery = useQuery(workspaceQuery("delivery", "")),
    s = delivery.data || {};
  return (
    <>
      <FilterForm>
        <Field name="day" label="브리핑 날짜" type="date" value={day} />
      </FilterForm>
      <Panel
        title={`${day} 일일 브리핑`}
        action={
          <Flex gap="3">
            <Action action="briefing-refresh" input={{ day }}>
              현재 데이터로 갱신·저장
            </Action>
            {!!data.image_available && (
              <Button asChild variant="soft">
                <a href={`/download/briefing-${day}.png`}>
                  한 장 이미지 다운로드
                </a>
              </Button>
            )}
          </Flex>
        }
      >
        <Text as="p" size="2" color="gray">
          {data.saved ? `저장본 v${text(data.revision)}` : "미저장 미리보기"}
          {data.stale ? " · 새 데이터가 있어 갱신이 필요합니다." : ""}
        </Text>
        <Grid columns={{ initial: "1", sm: "3" }} gap="4" mt="4">
          <Text>연결된 대화 {num(report.conversations)}개</Text>
          <Text>분류 반영 {num(report.reviewed)}개</Text>
          <Text>확인할 중요 대화 {num(report.open_bookmarks)}개</Text>
        </Grid>
      </Panel>
      {rows(report.targets)
        .filter((t) => t.mentions || t.conversations)
        .map((t) => (
          <Panel key={text(t.target)} title={text(t.target)}>
            <Text as="p" size="2">
              언급 {num(t.mentions)}건 · 전일 대비 {text(t.delta)} · 분류{" "}
              {num(t.reviewed)}/{num(t.conversations)}
            </Text>
            <Text as="p" size="2" color="gray" mt="2">
              {Object.entries(labels)
                .filter(([k]) => k !== "unreviewed")
                .map(([k, l]) => `${l} ${num(t[k])}`)
                .join(" · ")}
            </Text>
            {rows(t.evidence).map((e, _i) => (
              <Box key={text(e.id)} mt="3">
                <SourceLink item={e}>
                  {text(e.summary) || text(e.text)}
                </SourceLink>
                <Text size="1" color="gray">
                  {text(e.room)}
                </Text>
              </Box>
            ))}
          </Panel>
        ))}
      <Panel title="브리핑 범위와 이력">
        <Text as="p" size="2" color="gray">
          {text(report.note)}
        </Text>
        <DataTable
          columns={["버전", "저장 시각"]}
          items={rows(data.history).map((h) => [
            text(h.revision),
            text(h.created_at),
          ])}
        />
      </Panel>
      <Panel title="개인톡 브리핑 발송">
        <Text as="p" size="2" mb="4">
          {s.recipient_verified ? "수신자 확인됨" : "수신자 확인 대기"} ·{" "}
          {s.enabled
            ? `매일 ${text(s.hour)}:${String(s.minute).padStart(2, "0")}`
            : "자동 발송 꺼짐"}
        </Text>
        <ActionForm
          action="briefing-delivery-settings"
          localOnly
          build={(f) => {
            const [hour, minute] = String(f.get("time")).split(":").map(Number);
            return { enabled: f.get("enabled") === "on", hour, minute };
          }}
        >
          <Flex gap="4" align="center">
            <Text as="label" size="2">
              <Checkbox name="enabled" defaultChecked={!!s.enabled} /> 매일 전날
              브리핑 보내기
            </Text>
            <Field
              name="time"
              label="발송 시각"
              type="time"
              value={`${String(s.hour ?? 9).padStart(2, "0")}:${String(s.minute ?? 0).padStart(2, "0")}`}
            />
          </Flex>
        </ActionForm>
        <Flex gap="3" wrap="wrap" mt="4">
          <Action action="briefing-recipient" input={{}} localOnly>
            수신자 확인
          </Action>
          <Action
            action="briefing-send"
            input={{ day, format: "image" }}
            localOnly
          >
            현재 날짜 요약 이미지 보내기
          </Action>
          <Action
            action="briefing-send"
            input={{ day, format: "text" }}
            localOnly
          >
            현재 날짜 텍스트 보내기
          </Action>
        </Flex>
        <Text as="p" size="1" color="gray" mt="3">
          실제 발송은 로컬에서만 가능합니다. 기존 영수증이 있는 날짜는 중복
          발송하지 않습니다.
        </Text>
        <DataTable
          columns={["날짜", "상태", "시각"]}
          items={rows(s.history).map((h) => [
            text(h.day),
            text(h.state),
            text(h.updated_at),
          ])}
        />
      </Panel>
    </>
  );
}
