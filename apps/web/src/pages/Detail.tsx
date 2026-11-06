import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Text,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Info, MessagesSquare } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Failure,
  OriginBadge,
  Pending,
  Sentiment,
  time,
} from "../components/ui";
import { detailQuery } from "../queries";
export default function Detail() {
  const { id = "" } = useParams(),
    navigate = useNavigate(),
    query = useQuery(detailQuery(id));
  if (query.isPending) return <Pending />;
  if (query.isError)
    return <Failure error={query.error} retry={query.refetch} />;
  const { conversation: c, messages, limited, before, after } = query.data;
  return (
    <>
      <Button
        variant="ghost"
        color="gray"
        mb="5"
        onClick={() =>
          window.history.state?.idx > 0
            ? navigate(-1)
            : navigate("/conversations")
        }
      >
        <ArrowLeft size={14} />
        목록으로
      </Button>
      <Box mb="5">
        <Flex gap="2" wrap="wrap" mb="3">
          {c.targets.map((t) => (
            <Badge color="gray" key={t}>
              {t}
            </Badge>
          ))}
        </Flex>
        <Heading size="6">대화 맥락</Heading>
        <Text as="p" size="2" color="gray" mt="2">
          {c.room} · {time(c.at)}
        </Text>
      </Box>
      <Flex gap="3" wrap="wrap" mb="5">
        {Object.entries(c.evaluations).map(([name, e]) => (
          <Card key={name} className="evaluation-card">
            <Flex align="center" justify="between" gap="4">
              <Text weight="medium" size="2">
                {name}
              </Text>
              <Sentiment label={e.stale ? "unreviewed" : e.label} />
            </Flex>
            <Text as="p" size="2" mt="3">
              {e.summary || "아직 분류 메모가 없습니다."}
            </Text>
            <Flex mt="3" align="center" justify="between" gap="4">
              <OriginBadge origin={e.origin} />
              <Button asChild variant="ghost" size="1">
                <Link to={`/reviews?target=${encodeURIComponent(name)}`}>
                  분류 수정
                </Link>
              </Button>
            </Flex>
          </Card>
        ))}
      </Flex>
      <Callout.Root color={limited ? "amber" : "gray"} mb="5">
        <Callout.Icon>
          <Info size={16} />
        </Callout.Icon>
        <Callout.Text>
          확보된 이전 맥락 {before}개 · 이후 맥락 {after}개.
          {limited ? " 연결되는 대화가 충분하지 않을 수 있습니다." : ""}{" "}
          사진·링크·홍보 추정 자료는 접어 표시합니다. 관련성은 별도 확인이
          필요합니다.
        </Callout.Text>
      </Callout.Root>
      <Card className="section-card">
        <Flex align="center" gap="2" mb="4">
          <MessagesSquare size={16} />
          <Heading size="4">전체 대화</Heading>
          <Badge color="gray">{messages.length}개</Badge>
        </Flex>
        {messages.map((m, index) => {
          const boundary = index === 0 || messages[index - 1].phase !== m.phase;
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
                {m.text || "본문이 없는 첨부 메시지"}
              </Text>
            </>
          );
          return (
            <Box key={m.id}>
              {boundary && (
                <Text as="p" size="1" color="gray" className="phase-divider">
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
                  <summary>사진·링크·홍보 추정 자료 · {time(m.time)}</summary>
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
      </Card>
    </>
  );
}
