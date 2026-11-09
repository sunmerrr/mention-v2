import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { PageSaveLayout, type PageSaveSpec } from "../components/PageSave";
import { Failure, Pending } from "../components/ui";
import { routeFeature, workspaceQuery } from "../workspace-query";
import { Campaigns, Responses } from "./manage/Campaigns";
import { Episode } from "./manage/ConversationTools";
import { Briefing, Operations } from "./manage/Operations";
import { Aliases, Bookmarks, Messages, Trends } from "./manage/Records";
import { Guide, Keywords, Rooms } from "./manage/Settings";

const pages = {
  keywords: {
    title: "키워드 관리",
    description: "포함·제외 규칙과 대상별 하위 키워드를 관리합니다.",
    Component: Keywords,
  },
  rooms: {
    title: "수집 대상",
    description: "분석에 포함하거나 제외할 방을 선택합니다.",
    Component: Rooms,
  },
  guide: {
    title: "카톡 가이드 관리",
    description: "방별 응답 이름과 전용 수집·응답 규칙을 관리합니다.",
    Component: Guide,
  },
  messages: {
    title: "메시지 기록",
    description: "저장한 메시지와 사진을 검색하고 내려받습니다.",
    Component: Messages,
  },
  trends: {
    title: "동향 분석",
    description: "기간별 언급·여론과 원문 근거를 비교합니다.",
    Component: Trends,
  },
  campaigns: {
    title: "반응 관찰",
    description: "질문을 중심으로 이어지는 피드백을 확인합니다.",
    Component: Campaigns,
  },
  responses: {
    title: "반응 비교",
    description: "확인된 피드백의 주제와 여론을 질문별로 비교합니다.",
    Component: Responses,
  },
  briefing: {
    title: "일일 브리핑",
    description: "날짜별 요약과 근거, 저장본과 발송 결과를 확인합니다.",
    Component: Briefing,
  },
  bookmarks: {
    title: "중요 대화",
    description: "보관한 대화의 담당자와 후속 처리 상태를 관리합니다.",
    Component: Bookmarks,
  },
  aliases: {
    title: "새 별칭 후보",
    description: "저장된 메시지에서 찾은 표현을 검토합니다.",
    Component: Aliases,
  },
  operations: {
    title: "수집·백업",
    description: "연결과 수집 공백, 복구 근거와 백업을 확인합니다.",
    Component: Operations,
  },
  episode: {
    title: "대화·관찰 상세",
    description: "원문과 앞뒤 맥락을 확인하고 관련성과 여론을 평가합니다.",
    Component: Episode,
  },
};
export default function Workspace() {
  const { pathname, search } = useLocation(),
    feature = routeFeature(pathname) || "messages";
  const query = useQuery({
    ...workspaceQuery(feature, search),
    refetchInterval: () => {
      if (
        typeof document !== "undefined" &&
        document.activeElement?.closest("input,textarea,[role=combobox],form")
      )
        return false;
      if (feature === "rooms" || feature === "aliases") return 60000;
      if (feature === "guide") return 5000;
      if (feature === "messages" && !new URLSearchParams(search).has("before"))
        return 5000;
      if (feature === "campaigns") return 15000;
      return false;
    },
  });
  if (query.isPending) return <Pending />;
  if (query.isError)
    return <Failure error={query.error} retry={query.refetch} />;
  const page = pages[feature as keyof typeof pages],
    Component = page.Component;
  const actions: PageSaveSpec[] = [];
  if (feature === "keywords")
    actions.push({ action: "keyword-settings", label: "변경 저장" });
  if (
    feature === "guide" &&
    new URLSearchParams(search).has("room") &&
    Array.isArray(query.data.guides) &&
    query.data.guides.some(
      (g: unknown) =>
        g &&
        typeof g === "object" &&
        "room_id" in g &&
        g.room_id === new URLSearchParams(search).get("room"),
    )
  )
    actions.push({ action: "guide-settings", label: "가이드 설정 저장" });
  if (feature === "briefing")
    actions.push({
      action: "briefing-delivery-settings",
      label: "발송 설정 저장",
      localOnly: true,
    });
  if (feature === "episode") {
    actions.push(
      { action: "episode-review", label: "여론 평가 저장" },
      { action: "episode-quality", label: "분석 분류 저장" },
    );
    if (query.data.kind === "mention")
      actions.push({ action: "mention-correction", label: "키워드 판정 저장" });
  }
  return (
    <PageSaveLayout
      key={`${feature}:${feature === "guide" ? search : ""}`}
      title={page.title}
      description={page.description}
      actions={actions}
    >
      <Component
        key={`${feature}:${feature === "guide" ? search : ""}`}
        data={query.data}
      />
    </PageSaveLayout>
  );
}
