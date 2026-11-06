import {
  Badge,
  Box,
  Button,
  Callout,
  Flex,
  Heading,
  Separator,
  Text,
  Theme,
} from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCheck, MessagesSquare, RefreshCw } from "lucide-react";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Failure, Pending } from "./components/ui";
import { api } from "./queries";
import { useRuntime } from "./runtime";

const imports = {
  overview: () => import("./pages/Overview"),
  conversations: () => import("./pages/Conversations"),
  reviews: () => import("./pages/Reviews"),
  detail: () => import("./pages/Detail"),
};
const Overview = lazy(imports.overview),
  Conversations = lazy(imports.conversations),
  Reviews = lazy(imports.reviews),
  Detail = lazy(imports.detail);
export async function preloadRoute(path: string) {
  if (path.startsWith("/conversations/")) await imports.detail();
  else if (path === "/reviews") await imports.reviews();
  else if (path === "/conversations") await imports.conversations();
  else await imports.overview();
}
const links = [
  { path: "/", label: "여론·동향", Icon: BarChart3 },
  { path: "/conversations", label: "대화 목록", Icon: MessagesSquare },
  { path: "/reviews", label: "분류 검토", Icon: CheckCheck },
];
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
    location = useLocation();
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
          <nav aria-label="주 메뉴">
            {links.map(({ path, label, Icon }) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
              >
                <Icon size={17} />
                {label}
              </NavLink>
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
              1차 구현 · 운영 화면과 분리
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
                {writesEnabled ? "수정 가능" : "조회 전용 미리보기"}
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
