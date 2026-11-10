import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  ContextPreview,
  Overview,
} from "../../../../packages/domain/src/model";
import {
  Badge,
  Box,
  Button,
  Disclosure,
  Flex,
  Grid,
  Section,
  Text,
} from "../design-system";
import { relatedHref, useMenuOrigin } from "../navigation";
import { Empty, OriginBadge, Sentiment, time } from "./ui";

function Excerpt({ items }: { items: ContextPreview[] }) {
  if (!items.length) return null;
  return (
    <Disclosure title={`대화 발췌 보기 · ${items.length}개`}>
      <Box className="overview-excerpt">
        <Text as="p" size="1" color="gray" mb="3">
          저장된 발언 일부입니다. 관련성은 전체 맥락에서 확인하세요.
        </Text>
        {items.map((message) => (
          <Box key={message.id} mb="3">
            <Text size="1" weight="medium" color="gray">
              {message.own ? `${message.author} · 운영 계정` : message.author}
            </Text>
            <Text as="p" size="2" className="preview-copy" mt="1">
              {message.text}
              {message.truncated ? "…" : ""}
            </Text>
          </Box>
        ))}
      </Box>
    </Disclosure>
  );
}
function Metadata({
  room,
  at,
  count,
}: {
  room: string;
  at: number;
  count: number;
}) {
  return (
    <Flex
      gap="2"
      wrap="wrap"
      align="center"
      mt="3"
      className="overview-conversation-meta"
    >
      <Text size="1" color="gray" className="overview-room">
        {room}
      </Text>
      <Text size="1" color="gray">
        {time(at)} · 메시지 {count}개
      </Text>
    </Flex>
  );
}
export function OverviewConversations({
  sections,
  search,
}: {
  sections: Overview["conversationSections"];
  search: string;
}) {
  const menu = useMenuOrigin();
  function listLink(label?: string) {
    const params = new URLSearchParams(search);
    params.delete("nav");
    if (label) params.set("label", label);
    else params.delete("label");
    return `/conversations?${params}`;
  }
  return (
    <>
      <Section
        title="최신 대화"
        description="저장된 마지막 대화 시각 순 · 분류 전 대화 포함"
        actions={
          <Button asChild intent="secondary" size="1">
            <Link to={listLink()}>
              전체 대화 보기 <ArrowRight size={14} />
            </Link>
          </Button>
        }
      >
        <div className="overview-conversation-list">
          {sections.latest.map((item) => (
            <article key={item.id} className="overview-conversation-row">
              <Flex gap="2" wrap="wrap" align="center" mb="2">
                {item.targets.map((target) => (
                  <Badge color="gray" key={target}>
                    {target}
                  </Badge>
                ))}
                {!item.opinions.length && (
                  <Text size="1" color="gray">
                    {item.judgmentExcluded ? "판단 제외" : "요약 대기"}
                  </Text>
                )}
              </Flex>
              <Link
                className="conversation-link overview-conversation-title"
                to={relatedHref(`/conversations/${item.id}${search}`, menu)}
              >
                <Text as="p" size="3" weight="medium" className="preview-copy">
                  {item.title}
                </Text>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              {item.opinions.map((opinion) => (
                <Box mt="3" key={opinion.target}>
                  <Flex gap="2" align="center" wrap="wrap" mb="1">
                    <Text size="1" weight="medium">
                      {opinion.target}
                    </Text>
                    <Sentiment label={opinion.label} />
                    <OriginBadge origin={opinion.origin} />
                  </Flex>
                  <Text as="p" size="2" className="overview-opinion-summary">
                    {opinion.summary}
                  </Text>
                </Box>
              ))}
              <Metadata
                room={item.room}
                at={item.at}
                count={item.messageCount}
              />
              <Excerpt items={item.contextPreview} />
            </article>
          ))}
        </div>
        {!sections.latest.length && (
          <Empty>선택한 기간·대상에 표시할 대화가 없습니다.</Empty>
        )}
      </Section>
      <Grid columns={{ initial: "1", lg: "2" }} gap="4" align="start">
        {(["positive", "negative"] as const).map((label) => (
          <Section
            key={label}
            title={
              label === "positive" ? "긍정 반응의 맥락" : "부정 반응의 맥락"
            }
            description="현재 유효한 분류와 요약이 있는 사례"
            actions={
              <Button asChild intent="quiet" size="1">
                <Link to={listLink(label)}>
                  더 보기 <ArrowRight size={13} />
                </Link>
              </Button>
            }
          >
            <div className="overview-conversation-list">
              {sections[label].map((item) => (
                <article
                  key={`${item.id}:${item.target}`}
                  className="overview-conversation-row"
                >
                  <Flex gap="2" align="center" wrap="wrap" mb="2">
                    <Badge color="gray">{item.target}</Badge>
                    <Sentiment label={label} />
                    <OriginBadge origin={item.origin} />
                  </Flex>
                  <Link
                    className="conversation-link overview-conversation-title"
                    to={relatedHref(`/conversations/${item.id}${search}`, menu)}
                  >
                    <Text
                      as="p"
                      size="2"
                      weight="medium"
                      className="overview-opinion-summary"
                    >
                      {item.summary}
                    </Text>
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                  <Metadata
                    room={item.room}
                    at={item.at}
                    count={item.messageCount}
                  />
                  <Excerpt items={item.contextPreview} />
                </article>
              ))}
            </div>
            {!sections[label].length && (
              <Empty>
                표시할 확정 {label === "positive" ? "긍정" : "부정"} 사례가
                없습니다.
              </Empty>
            )}
          </Section>
        ))}
      </Grid>
      <Text as="p" size="1" color="gray" mb="5">
        확정 사례는 전체 여론의 비율이나 대표성을 뜻하지 않습니다.
        미분류·재검토·판단 보류·혼합은 긍정·부정 목록에서 제외합니다.
      </Text>
    </>
  );
}
