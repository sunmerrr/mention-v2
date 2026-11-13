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

export function ClassificationControl({
  item,
  endpoint = "/api/classifications/correct",
}: {
  item: Classification;
  endpoint?: string;
}) {
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(item.summary),
    [noteLabel, setNoteLabel] = useState<Decision | "">(""),
    [noteExpected, setNoteExpected] = useState(item.expected),
    [notice, setNotice] = useState("");
  const request = useRef<{ key: string; id: string }>();
  const client = useQueryClient(),
    { writesEnabled } = useRuntime();
  const save = useMutation({
    mutationFn: (input: Correction) => api(endpoint, input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["classifications"] }),
        client.invalidateQueries({ queryKey: ["overview"] }),
        client.invalidateQueries({ queryKey: ["combined"] }),
        client.invalidateQueries({
          queryKey: ["pokergosu-post", item.conversationId],
        }),
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
  function submit(label: Decision, summary: string, expected = item.expected) {
    const key = JSON.stringify([expected, label, summary]);
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    setNotice("");
    save.mutate({
      id: item.conversationId,
      service: item.target,
      verdict: label,
      summary,
      expected,
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
              setNoteLabel(
                item.stale || item.label === "unreviewed" ? "" : item.label,
              );
              setNoteExpected(item.expected);
              save.reset();
            }
          }}
        >
          <Dialog.Trigger>
            <Button
              intent="quiet"
              size="1"
              disabled={!writesEnabled || save.isPending}
              title="분류 메모 수정"
            >
              <MessageSquareText size={14} />
              메모
            </Button>
          </Dialog.Trigger>
          <DialogContent
            title={`${item.target} 메모`}
            description="분류와 판단 근거를 함께 수정하고 저장합니다."
          >
            <Box mb="4">
              <Text as="p" size="2" weight="medium" mb="2">
                여론 분류
              </Text>
              <Select.Root
                value={noteLabel}
                onValueChange={(value) => setNoteLabel(value as Decision)}
                disabled={save.isPending}
              >
                <Select.Trigger
                  aria-label="메모의 여론 분류"
                  placeholder="분류 선택"
                />
                <Select.Content>
                  {decisions.map((label) => (
                    <Select.Item key={label} value={label}>
                      {labels[label]}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Box>
            <Field id={`classification-note-${item.id}`} label="메모">
              <TextArea
                id={`classification-note-${item.id}`}
                aria-label="분류 메모"
                value={note}
                maxLength={2800}
                disabled={save.isPending}
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
                  !noteLabel ||
                  (!item.stale &&
                    noteLabel === item.label &&
                    note === item.summary)
                }
                onClick={() => {
                  if (noteLabel) submit(noteLabel, note, noteExpected);
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
