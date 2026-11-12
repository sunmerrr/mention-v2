import { useState } from "react";
import {
  DetailLayout,
  DialogContent,
  Disclosure,
  Field,
  MetricCard,
  PageHeader,
  PreviewDisclosure,
  ReadingTable,
  Section,
  SelectionPanel,
} from "./patterns";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Flex,
  Grid,
  Heading,
  RadioCards,
  Select,
  Table,
  Text,
  TextArea,
  TextField,
} from "./primitives";
import { sentimentColors } from "./theme";

const swatches = [
  ["캔버스", "bg-canvas"],
  ["콘텐츠", "bg-surface"],
  ["보조 배경", "bg-subtle"],
  ["선택 배경", "bg-selected"],
  ["주요 글자", "text-primary"],
  ["보조 글자", "text-secondary"],
  ["액션", "text-action"],
  ["경계", "border"],
];
export default function Catalog() {
  const [choice, setChoice] = useState("neutral");
  const [selection, setSelection] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="디자인 시스템"
        description="Mention의 공통 토큰·컴포넌트·화면 구성 기준입니다. 이 페이지의 예제는 운영 데이터를 변경하지 않습니다."
      />
      <Section
        title="색상 토큰"
        description="용도에 따라 이름을 정하고, 실제 색상은 한곳에서 관리합니다."
      >
        <Grid columns={{ initial: "2", sm: "4" }} gap="4">
          {swatches.map(([name, token]) => (
            <Flex direction="column" gap="2" key={token}>
              <div
                className="ds-swatch"
                style={{ background: `var(--mention-${token})` }}
              />
              <Text size="2" weight="medium">
                {name}
              </Text>
              <Text size="1" color="gray">
                {token}
              </Text>
            </Flex>
          ))}
        </Grid>
      </Section>
      <Section
        title="글자와 간격"
        description="제목 6 · 영역 제목 4 · 본문 2 · 보조 정보 1 / Radix 간격 스케일 사용"
      >
        <Heading size="6" as="h2">
          대화에서 의견을 읽습니다
        </Heading>
        <Heading size="4" as="h3" mt="4">
          영역 제목
        </Heading>
        <Text as="p" size="2" mt="2">
          본문은 내용을 읽기 위한 기본 크기입니다. 중요한 정보는 굵기와 위치로
          구분합니다.
        </Text>
        <Text as="p" size="1" color="gray" mt="2">
          보조 정보는 작은 크기와 차분한 색상으로 표시합니다.
        </Text>
      </Section>
      <Section
        title="버튼"
        description="주요 행동은 한 영역에 하나. 보조 행동은 secondary, 가벼운 행동은 quiet를 사용합니다."
      >
        <Flex gap="3" wrap="wrap">
          <Button>저장</Button>
          <Button intent="secondary">취소</Button>
          <Button intent="quiet">더 보기</Button>
          <Button intent="danger">삭제</Button>
          <Button disabled>사용 불가</Button>
          <Button loading>저장 중</Button>
        </Flex>
      </Section>
      <Section
        title="입력 요소"
        description="라벨은 항상 표시하고, 입력 목적과 오류를 글로 설명합니다."
      >
        <Grid columns={{ initial: "1", sm: "2" }} gap="5">
          <Field
            id="ds-name"
            label="대상 이름"
            hint="표시할 서비스 이름을 입력하세요."
          >
            <TextField.Root
              id="ds-name"
              placeholder="예: 포커룰루"
              aria-describedby="ds-name-hint"
            />
          </Field>
          <Field id="ds-filter" label="분류 필터">
            <Select.Root defaultValue="all">
              <Select.Trigger id="ds-filter" aria-label="예제 분류 필터" />
              <Select.Content>
                <Select.Item value="all">모든 분류</Select.Item>
                <Select.Item value="positive">긍정</Select.Item>
              </Select.Content>
            </Select.Root>
          </Field>
          <Field id="ds-note" label="판단 근거">
            <TextArea
              id="ds-note"
              placeholder="대화에서 확인한 근거를 적어주세요."
            />
          </Field>
          <Flex direction="column" gap="3">
            <Text as="label" size="2">
              <Checkbox mr="2" />
              수집에서 제외
            </Text>
            <RadioCards.Root
              value={choice}
              onValueChange={setChoice}
              columns="2"
              aria-label="예제 분류"
            >
              <RadioCards.Item value="positive">긍정</RadioCards.Item>
              <RadioCards.Item value="neutral">중립</RadioCards.Item>
            </RadioCards.Root>
          </Flex>
        </Grid>
      </Section>
      <Section
        title="상태와 목록"
        description="상태는 색상과 텍스트를 함께 표시합니다. 아래 목록은 합성 예제입니다."
      >
        <Flex gap="2" wrap="wrap" mb="4">
          {Object.entries(sentimentColors).map(([key, color]) => (
            <Badge key={key} color={color}>
              {
                {
                  positive: "긍정",
                  negative: "부정",
                  neutral: "중립",
                  mixed: "혼합",
                  uncertain: "판단 보류",
                  unreviewed: "미분류",
                  excluded: "판단 제외",
                }[key as keyof typeof sentimentColors]
              }
            </Badge>
          ))}
        </Flex>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>대상</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>요약</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>반응</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row>
              <Table.Cell>예제 서비스</Table.Cell>
              <Table.Cell>이용 경험에 대한 긍정적인 의견</Table.Cell>
              <Table.Cell>
                <Badge color="jade">긍정</Badge>
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>
      </Section>
      <Section
        title="수정 창"
        description="현재 화면에서 작업을 마치고, 취소하면 원래 위치로 돌아갑니다."
      >
        <Dialog.Root>
          <Dialog.Trigger>
            <Button intent="secondary">예제 수정 창 열기</Button>
          </Dialog.Trigger>
          <DialogContent
            title="예제 수정"
            description="예제 입력은 저장되지 않습니다."
          >
            <Field id="ds-dialog-note" label="메모">
              <TextArea id="ds-dialog-note" />
            </Field>
            <Flex justify="end" gap="3" mt="5">
              <Dialog.Close>
                <Button intent="secondary">취소</Button>
              </Dialog.Close>
              <Dialog.Close>
                <Button>완료</Button>
              </Dialog.Close>
            </Flex>
          </DialogContent>
        </Dialog.Root>
      </Section>
      <Section
        title="상세 화면 구성"
        description="본문은 중심 영역에, 분류·관리는 보조 영역에 둡니다. 좁은 화면에서는 아래로 이어집니다."
      >
        <DetailLayout
          content={
            <Text as="p" size="2">
              대화 본문 예제
            </Text>
          }
          aside={
            <Disclosure title="부가 정보">
              <Text size="2">필요할 때 펼쳐 확인하는 정보입니다.</Text>
            </Disclosure>
          }
        />
      </Section>
      <SelectionPanel
        title="선택 목록 예제"
        description="항목을 선택하면 오른쪽 위에 작업이 나타납니다."
        items={[
          { id: "example-a", label: "예제 항목 A" },
          { id: "example-b", label: "예제 항목 B" },
        ]}
        selected={selection}
        onSelectionChange={setSelection}
        empty="항목이 없습니다."
        action={
          selection.length ? (
            <Button intent="secondary" onClick={() => setSelection([])}>
              선택 해제 · {selection.length}
            </Button>
          ) : undefined
        }
      />
      <Section
        title="요약 지표"
        description="제목·값·설명·관련 작업을 분리하고 같은 행의 높이를 맞춥니다."
      >
        <Grid columns={{ initial: "1", sm: "2" }} gap="4">
          <MetricCard
            label="예제 지표"
            icon={<span aria-hidden="true">#</span>}
            value="24"
            unit="건"
            description="합성 데이터 예제"
          />
          <MetricCard
            label="예제 분류"
            icon={<span aria-hidden="true">#</span>}
            value="12"
            unit="건"
            description="검토가 완료된 예제"
          >
            <Button intent="quiet" size="1">
              검토 목록 보기
            </Button>
          </MetricCard>
        </Grid>
      </Section>
      <Section
        title="미리보기 편집 목록"
        description="요약은 목록에서 읽고, 필요한 항목만 펼쳐 수정합니다."
      >
        <PreviewDisclosure
          title="예제 대상"
          preview={
            <Text size="2" color="gray">
              하위 키워드 미리보기
            </Text>
          }
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        >
          <Field id="ds-preview-name" label="대상 이름">
            <TextField.Root id="ds-preview-name" defaultValue="예제 대상" />
          </Field>
        </PreviewDisclosure>
      </Section>
      <Section
        title="긴 글을 읽는 표"
        description="읽기 열과 메타데이터 너비 · 키보드·모바일 가로 스크롤"
      >
        <ReadingTable label="합성 원문 표">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>원문</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>키워드</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>댓글</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>확인</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row>
              <Table.Cell>
                합성 게시글 · 긴 본문과
                https://example.invalid/abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz
                같은 주소도 메타데이터 열을 밀어내지 않습니다.
              </Table.Cell>
              <Table.Cell>
                <Badge>합성 대상</Badge>
              </Table.Cell>
              <Table.Cell>저장 12개</Table.Cell>
              <Table.Cell>11. 12. 12:00</Table.Cell>
            </Table.Row>
          </Table.Body>
        </ReadingTable>
      </Section>
      <Section
        title="원문 이미지 보관 상태"
        description="주소 수집과 파일 보관을 구분하는 합성 예시 · 외부 요청 없음"
      >
        <Flex gap="4" direction={{ initial: "column", sm: "row" }}>
          <div>
            <Text as="p" size="2" mb="2">
              주소만 수집됨 · 파일 미보관
            </Text>
            <Button intent="secondary" disabled>
              이미지 불러오기
            </Button>
            <Text as="p" size="1" color="gray" mt="2">
              처음 볼 때만 외부 다운로드 · 이후 로컬 보관
            </Text>
          </div>
          <figure className="ds-source-image">
            <img
              src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAIAAABr1yBdAAABe0lEQVR4nO3TsQ2AMADAsB7MzKl8wcDC3CdAVRVLPiBLxv28kDWWF8BCBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgLS/BjiPC75lANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCk7TQAbMEApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQNgHsR9c5jf951AAAAABJRU5ErkJggg=="
              alt="합성 보관 이미지"
            />
            <Text as="p" size="1" color="gray">
              로컬 보관 이미지 (합성)
            </Text>
          </figure>
        </Flex>
      </Section>
    </>
  );
}
