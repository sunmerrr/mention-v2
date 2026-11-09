import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronDown,
  MessagesSquare,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Failure, Pending } from "./components/ui";
import {
  Badge,
  Box,
  Button,
  Callout,
  DesignSystemProvider,
  Flex,
  Select,
  Separator,
  Text,
} from "./design-system";
import { useMenuOrigin } from "./navigation";
import { api } from "./queries";
import { useRuntime } from "./runtime";
import { routeFeature } from "./workspace-query";

const imports = {
  designSystem: () => import("./design-system/Catalog"),
  overview: () => import("./pages/Overview"),
  conversations: () => import("./pages/Conversations"),
  reviews: () => import("./pages/Reviews"),
  detail: () => import("./pages/Detail"),
  workspace: () => import("./pages/Workspace"),
};
const DesignSystemCatalog = lazy(imports.designSystem),
  Overview = lazy(imports.overview),
  Conversations = lazy(imports.conversations),
  Reviews = lazy(imports.reviews),
  Detail = lazy(imports.detail),
  Workspace = lazy(imports.workspace);
export async function preloadRoute(path: string) {
  if (path === "/design-system") await imports.designSystem();
  else if (routeFeature(path)) await imports.workspace();
  else if (path.startsWith("/conversations/")) await imports.detail();
  else if (path === "/reviews") await imports.reviews();
  else if (path === "/conversations") await imports.conversations();
  else await imports.overview();
}
const navGroups = [
  {
    label: "분석·브리핑",
    Icon: BarChart3,
    links: [
      ["/", "여론·동향"],
      ["/trends", "동향 분석"],
      ["/briefing", "일일 브리핑"],
    ],
  },
  {
    label: "대화·반응",
    Icon: MessagesSquare,
    links: [
      ["/conversations", "대화 목록"],
      ["/reviews", "분류 검토"],
      ["/bookmarks", "중요 대화"],
      ["/campaigns", "반응 관찰"],
      ["/responses", "반응 비교"],
      ["/messages", "메시지 기록"],
    ],
  },
  {
    label: "관리",
    Icon: Settings2,
    links: [
      ["/keywords", "키워드 관리"],
      ["/aliases", "새 별칭 후보"],
      ["/rooms", "수집 대상"],
      ["/guide", "카톡 가이드 관리"],
      ["/operations", "수집·백업"],
      ["/design-system", "디자인 시스템"],
    ],
  },
];
function NavigationGroup({ group }: { group: (typeof navGroups)[number] }) {
  const pathname = useMenuOrigin();
  const active =
    group.links.some(([path]) =>
      path === "/"
        ? pathname === "/"
        : pathname === path || pathname.startsWith(`${path}/`),
    ) ||
    (pathname === "/episode" && group.label === "대화·반응");
  const [open, setOpen] = useState(active);
  const activePath = active ? pathname : null;
  useEffect(() => {
    if (activePath !== null) setOpen(true);
  }, [activePath]);
  const Icon = group.Icon;
  return (
    <details
      className={`nav-section ${active ? "has-active-page" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={`${group.label} 메뉴`}>
        <Icon size={16} aria-hidden="true" />
        <span>{group.label}</span>
        <ChevronDown
          size={15}
          className="nav-section-chevron"
          aria-hidden="true"
        />
      </summary>
      <div className="nav-section-links">
        {group.links.map(([path, label]) => (
          <Link
            key={path}
            to={path}
            aria-current={pathname === path ? "page" : undefined}
            className={`nav-item ${pathname === path ? "active" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </details>
  );
}
function PreviousConversation() {
  const { search } = useLocation();
  const id = new URLSearchParams(search).get("id");
  return (
    <Navigate
      replace
      to={id ? `/conversations/${encodeURIComponent(id)}` : "/conversations"}
    />
  );
}
function Refresh() {
  const client = useQueryClient();
  return (
    <Button
      size="1"
      color="gray"
      variant="ghost"
      onClick={async () => {
        await api("/api/refresh", {});
        await client.invalidateQueries();
      }}
    >
      <RefreshCw size={13} />
      최신 데이터
    </Button>
  );
}
export function App() {
  const { writesEnabled } = useRuntime(),
    location = useLocation(),
    navigate = useNavigate(),
    menu = useMenuOrigin();
  return (
    <DesignSystemProvider>
      <div className="workspace">
        <aside className="sidebar">
          <Link to="/" className="brand" aria-label="Mention 홈">
            <img
              className="brand-mark"
              src="/brand.svg"
              alt=""
              width="34"
              height="34"
            />
            <span className="brand-name">Mention</span>
          </Link>
          <Text size="1" color="gray" className="nav-caption">
            WORKSPACE
          </Text>
          <Box className="mobile-navigation">
            <Select.Root value={menu} onValueChange={navigate}>
              <Select.Trigger
                aria-label="페이지 이동"
                style={{ width: "100%" }}
              >
                {
                  navGroups
                    .flatMap((group) => group.links)
                    .find(([path]) => path === menu)?.[1]
                }
              </Select.Trigger>
              <Select.Content>
                {navGroups.map((group) => (
                  <Select.Group key={group.label}>
                    <Select.Label>{group.label}</Select.Label>
                    {group.links.map(([path, label]) => (
                      <Select.Item key={path} value={path}>
                        {label}
                      </Select.Item>
                    ))}
                  </Select.Group>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>
          <nav aria-label="주 메뉴">
            {navGroups.map((group) => (
              <NavigationGroup key={group.label} group={group} />
            ))}
          </nav>
          <Box className="sidebar-bottom">
            <Separator size="4" mb="4" />
            <Text as="p" size="2" weight="medium">
              서비스의 이야기를 한곳에서
            </Text>
            <Text as="p" size="1" color="gray" mt="1">
              맥락을 읽고, 반응을 이해하세요.
            </Text>
            <Text as="p" size="1" color="gray" mt="4">
              기존 수집기 연결 유지
            </Text>
          </Box>
        </aside>
        <main className="main">
          <Flex
            justify="between"
            align="center"
            mb="6"
            className="workspace-bar"
          >
            <Text size="1" color="gray">
              Mention / 분석 워크스페이스
            </Text>
            <Flex align="center" gap="4">
              <Badge color={writesEnabled ? "jade" : "gray"} variant="soft">
                {writesEnabled ? "수정 가능" : "조회 전용"}
              </Badge>
              <Refresh />
            </Flex>
          </Flex>
          <ErrorBoundary
            key={location.pathname}
            fallbackRender={({ error, resetErrorBoundary }) => (
              <Failure error={error} retry={resetErrorBoundary} />
            )}
          >
            <Suspense fallback={<Pending />}>
              <Routes>
                <Route
                  path="/design-system"
                  element={<DesignSystemCatalog />}
                />
                <Route path="/" element={<Overview />} />
                <Route path="/conversations" element={<Conversations />} />
                <Route path="/conversations/:id" element={<Detail />} />
                <Route path="/reviews" element={<Reviews />} />
                <Route
                  path="/conversation"
                  element={<PreviousConversation />}
                />
                {Object.keys({
                  keywords: 1,
                  rooms: 1,
                  guide: 1,
                  messages: 1,
                  trends: 1,
                  campaigns: 1,
                  responses: 1,
                  briefing: 1,
                  bookmarks: 1,
                  aliases: 1,
                  operations: 1,
                  episode: 1,
                }).map((path) => (
                  <Route key={path} path={`/${path}`} element={<Workspace />} />
                ))}
                <Route
                  path="*"
                  element={
                    <Callout.Root>
                      <Callout.Text>
                        찾을 수 없는 페이지입니다.{" "}
                        <Link to="/">여론·동향으로 돌아가기</Link>
                      </Callout.Text>
                    </Callout.Root>
                  }
                />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </DesignSystemProvider>
  );
}
