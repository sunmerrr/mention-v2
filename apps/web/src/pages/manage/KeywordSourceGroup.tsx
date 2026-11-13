import { useState } from "react";
import type {
  KeywordPolicy,
  KeywordSource,
} from "../../../../../packages/contracts/src/keyword-policy";
import { updateSourceScope } from "../../../../../packages/domain/src/keyword-scope";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  PreviewDisclosure,
  Select,
  Text,
} from "../../design-system";

const sourceNames = { kakao: "카톡", pokergosu: "포커고수" };
export function KeywordSourceGroup({
  name,
  aliases,
  query,
  tab,
  sources,
  onChange,
  editable,
}: {
  name: string;
  aliases: string[];
  query: string;
  tab: KeywordSource | "all";
  sources: KeywordPolicy["sources"];
  onChange: (value: KeywordPolicy["sources"]) => void;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [bulk, setBulk] = useState<KeywordSource>("kakao");
  const columns: KeywordSource[] =
    tab === "all" ? ["kakao", "pokergosu"] : [tab];
  const visible = aliases.filter(
    (w) =>
      !query ||
      name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
      w.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const chosen = selected.filter((w) => visible.includes(w));
  function apply(source: KeywordSource, words: string[], active: boolean) {
    onChange(updateSourceScope(sources, source, words, active));
    setSelected([]);
  }
  const count = (source: KeywordSource) =>
    aliases.filter((w) => !sources[source].disabled.includes(w)).length;
  return (
    <Box mb="4">
      <Flex align="center" justify="between" gap="3" wrap="wrap" mb="2">
        <Flex gap="2" align="center">
          <Text size="2" weight="medium">
            {name}
          </Text>
          <Text size="1" color="gray">
            별칭 {aliases.length}개
          </Text>
        </Flex>
        <Flex gap="3" wrap="wrap">
          {columns.map((source) => {
            const n = count(source),
              partial = n > 0 && n < aliases.length;
            return (
              <Flex key={source} gap="2" align="center">
                <Text size="1" color="gray">
                  {sourceNames[source]}
                </Text>
                <Select.Root
                  value={partial ? "partial" : n ? "enabled" : "disabled"}
                  disabled={!editable}
                  onValueChange={(v) => apply(source, aliases, v === "enabled")}
                >
                  <Select.Trigger
                    aria-label={`${name} ${sourceNames[source]} 묶음 수집`}
                  >
                    {partial
                      ? `${aliases.length}개 중 ${n}개 수집`
                      : n
                        ? "전체 수집"
                        : "사용 안 함"}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="enabled">전체 수집</Select.Item>
                    <Select.Item value="disabled">사용 안 함</Select.Item>
                    {partial && (
                      <Select.Item value="partial" disabled>
                        {aliases.length}개 중 {n}개 수집
                      </Select.Item>
                    )}
                  </Select.Content>
                </Select.Root>
              </Flex>
            );
          })}
        </Flex>
      </Flex>
      <PreviewDisclosure
        title="개별 예외 설정"
        open={open || !!query}
        onOpenChange={setOpen}
        preview={
          <Text size="1" color="gray">
            {columns
              .map(
                (source) =>
                  `${sourceNames[source]} ${count(source)}/${aliases.length}개 수집`,
              )
              .join(" · ")}
          </Text>
        }
      >
        <Text as="p" size="1" color="gray" mb="3">
          묶음 설정은 모든 별칭에 적용됩니다. 일부만 다르게 수집하려면 아래에서
          변경하세요.
        </Text>
        <Flex align="center" justify="between" gap="3" wrap="wrap" mb="3">
          <Button
            type="button"
            intent="quiet"
            size="1"
            disabled={!editable}
            onClick={() => {
              setEditing((v) => !v);
              setSelected([]);
            }}
          >
            {editing ? "편집 마침" : "여러 항목 편집"}
          </Button>
          {editing && (
            <Flex gap="2" align="center" wrap="wrap">
              <Checkbox
                aria-label={`${name} 검색 결과 전체 선택`}
                checked={
                  chosen.length === visible.length && visible.length
                    ? true
                    : chosen.length
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(v) => setSelected(v === true ? visible : [])}
              />
              <Text size="1">{chosen.length}개 선택</Text>
              {tab === "all" && (
                <Select.Root
                  value={bulk}
                  onValueChange={(v) => setBulk(v as KeywordSource)}
                >
                  <Select.Trigger aria-label={`${name} 일괄 변경 출처`} />
                  <Select.Content>
                    <Select.Item value="kakao">카톡</Select.Item>
                    <Select.Item value="pokergosu">포커고수</Select.Item>
                  </Select.Content>
                </Select.Root>
              )}
              <Button
                type="button"
                intent="secondary"
                size="1"
                disabled={!chosen.length}
                onClick={() => apply(tab === "all" ? bulk : tab, chosen, true)}
              >
                수집
              </Button>
              <Button
                type="button"
                intent="secondary"
                size="1"
                disabled={!chosen.length}
                onClick={() => apply(tab === "all" ? bulk : tab, chosen, false)}
              >
                사용 안 함
              </Button>
            </Flex>
          )}
        </Flex>
        {visible.map((alias) => (
          <Flex
            key={alias}
            justify="between"
            align="center"
            gap="3"
            wrap="wrap"
            py="2"
          >
            <Flex align="center" gap="2">
              {editing && (
                <Checkbox
                  aria-label={`${alias} 선택`}
                  checked={chosen.includes(alias)}
                  onCheckedChange={(v) =>
                    setSelected((prev) =>
                      v === true
                        ? [...prev, alias]
                        : prev.filter((w) => w !== alias),
                    )
                  }
                />
              )}
              <Text size="2">{alias}</Text>
            </Flex>
            <Flex gap="3" wrap="wrap">
              {columns.map((source) => (
                <Flex key={source} gap="2" align="center">
                  {tab === "all" && (
                    <Badge color="gray">{sourceNames[source]}</Badge>
                  )}
                  <Select.Root
                    value={
                      sources[source].disabled.includes(alias)
                        ? "disabled"
                        : "enabled"
                    }
                    disabled={!editable}
                    onValueChange={(v) =>
                      apply(source, [alias], v === "enabled")
                    }
                  >
                    <Select.Trigger
                      aria-label={`${alias} ${sourceNames[source]} 수집`}
                    />
                    <Select.Content>
                      <Select.Item value="enabled">수집</Select.Item>
                      <Select.Item value="disabled">사용 안 함</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
              ))}
            </Flex>
          </Flex>
        ))}
      </PreviewDisclosure>
    </Box>
  );
}
