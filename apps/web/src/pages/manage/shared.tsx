import { useQueryClient } from "@tanstack/react-query";
import {
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  RecordData,
  WorkspaceAction,
} from "../../../../../packages/application/src/workspace";
import { pageFormId, usePageSave } from "../../components/PageSave";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Select,
  Table,
  Text,
  TextArea,
  TextField,
} from "../../design-system";
import { relatedHref, useMenuOrigin } from "../../navigation";
import { api } from "../../queries";
import { useRuntime } from "../../runtime";
export type Row = RecordData;
export const obj = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
export const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : [];
export const text = (v: unknown): string => (v == null ? "" : String(v));
export const num = (v: unknown): number => (typeof v === "number" ? v : 0);
export const split = (v: FormDataEntryValue | null) => [
  ...new Set(
    String(v || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
export function href(value: unknown) {
  const url = text(value);
  const match = /^\/(conversation|episode)\?id=([a-f0-9]{32})$/.exec(url);
  if (match)
    return match[1] === "conversation" ? `/conversations/${match[2]}` : url;
  return url.startsWith("/") && !url.startsWith("//") ? url : "/conversations";
}
export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="section-card">
      <Flex justify="between" align="center" gap="3" wrap="wrap" mb="4">
        <Heading as="h2" size="4">
          {title}
        </Heading>
        {action}
      </Flex>
      {children}
    </Card>
  );
}
export function Field({
  label,
  name,
  value = "",
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: "text" | "search" | "date" | "time" | "number" | "datetime-local";
  required?: boolean;
}) {
  const controlId = useId();
  return (
    <Box asChild>
      <label htmlFor={controlId}>
        <Text as="div" size="2" weight="medium" mb="2">
          {label}
        </Text>
        <TextField.Root
          id={controlId}
          aria-label={label}
          name={name}
          type={type}
          defaultValue={value}
          required={required}
        />
      </label>
    </Box>
  );
}
export function Multiline({
  label,
  name,
  value = "",
  rows: count = 5,
  maxLength,
  onChange,
}: {
  label: string;
  name: string;
  value?: string;
  rows?: number;
  maxLength?: number;
  onChange?: (value: string) => void;
}) {
  const controlId = useId();
  return (
    <Box asChild>
      <label htmlFor={controlId}>
        <Text as="div" size="2" weight="medium" mb="2">
          {label}
        </Text>
        <TextArea
          id={controlId}
          aria-label={label}
          name={name}
          {...(onChange
            ? {
                value,
                onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  onChange(event.target.value),
              }
            : { defaultValue: value })}
          rows={count}
          maxLength={maxLength}
        />
      </label>
    </Box>
  );
}
export function Choice({
  name,
  value,
  options,
  label,
}: {
  name: string;
  value?: string;
  options: Record<string, string>;
  label: string;
}) {
  return (
    <Box>
      <Text as="div" size="2" mb="2">
        {label}
      </Text>
      <Select.Root name={name} defaultValue={value || Object.keys(options)[0]}>
        <Select.Trigger aria-label={label} />
        <Select.Content>
          {Object.entries(options).map(([v, l]) => (
            <Select.Item key={v} value={v}>
              {l}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Box>
  );
}
export function useAction() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(false);
  async function run(action: WorkspaceAction, input: Row) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    setError(false);
    try {
      const result = await api<Row>(`/api/actions/${action}`, input);
      const uncertain =
        typeof result.state === "string" &&
        (result.state.startsWith("unknown") ||
          result.state.startsWith("sending"));
      setError(uncertain);
      setNotice(
        text(result.message) ||
          (uncertain
            ? "결과가 아직 확인되지 않았습니다. 새 요청으로 반복하지 마세요."
            : action === "context-expand"
              ? "대화 조회를 마쳤습니다."
              : action === "keyword-check"
                ? "규칙 확인을 마쳤습니다."
                : "처리했습니다."),
      );
      void client.invalidateQueries();
      return result;
    } catch (e) {
      setError(true);
      setNotice(e instanceof Error ? e.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, notice, error };
}
export function Notice({ state }: { state: ReturnType<typeof useAction> }) {
  return state.notice ? (
    <Callout.Root color={state.error ? "red" : "gray"} mt="3" role="status">
      <Callout.Text>{state.notice}</Callout.Text>
    </Callout.Root>
  ) : null;
}
export function ActionForm({
  action,
  build,
  children,
  submit = "변경 저장",
  submitDisabled = false,
  localOnly = false,
  onResult,
}: {
  action: WorkspaceAction;
  build: (form: FormData) => Row;
  children?: ReactNode;
  submit?: string;
  submitDisabled?: boolean;
  localOnly?: boolean;
  onResult?: (result: Row) => void;
}) {
  const state = useAction(),
    runtime = useRuntime();
  const pageSave = usePageSave();
  const inHeader = pageSave?.actions.some((item) => item.action === action);
  const reportNotice = pageSave?.reportNotice;
  useEffect(() => {
    if (inHeader) reportNotice?.(action, state.notice, state.error);
  }, [inHeader, reportNotice, action, state.notice, state.error]);
  const disabled =
    submitDisabled || !runtime.writesEnabled || (localOnly && !runtime.local);
  return (
    <form
      id={inHeader ? pageFormId(action) : undefined}
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled || state.busy) return;
        const input = build(new FormData(e.currentTarget));
        if (inHeader) pageSave?.setBusy(action, true);
        try {
          const result = await state.run(action, input);
          if (result) onResult?.(result);
        } finally {
          if (inHeader) pageSave?.setBusy(action, false);
        }
      }}
    >
      <Flex direction="column" gap="4">
        {children}
      </Flex>
      {!inHeader && (
        <Flex justify="end" mt="4">
          <Button type="submit" loading={state.busy} disabled={disabled}>
            {submit}
          </Button>
        </Flex>
      )}
      {localOnly && !runtime.local && (
        <Text as="p" size="1" color="gray" mt="2">
          로컬 대시보드에서 실행할 수 있습니다.
        </Text>
      )}
      {!inHeader && <Notice state={state} />}
    </form>
  );
}
export function Action({
  action,
  input,
  children,
  localOnly = false,
}: {
  action: WorkspaceAction;
  input: Row;
  children: ReactNode;
  localOnly?: boolean;
}) {
  const state = useAction(),
    runtime = useRuntime();
  return (
    <Box>
      <Button
        size="2"
        variant="soft"
        color="gray"
        loading={state.busy}
        disabled={!runtime.writesEnabled || (localOnly && !runtime.local)}
        onClick={() => state.run(action, input)}
      >
        {children}
      </Button>
      <Notice state={state} />
    </Box>
  );
}
function cellKey(cell: ReactNode): string {
  if (typeof cell === "string" || typeof cell === "number") return String(cell);
  if (isValidElement<{ children?: ReactNode; to?: string; input?: Row }>(cell))
    return String(
      cell.key ||
        cell.props.to ||
        (cell.props.input
          ? JSON.stringify(cell.props.input)
          : cellKey(cell.props.children)),
    );
  if (Array.isArray(cell)) return cell.map(cellKey).join(":");
  return "";
}
export function DataTable({
  columns,
  items,
}: {
  columns: string[];
  items: ReactNode[][];
}) {
  return (
    <Box className="table-scroll">
      <Table.Root
        variant="surface"
        style={{ minWidth: columns.length >= 4 ? "600px" : undefined }}
      >
        <Table.Header>
          <Table.Row>
            {columns.map((c) => (
              <Table.ColumnHeaderCell key={c}>{c}</Table.ColumnHeaderCell>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {items.map((item) => (
            <Table.Row key={item.map(cellKey).join("|")}>
              {item.map((cell, j) => (
                <Table.Cell key={columns[j]}>{cell}</Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      {!items.length && (
        <Text as="p" color="gray" size="2" mt="4">
          이 조건에 맞는 기록이 없습니다.
        </Text>
      )}
    </Box>
  );
}
export function Paging({
  data,
  pageKey = "page",
}: {
  data: Row;
  pageKey?: string;
}) {
  const [params, set] = useSearchParams(),
    page = num(data.page) || 1,
    pages = num(data.pages) || 1;
  const go = (n: number) => {
    const p = new URLSearchParams(params);
    p.set(pageKey, String(n));
    set(p);
  };
  return (
    <Flex align="center" justify="end" gap="3" mt="4">
      <Button
        variant="soft"
        size="1"
        disabled={page <= 1}
        onClick={() => go(page - 1)}
      >
        이전
      </Button>
      <Text size="2">
        {page} / {pages} · {num(data.total)}개
      </Text>
      <Button
        variant="soft"
        size="1"
        disabled={page >= pages}
        onClick={() => go(page + 1)}
      >
        다음
      </Button>
    </Flex>
  );
}
export function FilterForm({ children }: { children: ReactNode }) {
  const [params, set] = useSearchParams();
  return (
    <form
      key={params.toString()}
      className="management-filters"
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams();
        new FormData(e.currentTarget).forEach((v, k) => {
          if (v) p.set(k, String(v));
        });
        set(p);
      }}
    >
      <Flex gap="3" wrap="wrap" align="end">
        {children}
        <Button type="submit" size="2">
          조회
        </Button>
      </Flex>
    </form>
  );
}
export function SourceLink({
  item,
  children,
}: {
  item: Row;
  children?: ReactNode;
}) {
  const menu = useMenuOrigin();
  return (
    <Link
      className="conversation-link"
      to={relatedHref(href(item.href || `/episode?id=${text(item.id)}`), menu)}
    >
      {children || text(item.title) || "원문 대화 보기"}
    </Link>
  );
}
export function CountBadge({ value }: { value: unknown }) {
  return <Badge color="gray">{num(value).toLocaleString()}개</Badge>;
}
