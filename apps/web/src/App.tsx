import {
  Badge,
  Box,
  Button,
  Callout,
  Flex,
  Heading,
  Select,
  Separator,
  Text,
  Theme,
} from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Failure, Pending } from "./components/ui";
import { api } from "./queries";
import { useRuntime } from "./runtime";
import { routeFeature } from "./workspace-query";

const imports = {
  overview: () => import("./pages/Overview"),
  conversations: () => import("./pages/Conversations"),
  reviews: () => import("./pages/Reviews"),
  detail: () => import("./pages/Detail"),
  workspace: () => import("./pages/Workspace"),
};
const Overview = lazy(imports.overview),
  Conversations = lazy(imports.conversations),
  Reviews = lazy(imports.reviews),
  Detail = lazy(imports.detail),
  Workspace = lazy(imports.workspace);
export async function preloadRoute(path: string) {
  if (routeFeature(path)) await imports.workspace();
  else if (path.startsWith("/conversations/")) await imports.detail();
  else if (path === "/reviews") await imports.reviews();
  else if (path === "/conversations") await imports.conversations();
  else await imports.overview();
}
const navGroups = [
  {
    label: "분석·브리핑",
    links: [
      ["/", "여론·동향"],
      ["/trends", "동향 분석"],
      ["/briefing", "일일 브리핑"],
    ],
  },
  {
    label: "대화·반응",
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
    links: [
      ["/keywords", "키워드 관리"],
      ["/aliases", "새 별칭 후보"],
      ["/rooms", "수집 대상"],
      ["/guide", "카톡 가이드 관리"],
      ["/operations", "수집·백업"],
    ],
  },
];
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
    navigate = useNavigate();
  return (
    <Theme
      accentColor="iris"
      grayColor="slate"
      radius="medium"
      scaling="100%"
      panelBackground="solid"
    >
      <div className="workspace">
        <aside className="sidebar">
          <Link to="/" className="brand">
            <span className="brand-mark">m</span>
            <Heading size="5">Mention</Heading>
            <Badge size="1" variant="soft" color="gray">
              새 버전
            </Badge>
          </Link>
          <Text size="1" color="gray" className="nav-caption">
            WORKSPACE
          </Text>
          <Box className="mobile-navigation">
            <Select.Root
              value={
                navGroups
                  .flatMap((g) => g.links)
                  .some(([path]) => path === location.pathname)
                  ? location.pathname
                  : "/conversations"
              }
              onValueChange={navigate}
            >
              <Select.Trigger
                aria-label="페이지 이동"
                style={{ width: "100%" }}
              />
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
              <div className="nav-section" key={group.label}>
                <Text
                  as="p"
                  size="1"
                  color="gray"
                  className="nav-section-label"
                >
                  {group.label}
                </Text>
                {group.links.map(([path, label]) => (
                  <NavLink
                    key={path}
                    to={path}
                    end={path === "/"}
                    className={({ isActive }) =>
                      `nav-item ${isActive ? "active" : ""}`
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
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
    </Theme>
  );
}
