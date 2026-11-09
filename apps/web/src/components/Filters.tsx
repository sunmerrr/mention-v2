import { CalendarDays, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { Metadata } from "../../../../packages/contracts/src/api";
import { Button, FilterBar, Select, TextField } from "../design-system";
export function Filters({ metadata }: { metadata?: Metadata }) {
  const [search, setSearch] = useSearchParams();
  function update(key: string, value: string) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  }
  return (
    <FilterBar>
      <TextField.Root
        type="date"
        aria-label="조회 날짜"
        value={search.get("day") || ""}
        onChange={(e) => update("day", e.target.value)}
      >
        <TextField.Slot>
          <CalendarDays size={14} />
        </TextField.Slot>
      </TextField.Root>
      <Select.Root
        value={search.get("target") || "all"}
        onValueChange={(v) => update("target", v === "all" ? "" : v)}
      >
        <Select.Trigger aria-label="분석 대상" placeholder="모든 대상" />
        <Select.Content>
          <Select.Item value="all">모든 대상</Select.Item>
          {metadata?.targets.map((t) => (
            <Select.Item value={t.name} key={t.name}>
              {t.name}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      {(search.get("day") || search.get("target")) && (
        <Button
          variant="ghost"
          color="gray"
          onClick={() => setSearch({}, { replace: true })}
        >
          <RotateCcw size={13} />
          초기화
        </Button>
      )}
    </FilterBar>
  );
}
