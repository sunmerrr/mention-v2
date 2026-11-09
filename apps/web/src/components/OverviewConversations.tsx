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
  Card,
  Flex,
  Grid,
  Heading,
  Text,
} from "../design-system";
import { relatedHref, useMenuOrigin } from "../navigation";
import { Empty, OriginBadge, Sentiment, time } from "./ui";

function Excerpt({ items }: { items: ContextPreview[] }) {
  return items.length ? (
    <Box className="overview-excerpt" mt="3">
      <Text as="p" size="1" color="gray" mb="2">
        대화 발췌 · 관련성은 원문에서 확인
      </Text>
      {items.map((m) => (
        <Box key={m.id} mb="2">
          <Text size="1" weight="medium" color="gray">
            {m.own ? `${m.author} · 운영 계정` : m.author}
          </Text>
          <Text as="p" size="2" className="preview-copy">
            {m.text}
            {m.truncated ? "…" : ""}
          </Text>
        </Box>
      ))}
    </Box>
  ) : null;
}
export function OverviewConversations({
  sections,
  search,
}: {
  sections: Overview["conversationSections"];
  search: string;
}) {
  const menu = useMenuOrigin();
  const listLink = (label?: string) => {
    const params = new URLSearchParams(search);
    params.delete("nav");
    if (label) params.set("label", label);
    else params.delete("label");
    return `/conversations?${params}`;
  };
  return (
    <>
      <Card className="section-card">
        <Flex justify="between" align="center" gap="3" wrap="wrap" mb="4">
          <Box>
            <Heading as="h2" size="4">
              최신 대화
            </Heading>
            <Text as="p" size="2" color="gray" mt="1">
              저장된 마지막 대화 시각 순입니다. 미분류 대화도 포함합니다.
            </Text>
          </Box>
          <Button asChild variant="soft" size="2">
            <Link to={listLink()}>
              전체 대화 보기 <ArrowRight size={14} />
            </Link>
          </Button>
        </Flex>
        <Grid columns={{ initial: "1", md: "2" }} gap="3">
          {sections.latest.map((item) => (
            <Card key={item.id}>
              <Flex gap="2" wrap="wrap" mb="2">
                {item.targets.map((target) => (
                  <Badge color="gray" key={target}>
                    {target}
                  </Badge>
                ))}
                <Text size="1" color="gray">
                  {time(item.at)}
                </Text>
              </Flex>
              <Link
                className="conversation-link"
                to={relatedHref(`/conversations/${item.id}${search}`, menu)}
              >
                <Text as="p" size="3" weight="medium" className="preview-copy">
                  {item.title}
                </Text>
              </Link>
              {item.opinions.length ? (
                <Box mt="3">
                  <Text as="p" size="1" color="gray" mb="2">
                    맥락에서 읽은 의견
                  </Text>
                  {item.opinions.map((opinion) => (
                    <Box mb="3" key={opinion.target}>
                      <Flex gap="2" align="center" wrap="wrap" mb="1">
                        <Text size="1" weight="medium">
                          {opinion.target}
                        </Text>
                        <Sentiment label={opinion.label} />
                        <OriginBadge origin={opinion.origin} />
                      </Flex>
                      <Text as="p" size="2">
                        {opinion.summary}
                      </Text>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Text as="p" size="2" color="gray" mt="3">
                  맥락 요약 대기 · 아래 발언만으로 여론을 단정하지 않습니다.
                </Text>
              )}
              <Excerpt items={item.contextPreview} />
              <Text as="p" size="1" color="gray" mt="2">
                {item.room} · 저장 메시지 {item.messageCount}개
              </Text>
            </Card>
          ))}
        </Grid>
        {!sections.latest.length && (
          <Empty>
            선택한 기간·대상에서 표시할 대화 맥락이 아직 없습니다. 전체 대화에서
            확인해 주세요.
          </Empty>
        )}
      </Card>
      <Grid columns={{ initial: "1", lg: "2" }} gap="4">
        {(["positive", "negative"] as const).map((label) => (
          <Card className="section-card" key={label}>
            <Flex justify="between" align="center" gap="3" wrap="wrap" mb="4">
              <Heading as="h2" size="4">
                {label === "positive" ? "긍정 반응의 맥락" : "부정 반응의 맥락"}
              </Heading>
              <Button asChild variant="ghost" size="1">
                <Link to={listLink(label)}>
                  더 보기 <ArrowRight size={13} />
                </Link>
              </Button>
            </Flex>
            <Text as="p" size="2" color="gray" mb="4">
              확정 평가와 요약이 있는 사례입니다. 전체 여론의 비율이나 대표성을
              뜻하지 않습니다.
            </Text>
            <Flex direction="column" gap="3">
              {sections[label].map((item) => (
                <Card key={`${item.id}:${item.target}`}>
                  <Flex gap="2" align="center" wrap="wrap" mb="2">
                    <Badge color="gray">{item.target}</Badge>
                    <Sentiment label={label} />
                    <OriginBadge origin={item.origin} />
                  </Flex>
                  <Link
                    className="conversation-link"
                    to={relatedHref(`/conversations/${item.id}${search}`, menu)}
                  >
                    <Text as="p" size="3" weight="medium">
                      {item.summary}
                    </Text>
                  </Link>
                  <Excerpt items={item.contextPreview} />
                  <Text as="p" size="1" color="gray" mt="2">
                    {time(item.at)} · {item.room} · 저장 메시지{" "}
                    {item.messageCount}개
                  </Text>
                </Card>
              ))}
            </Flex>
            {!sections[label].length && (
              <Empty>
                선택한 기간·대상에 맥락 요약을 표시할 수 있는 확정{" "}
                {label === "positive" ? "긍정" : "부정"} 사례가 없습니다.
                미분류·판단 보류·혼합 평가는 이 목록에 포함하지 않습니다.
              </Empty>
            )}
          </Card>
        ))}
      </Grid>
    </>
  );
}
