import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Classification } from "../../../../packages/contracts/src/api";
import { CorrectionDialog } from "../components/CorrectionDialog";
import { EvaluationStatus, Failure, Pending, time } from "../components/ui";
import {
  Badge,
  Box,
  Button,
  Card,
  DetailLayout,
  Disclosure,
  Flex,
  Heading,
  PageHeader,
  Section,
  Text,
} from "../design-system";
import { relatedHref, useMenuOrigin } from "../navigation";
import { api, detailQuery } from "../queries";
import {
  BookmarkSource,
  ContextExpandButton,
  Relevance,
  UndoReview,
  useContextExpansion,
} from "./manage/ConversationTools";
import { Highlight } from "./manage/Records";
export default function Detail() {
  const menu = useMenuOrigin();
  const { id = "" } = useParams(),
    navigate = useNavigate(),
    query = useQuery(detailQuery(id));
  const classifications = useQuery({
    queryKey: ["classifications", "conversation", id],
    queryFn: () =>
      api<Classification[]>(
        `/api/conversations/${encodeURIComponent(id)}/classifications`,
      ),
  });
  const expansion = useContextExpansion(id, true);
  const [undoIds, setUndoIds] = useState<unknown[]>([]);
  if (query.isPending) return <Pending />;
  if (query.isError)
    return <Failure error={query.error} retry={query.refetch} />;
  const { conversation: c, messages, limited, before, after } = query.data;
  return (
    <>
      <PageHeader
        title="대화 맥락"
        description={`${c.room} · ${time(c.at)}`}
        actions={
          <Flex gap="3" align="center">
            <Button intent="quiet" asChild>
              <a href="#conversation-reactions">반응·분류</a>
            </Button>
            <Button
              intent="secondary"
              onClick={() =>
                window.history.state?.idx > 0 ? navigate(-1) : navigate(menu)
              }
            >
              <ArrowLeft size={14} />
              목록으로
            </Button>
          </Flex>
        }
      />
      {classifications.isError && (
        <Failure
          error={classifications.error}
          retry={classifications.refetch}
        />
      )}
      <UndoReview ids={undoIds} onDone={() => setUndoIds([])} />
      <DetailLayout
        stickyAside
        content={
          <Card className="section-card">
            <Flex align="center" gap="2" mb="4">
              <MessagesSquare size={16} />
              <Heading as="h2" size="4">
                전체 대화
              </Heading>
              <Badge color="gray">{messages.length}개</Badge>
            </Flex>
            <Text as="p" size="1" color="gray" mb="3">
              이전 맥락 {before}개 · 이후 맥락 {after}개
              {limited ? " · 일부 맥락 미확보" : ""}
            </Text>
            <ContextExpandButton controller={expansion} direction="before" />
            {messages.map((m, index) => {
              const boundary =
                index === 0 || messages[index - 1].phase !== m.phase;
              const content = (
                <>
                  <Flex gap="3" align="center">
                    <Text weight="medium" size="2">
                      {m.own ? "나" : m.author}
                    </Text>
                    <Text size="1" color="gray">
                      {time(m.time)}
                    </Text>
                  </Flex>
                  <Text as="p" size="2" className="message-copy" mt="2">
                    <Highlight
                      value={m.text || "본문이 없는 첨부 메시지"}
                      keywords={Object.keys(c.keywords)}
                    />
                  </Text>
                  <Flex gap="3" wrap="wrap" mt="3">
                    {m.photos?.map((photo) => (
                      <a
                        href={photo.url}
                        key={photo.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          className="chat-photo"
                          src={photo.thumbnail || photo.url}
                          alt="저장된 첨부 이미지"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </Flex>
                  {!m.anchor && (
                    <Relevance
                      id={id}
                      logId={m.id}
                      conversation
                      onReview={setUndoIds}
                    />
                  )}
                </>
              );
              return (
                <Box key={m.id}>
                  {boundary && (
                    <Text
                      as="p"
                      size="1"
                      color="gray"
                      className="phase-divider"
                    >
                      {(
                        {
                          before: "이전 맥락",
                          discussion: "키워드가 나온 구간",
                          after: "이후 맥락",
                        } as Record<string, string>
                      )[m.phase] || "대화"}
                    </Text>
                  )}
                  {m.background ? (
                    <details className="background-message">
                      <summary>
                        사진·링크·홍보 추정 자료 · {time(m.time)}
                      </summary>
                      <Box py="3">{content}</Box>
                    </details>
                  ) : (
                    <Box className="message" py="4">
                      {content}
                    </Box>
                  )}
                </Box>
              );
            })}
            <ContextExpandButton controller={expansion} direction="after" />
          </Card>
        }
        aside={
          <div id="conversation-reactions" className="conversation-reactions">
            <Section
              title="대상별 반응"
              description="대화 맥락을 기준으로 분류합니다"
            >
              {Object.entries(c.evaluations).map(([name, e]) => {
                const classification = classifications.data?.find(
                  (item) => item.target === name,
                );
                return (
                  <div key={name} className="classification-row">
                    <Flex
                      direction="column"
                      gap="2"
                      className="classification-target"
                    >
                      <Text weight="bold" size="2">
                        {name}
                      </Text>
                      <EvaluationStatus evaluation={e} />
                    </Flex>
                    <Text as="p" size="2" className="classification-summary">
                      {e.summary || "아직 분류 메모가 없습니다."}
                    </Text>
                    <div className="classification-action">
                      {classification ? (
                        <CorrectionDialog item={classification} prominent />
                      ) : (
                        <Button
                          size="2"
                          variant="outline"
                          disabled
                          loading={classifications.isPending}
                        >
                          {classifications.isError
                            ? "분류 로드 실패"
                            : "분류 수정"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </Section>
            <Disclosure title="보관·담당자·메모">
              <BookmarkSource id={id} kind="conversation" embedded />
            </Disclosure>
            <Disclosure title="포함된 언급 대화">
              <Flex direction="column" gap="3">
                {query.data.episodes?.map((e) => (
                  <Link
                    key={e.id}
                    to={relatedHref(`/episode?id=${e.id}`, menu)}
                  >
                    {e.title}
                  </Link>
                ))}
              </Flex>
            </Disclosure>
          </div>
        }
      />
    </>
  );
}
