import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { useRef, useState } from "react";
import type {
  Classification,
  Correction,
} from "../../../../packages/contracts/src/api";
import {
  type Decision,
  decisions,
} from "../../../../packages/domain/src/model";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  Field,
  Flex,
  Select,
  Text,
  TextArea,
} from "../design-system";
import { api } from "../queries";
import { useRuntime } from "../runtime";
import { Failure, labels } from "./ui";

export function ClassificationControl({ item }: { item: Classification }) {
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(item.summary),
    [notice, setNotice] = useState("");
  const request = useRef<{ key: string; id: string }>();
  const client = useQueryClient(),
    { writesEnabled } = useRuntime();
  const save = useMutation({
    mutationFn: (input: Correction) =>
      api("/api/classifications/correct", input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["classifications"] }),
        client.invalidateQueries({ queryKey: ["overview"] }),
        client.invalidateQueries({ queryKey: ["conversations"] }),
        client.invalidateQueries({
          queryKey: ["conversation", item.conversationId],
        }),
      ]);
      request.current = undefined;
      setOpen(false);
      setNotice("저장됨");
    },
  });
  function submit(label: Decision, summary: string) {
    const key = JSON.stringify([item.expected, label, summary]);
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    setNotice("");
    save.mutate({
      id: item.conversationId,
      service: item.target,
      verdict: label,
      summary,
      expected: item.expected,
      request_id: request.current.id,
    });
  }
  return (
    <Box>
      <Flex align="center" gap="2" wrap="wrap">
        <Select.Root
          value={item.stale || item.label === "unreviewed" ? "" : item.label}
          disabled={!writesEnabled || save.isPending}
          onValueChange={(value) => submit(value as Decision, item.summary)}
        >
          <Select.Trigger aria-label={`${item.target} 분류`} placeholder="분류">
            {save.isPending
              ? "저장 중…"
              : item.stale
                ? "분류 선택"
                : item.label === "unreviewed"
                  ? "분류"
                  : labels[item.label]}
          </Select.Trigger>
          <Select.Content>
            {decisions.map((label) => (
              <Select.Item key={label} value={label}>
                {labels[label]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Dialog.Root
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (value) {
              setNote(item.summary);
              save.reset();
            }
          }}
        >
          <Dialog.Trigger>
            <Button
              intent="quiet"
              size="1"
              disabled={
                !writesEnabled ||
                save.isPending ||
                item.stale ||
                item.label === "unreviewed"
              }
              title={
                item.stale || item.label === "unreviewed"
                  ? "분류를 먼저 선택하세요"
                  : "메모 작성"
              }
            >
              <MessageSquareText size={14} />
              메모
            </Button>
          </Dialog.Trigger>
          <DialogContent
            title={`${item.target} 메모`}
            description="분류와 별도로 판단 근거나 참고할 내용을 남깁니다."
          >
            <Field id={`classification-note-${item.id}`} label="메모">
              <TextArea
                id={`classification-note-${item.id}`}
                aria-label="분류 메모"
                value={note}
                maxLength={2800}
                rows={5}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            {save.isError && <Failure error={save.error} />}
            <Flex justify="end" gap="3" mt="5">
              <Dialog.Close>
                <Button intent="secondary" disabled={save.isPending}>
                  취소
                </Button>
              </Dialog.Close>
              <Button
                loading={save.isPending}
                disabled={
                  item.label === "unreviewed" ||
                  item.stale ||
                  note === item.summary
                }
                onClick={() => {
                  if (item.label !== "unreviewed") submit(item.label, note);
                }}
              >
                메모 저장
              </Button>
            </Flex>
          </DialogContent>
        </Dialog.Root>
      </Flex>
      {save.isError && !open && <Failure error={save.error} />}
      <Text as="p" size="1" color="gray" role="status">
        {notice}
      </Text>
    </Box>
  );
}
