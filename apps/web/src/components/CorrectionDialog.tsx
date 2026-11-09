import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState } from "react";
import type {
  Classification,
  Correction,
} from "../../../../packages/contracts/src/api";
import type { Stance } from "../../../../packages/domain/src/model";
import {
  Box,
  Button,
  Callout,
  Dialog,
  DialogContent,
  Field,
  Flex,
  RadioCards,
  Separator,
  Text,
  TextArea,
} from "../design-system";
import { api } from "../queries";
import { useRuntime } from "../runtime";
import { EvaluationStatus, Failure, labels } from "./ui";

const descriptions: Record<string, string> = {
  positive: "호감·만족·추천",
  negative: "불만·비판·우려",
  neutral: "정보 전달·단순 언급",
  mixed: "긍정과 부정이 함께",
  uncertain: "근거·맥락이 부족함",
};
export function CorrectionDialog({
  item,
  prominent = false,
}: {
  item: Classification;
  prominent?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [label, setLabel] = useState(item.label),
    [note, setNote] = useState(item.summary),
    [request, setRequest] = useState("");
  const client = useQueryClient(),
    { writesEnabled } = useRuntime();
  const save = useMutation({
    mutationFn: (data: Correction) => api("/api/classifications/correct", data),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["classifications"] }),
        client.invalidateQueries({ queryKey: ["overview"] }),
        client.invalidateQueries({ queryKey: ["conversations"] }),
        client.invalidateQueries({
          queryKey: ["conversation", item.conversationId],
        }),
      ]);
      setOpen(false);
    },
  });
  function changedLabel(value: string) {
    setLabel(value as Stance);
    setRequest("");
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setLabel(item.label);
          setNote(item.summary);
          setRequest("");
          save.reset();
        }
      }}
    >
      <Dialog.Trigger>
        <Button
          variant={prominent ? "outline" : "soft"}
          color={prominent ? undefined : "gray"}
          size={prominent ? "2" : "1"}
        >
          <Pencil size={12} />
          분류 수정
        </Button>
      </Dialog.Trigger>
      <DialogContent
        title={`${item.target} 분류 수정`}
        description="대화 맥락을 기준으로 반응과 판단 근거를 수정하세요."
        status={<EvaluationStatus evaluation={item} />}
      >
        {!writesEnabled && (
          <Callout.Root color="amber" mb="4">
            <Callout.Text>
              새 버전은 현재 조회 전용입니다. 운영 데이터 수정은 연결 검증 후
              활성화합니다.
            </Callout.Text>
          </Callout.Root>
        )}
        <Flex direction="column" gap="5">
          <Box>
            <Text as="p" size="2" weight="medium" mb="2">
              어떤 반응인가요?
            </Text>
            <RadioCards.Root
              aria-label="수정할 분류"
              value={label}
              onValueChange={changedLabel}
              columns={{ initial: "2", sm: "3" }}
              gap="2"
              size="1"
            >
              {Object.entries(labels)
                .filter(([key]) => key !== "unreviewed")
                .map(([key, name]) => (
                  <RadioCards.Item key={key} value={key}>
                    <Flex direction="column" gap="1" width="100%">
                      <Text size="2" weight="medium">
                        {name}
                      </Text>
                      <Text size="1" color="gray">
                        {descriptions[key]}
                      </Text>
                    </Flex>
                  </RadioCards.Item>
                ))}
            </RadioCards.Root>
          </Box>
          <Field id={`classification-note-${item.id}`} label="판단 근거·요약">
            <TextArea
              id={`classification-note-${item.id}`}
              aria-label="분류 메모"
              value={note}
              maxLength={2800}
              onChange={(e) => {
                setNote(e.target.value);
                setRequest("");
              }}
              rows={5}
              size="2"
              placeholder="어떤 발언과 맥락을 근거로 판단했나요?"
            />
          </Field>
        </Flex>
        <Separator size="4" my="5" />
        {save.isError && <Failure error={save.error} />}
        <Text as="p" size="1" color="gray" mb="4">
          저장하면 집계에 반영되며 이전 분류와 수정 이력은 보존됩니다.
        </Text>
        <Flex justify="end" gap="3">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={save.isPending}>
              취소
            </Button>
          </Dialog.Close>
          <Button
            disabled={
              !writesEnabled ||
              label === "unreviewed" ||
              (!item.stale && label === item.label && note === item.summary)
            }
            loading={save.isPending}
            onClick={() => {
              const id = request || crypto.randomUUID();
              setRequest(id);
              save.mutate({
                id: item.conversationId,
                service: item.target,
                verdict: label as Stance,
                summary: note,
                expected: item.expected,
                request_id: id,
              });
            }}
          >
            수정 저장
          </Button>
        </Flex>
      </DialogContent>
    </Dialog.Root>
  );
}
