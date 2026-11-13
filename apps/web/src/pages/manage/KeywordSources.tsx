import { useState } from "react";
import type {
  KeywordPolicy,
  KeywordSource,
} from "../../../../../packages/contracts/src/keyword-policy";
import {
  Box,
  Button,
  Flex,
  Select,
  Separator,
  Tabs,
  Text,
  TextField,
} from "../../design-system";
import { useRuntime } from "../../runtime";
import { KeywordSourceGroup } from "./KeywordSourceGroup";
import { type Row, rows, strings, text } from "./shared";
export function KeywordSources({
  words,
  groups,
  sources,
  onChange,
  onAdd,
  supported,
}: {
  words: string[];
  groups: Row[];
  sources: KeywordPolicy["sources"];
  onChange: (value: KeywordPolicy["sources"]) => void;
  onAdd: (word: string, target: string, source: KeywordSource | "both") => void;
  supported: boolean;
}) {
  const [tab, setTab] = useState<KeywordSource | "all">("kakao"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all");
  const [word, setWord] = useState(""),
    [target, setTarget] = useState(""),
    [destination, setDestination] = useState<KeywordSource | "both">("kakao");
  const { writesEnabled } = useRuntime();
  const editable = supported && writesEnabled;
  const owners = new Map(
    groups.flatMap((g) =>
      strings(g.keywords).map((alias) => [alias, text(g.name)] as const),
    ),
  );
  const enabled = (word: string, source: KeywordSource) =>
    !sources[source].disabled.includes(word);
  const sections = [
    ...groups.map((g) => ({
      name: text(g.name),
      words: words.filter((w) => strings(g.keywords).includes(w)),
    })),
    { name: "대상 미지정", words: words.filter((w) => !owners.has(w)) },
  ].filter((g) => {
    if (!g.words.length) return false;
    const match =
      !query ||
      `${g.name} ${g.words.join(" ")}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase());
    const active = g.words.some((w) =>
      tab === "all"
        ? enabled(w, "kakao") || enabled(w, "pokergosu")
        : enabled(w, tab),
    );
    return (
      match && (status === "all" || (status === "enabled" ? active : !active))
    );
  });
  return (
    <Box>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          setTab(value as KeywordSource | "all");
          if (value === "kakao" || value === "pokergosu") setDestination(value);
        }}
      >
        <Tabs.List aria-label="키워드 수집 출처">
          <Tabs.Trigger value="all">전체</Tabs.Trigger>
          <Tabs.Trigger value="kakao">카톡</Tabs.Trigger>
          <Tabs.Trigger value="pokergosu">포커고수</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value={tab}>
          <Flex justify="between" align="center" gap="3" wrap="wrap" my="4">
            <Text size="2" color="gray">
              {tab === "all"
                ? "공통 대상별로 적용 출처를 확인합니다."
                : `${tab === "kakao" ? "카톡" : "포커고수"}에서 수집하는 키워드입니다.`}
            </Text>
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                aria-label="출처별 키워드 검색"
                placeholder="키워드·대상 검색"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
              />
              <Select.Root
                value={status}
                onValueChange={(v) => {
                  setStatus(v);
                }}
              >
                <Select.Trigger aria-label="키워드 수집 상태" />
                <Select.Content>
                  <Select.Item value="enabled">수집 중</Select.Item>
                  <Select.Item value="disabled">사용 안 함</Select.Item>
                  <Select.Item value="all">모든 상태</Select.Item>
                </Select.Content>
              </Select.Root>
            </Flex>
          </Flex>
          {!supported && (
            <Text as="p" size="2" color="amber" mb="3">
              출처별 설정을 준비 중입니다. 기존 설정은 유지됩니다.
            </Text>
          )}
          {sections.length ? (
            sections.map((section) => (
              <KeywordSourceGroup
                key={section.name}
                name={section.name}
                aliases={section.words}
                query={query}
                tab={tab}
                sources={sources}
                onChange={onChange}
                editable={editable}
              />
            ))
          ) : (
            <Text as="p" color="gray" size="2">
              조건에 맞는 대상이 없습니다.
            </Text>
          )}
        </Tabs.Content>
      </Tabs.Root>
      <Separator size="4" my="4" />
      <Text as="p" size="2" weight="medium">
        별칭 추가
      </Text>
      <Flex gap="3" wrap="wrap" align="center" mt="4">
        <TextField.Root
          aria-label="추가할 출처 키워드"
          placeholder="새 별칭"
          value={word}
          onChange={(e) => setWord(e.target.value)}
        />
        <Select.Root value={target} onValueChange={setTarget}>
          <Select.Trigger
            placeholder="대상 선택"
            aria-label="추가 키워드 대상"
          />
          <Select.Content>
            {rows(groups).map((g) => (
              <Select.Item key={text(g.id)} value={text(g.id)}>
                {text(g.name)}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Select.Root
          value={destination}
          onValueChange={(v) => setDestination(v as KeywordSource | "both")}
        >
          <Select.Trigger aria-label="추가 키워드 수집 출처" />
          <Select.Content>
            <Select.Item value="pokergosu">포커고수만</Select.Item>
            <Select.Item value="kakao">카톡만</Select.Item>
            <Select.Item value="both">두 출처</Select.Item>
          </Select.Content>
        </Select.Root>
        <Button
          type="button"
          size="1"
          intent="secondary"
          disabled={
            !editable ||
            !word.trim() ||
            !target ||
            words.includes(word.trim()) ||
            words.length >= 100
          }
          onClick={() => {
            onAdd(word.trim(), target, destination);
            setWord("");
          }}
        >
          별칭 추가
        </Button>
      </Flex>
      <Text as="p" size="1" color="gray" mt="3">
        변경 사항은 오른쪽 위 ‘변경 저장’을 눌러 반영합니다. 포커고수에는 카톡의
        제외 문구를 적용하지 않습니다.
      </Text>
    </Box>
  );
}
