import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCheck,
  Clock3,
  FileText,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  PokergosuImage,
  PokergosuSummary,
} from "../../../../packages/contracts/src/pokergosu";
import { ClassificationControl } from "../components/ClassificationControl";
import { Empty, Failure, Pending, time } from "../components/ui";
import {
  Badge,
  Box,
  Button,
  Callout,
  Field,
  Flex,
  Grid,
  MetricCard,
  PageHeader,
  ReadingTable,
  Section,
  Select,
  Separator,
  Table,
  Text,
  TextField,
} from "../design-system";
import {
  pokergosuDetailQuery,
  pokergosuFilters,
  pokergosuQuery,
  pokergosuSummaryQuery,
} from "../pokergosu-query";
import { api } from "../queries";

function CapturedImage({
  image,
  postId,
}: {
  image: PokergosuImage;
  postId: string;
}) {
  const client = useQueryClient();
  const load = useMutation({
    mutationFn: () =>
      api<PokergosuImage>(`/api/pokergosu/${postId}/media/${image.key}`, {}),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["pokergosu-post", postId] }),
  });
  const asset = load.data || image;
  return (
    <Box mb="3">
      {asset.state === "cached" ? (
        <figure className="ds-source-image">
          <a
            href={`/api/pokergosu/media/${asset.key}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src={`/api/pokergosu/media/${asset.key}`}
              alt={asset.alt || "수집된 원문 이미지"}
              loading="lazy"
              decoding="async"
            />
          </a>
          <Text as="p" size="1" color="gray">
            로컬 보관 이미지 · 눌러서 크게 보기
          </Text>
        </figure>
      ) : (
        <Flex direction="column" align="start" gap="2">
          <Text size="2">
            {asset.alt || "원문 이미지"}
            {asset.width ? ` · ${asset.width} × ${asset.height}` : ""}
          </Text>
          {asset.state === "not_cached" ? (
            <Button
              intent="secondary"
              loading={load.isPending}
              onClick={() => load.mutate()}
            >
              이미지 불러오기
            </Button>
          ) : (
            <Text size="2" color="gray">
              {asset.state === "unsupported"
                ? "외부 이미지 호스트입니다. 원문에서 확인해 주세요."
                : asset.message ||
                  "이미지를 받지 못했습니다. 자동으로 재시도하지 않습니다."}
            </Text>
          )}
          <Text size="1" color="gray">
            처음 볼 때만 외부에서 다운로드 · 이후 로컬 보관 · 수집 당시와
            이미지가 달라질 수 있습니다.
          </Text>
        </Flex>
      )}
      {load.isError && <Failure error={load.error} />}
    </Box>
  );
}
function ImageGallery({
  images = [],
  skipped = 0,
  postId,
}: {
  images: PokergosuImage[];
  skipped: number;
  postId: string;
}) {
  if (!images.length && !skipped) return null;
  return (
    <Box my="4">
      <Text as="p" size="2" weight="medium" mb="3">
        수집한 이미지 주소 {images.length}개
      </Text>
      {images.map((image) => (
        <CapturedImage key={image.key} image={image} postId={postId} />
      ))}
      {!!skipped && (
        <Text as="p" size="1" color="gray">
          이미지 주소를 읽지 못했거나 한도에 도달해 {skipped}개를 저장하지
          못했습니다.
        </Text>
      )}
    </Box>
  );
}
function Keywords({ values }: { values: string[] }) {
  return (
    <Flex gap="1" wrap="wrap">
      {values.length ? (
        values.map((k) => (
          <Badge key={k} color="iris">
            {k}
          </Badge>
        ))
      ) : (
        <Text size="1" color="gray">
          일치 키워드 없음
        </Text>
      )}
    </Flex>
  );
}
function Status({ summary: s }: { summary: PokergosuSummary }) {
  const status = s.monitor?.status;
  return (
    <>
      <Text as="p" size="1" color="gray" mb="3">
        전체 수집 현황 · 아래 검색 조건과 별개입니다.
      </Text>
      <Grid columns={{ initial: "2", lg: "4" }} gap="4" className="metric-grid">
        <MetricCard
          label="수집한 글"
          icon={<FileText size={16} />}
          value={s.collected}
          unit="개"
          description="본문까지 저장된 전체 글"
        />
        <MetricCard
          label="관심 글"
          icon={<CheckCheck size={16} />}
          value={s.matched}
          unit="개"
          description="본문 또는 댓글에 포함 키워드 일치"
        />
        <MetricCard
          label="저장한 댓글"
          icon={<MessageSquareText size={16} />}
          value={s.comments}
          unit="개"
          description="텍스트·미디어 댓글 포함"
        />
        <MetricCard
          label="본문 미수집"
          icon={<Clock3 size={16} />}
          value={s.pending}
          unit="개"
          description="글 번호만 발견했고 본문은 아직 없는 글"
        />
      </Grid>
      <Flex gap="3" align="center" wrap="wrap" mb="4">
        <Badge color={status === "running" ? "jade" : "gray"}>
          {status === "running"
            ? s.monitor?.phase === "rest"
              ? "다음 수집 대기 기록"
              : "자동 수집 실행 기록"
            : status === "paused"
              ? "수집 일시 중지 기록"
              : status === "stopped"
                ? "수집 중지 기록"
                : "수집 기록 없음"}
        </Badge>
        <Text size="1" color="gray">
          {s.lastCheckedAt
            ? `마지막 본문 확인 ${time(s.lastCheckedAt)} · 한국 시간`
            : "아직 본문 수집 기록이 없습니다."}
        </Text>
        {s.monitor?.phase === "rest" && s.monitor.nextAt && (
          <Text size="1" color="gray">
            다음 목록 확인 예약 {time(s.monitor.nextAt)}
          </Text>
        )}
      </Flex>
      {!!s.readErrors && (
        <Text as="p" size="2" color="gray" mb="4">
          본문 읽기 실패 {s.readErrors}개를 기록하고 자동 재시도 대상에서
          제외했습니다.
        </Text>
      )}
      {!!s.monitor?.discoveryGaps && (
        <Callout.Root color="amber" mb="4">
          <Callout.Text>
            이전 확인 지점에 도달하지 못한 기록이 {s.monitor.discoveryGaps}회
            있습니다. 저장된 내용은 게시판 전체를 대표하지 않을 수 있습니다.
          </Callout.Text>
        </Callout.Root>
      )}
    </>
  );
}
function PostFilters({
  search,
  terms,
  onChange,
}: {
  search: string;
  terms: string[];
  onChange: (params: URLSearchParams) => void;
}) {
  const filters = pokergosuFilters(search);
  const [keyword, setKeyword] = useState(filters.keyword),
    [match, setMatch] = useState(filters.match);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      next = new URLSearchParams();
    for (const key of ["q", "keyword", "day", "match"]) {
      const value = String(form.get(key) || "");
      if (value && value !== "all") next.set(key, value);
    }
    onChange(next);
  }
  return (
    <form onSubmit={submit}>
      <Grid columns={{ initial: "1", sm: "2", lg: "4" }} gap="3" mb="4">
        <Field id="pg-search" label="본문·댓글 검색">
          <TextField.Root
            id="pg-search"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={filters.q}
            placeholder="검색어를 입력하세요"
          />
        </Field>
        <Field id="pg-keyword" label="일치한 관심 키워드">
          <Select.Root
            name="keyword"
            value={keyword || "all"}
            onValueChange={(value) => setKeyword(value === "all" ? "" : value)}
          >
            <Select.Trigger id="pg-keyword">
              {keyword || "전체 키워드"}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">전체 키워드</Select.Item>
              {terms.map((k) => (
                <Select.Item key={k} value={k}>
                  {k}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Field>
        <Field id="pg-match" label="글 범위">
          <Select.Root name="match" value={match} onValueChange={setMatch}>
            <Select.Trigger id="pg-match">
              {match === "matched" ? "관심 글만" : "수집한 글 전체"}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">수집한 글 전체</Select.Item>
              <Select.Item value="matched">관심 글만</Select.Item>
            </Select.Content>
          </Select.Root>
        </Field>
        <Field id="pg-day" label="마지막 수집일 (한국 시간)">
          <TextField.Root
            id="pg-day"
            name="day"
            type="date"
            defaultValue={filters.day}
          />
        </Field>
      </Grid>
      <Flex gap="2" mb="5">
        <Button type="submit">조회</Button>
        <Button
          type="button"
          intent="quiet"
          onClick={() => onChange(new URLSearchParams())}
        >
          필터 초기화
        </Button>
      </Flex>
    </form>
  );
}
function PostList() {
  const { search } = useLocation(),
    [params, setParams] = useSearchParams();
  const query = useInfiniteQuery(pokergosuQuery(search));
  const first = query.data?.pages[0],
    items = query.data?.pages.flatMap((p) => p.items) || [];
  return (
    <>
      <PageHeader
        title="게시글 목록"
        description="포커고수 자유게시판에서 수집한 본문·댓글을 조회합니다."
        actions={
          <Button
            intent="secondary"
            loading={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw size={14} />
            수집 데이터 새로고침
          </Button>
        }
      />
      <Section
        title="수집한 게시글"
        description={
          first
            ? `현재 조건 ${first.total}개 · 글 번호 최신순 · 30~60분 주기 · 새벽 2~8시 수집 휴식`
            : "저장된 데이터를 조회합니다."
        }
      >
        <PostFilters
          key={params.toString()}
          search={search}
          terms={first?.summary.keywords || []}
          onChange={setParams}
        />
        {query.isPending ? (
          <Pending />
        ) : query.isError ? (
          <Failure error={query.error} retry={query.refetch} />
        ) : (
          <>
            {first && !first.summary.available && (
              <Callout.Root mb="4">
                <Callout.Text>
                  포커고수 수집 데이터가 아직 연결되지 않았습니다.
                </Callout.Text>
              </Callout.Root>
            )}
            {!items.length ? (
              <Empty>이 조건에 맞는 수집 글이 없습니다.</Empty>
            ) : (
              <ReadingTable label="수집한 포커고수 게시글">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>게시글</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>관심 키워드</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>댓글</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>마지막 확인</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {items.map((post) => (
                    <Table.Row key={post.id}>
                      <Table.Cell>
                        <Link
                          to={`/posts/${post.id}?${params.toString()}`}
                          className="conversation-link"
                        >
                          <Text as="p" weight="medium" size="2">
                            {post.title}
                          </Text>
                        </Link>
                        <Text as="p" size="1" color="gray" mt="1">
                          {post.author || "작성자 미확인"} ·{" "}
                          {post.publishedAt || "작성 시각 미확인"}
                        </Text>
                        <Text as="p" size="2" className="preview-copy" mt="2">
                          {post.excerpt || "텍스트 본문 없음"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Keywords values={post.keywords} />
                        <Badge color="gray" mt="2">
                          미분류
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Text as="p" size="2">
                          저장 {post.commentCount}개
                        </Text>
                        <Text size="1" color="gray">
                          키워드 일치 {post.matchedComments}개
                        </Text>
                        {!!post.imageCount && (
                          <Text as="p" size="1" color="gray">
                            사진 {post.imageCount}개
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="1" color="gray">
                          {time(post.checkedAt)}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </ReadingTable>
            )}
            {query.hasNextPage && (
              <Flex justify="center" mt="4">
                <Button
                  intent="secondary"
                  loading={query.isFetchingNextPage}
                  onClick={() => query.fetchNextPage()}
                >
                  게시글 더 보기 · {items.length} / {first?.total}
                </Button>
              </Flex>
            )}
          </>
        )}
      </Section>
    </>
  );
}
function PostDetail({ id }: { id: string }) {
  const query = useQuery(pokergosuDetailQuery(id)),
    { search } = useLocation();
  const data = query.data;
  return (
    <>
      <Flex mb="4">
        <Button intent="quiet" asChild>
          <Link to={`/posts${search}`}>
            <ArrowLeft size={14} />
            게시글 목록
          </Link>
        </Button>
      </Flex>
      <PageHeader
        title="포커고수 글·댓글"
        description="수집 당시 저장된 원문입니다."
        actions={
          data && (
            <Button intent="secondary" asChild>
              <a href={data.post.url} target="_blank" rel="noopener noreferrer">
                포커고수에서 원문 보기
                <ArrowUpRight size={14} />
              </a>
            </Button>
          )
        }
      />
      {query.isPending ? (
        <Pending />
      ) : query.isError ? (
        <Failure error={query.error} retry={query.refetch} />
      ) : (
        data && (
          <>
            {data.evaluations && (
              <Section
                title="대상별 분류"
                description="게시글과 저장된 댓글의 맥락을 함께 보고 분류합니다."
              >
                {data.evaluations.length ? (
                  data.evaluations.map((item) => (
                    <Flex
                      key={item.id}
                      justify="between"
                      align="center"
                      gap="3"
                      wrap="wrap"
                      mb="3"
                    >
                      <Text weight="medium">{item.target}</Text>
                      <ClassificationControl
                        item={item}
                        endpoint={`/api/pokergosu/${id}/reviews`}
                      />
                    </Flex>
                  ))
                ) : (
                  <Text size="2" color="gray">
                    현재 포커고수 수집 키워드에 해당하는 대상이 없습니다.
                  </Text>
                )}
              </Section>
            )}
            <Section
              title={data.post.title}
              description={`${data.post.author || "작성자 미확인"} · ${data.post.publishedAt || "작성 시각 미확인"}`}
            >
              <Flex align="center" gap="3" wrap="wrap" mb="4">
                <Keywords values={data.post.keywords} />

                <Text size="1" color="gray">
                  마지막 확인 {time(data.post.checkedAt)}
                </Text>
              </Flex>
              <Text as="p" size="2" className="message-copy">
                {data.body ||
                  "저장된 텍스트 본문이 없습니다. 이미지 내용은 해석하지 않습니다."}
              </Text>
              <ImageGallery
                images={data.images}
                skipped={data.imagesSkipped}
                postId={id}
              />
            </Section>
            <Section
              title={`저장된 댓글 ${data.post.commentCount}개`}
              description={`키워드 일치 ${data.post.matchedComments}개 · ${data.coverage === "visible-complete" ? "수집 당시 표시된 댓글 기준" : "댓글 일부가 누락됐거나 전체 범위를 확인하지 못했습니다."}`}
            >
              <Text as="p" size="1" color="gray" mb="4">
                화면 표시 총수 {data.reportedComments ?? "미확인"} · 읽지 못해
                건너뜀 {data.skippedComments}개 · 표시되지 않은 댓글{" "}
                {data.unavailableComments}개. 이미지 내용은 해석하지 않습니다.
              </Text>
              {data.comments.length ? (
                data.comments.map((comment) => (
                  <Box key={comment.id} mb="4">
                    <Flex gap="2" wrap="wrap" mb="2">
                      <Text size="2" weight="medium">
                        {comment.author || "작성자 미확인"}
                      </Text>
                      <Text size="1" color="gray">
                        {comment.publishedAt || "작성 시각 미확인"}
                      </Text>
                    </Flex>
                    <Text as="p" size="2" className="message-copy">
                      {comment.text || "이미지·미디어 댓글 (텍스트 해석 생략)"}
                    </Text>
                    {comment.hasMedia && comment.text && (
                      <Text as="p" size="1" color="gray">
                        미디어 포함 · 이미지 내용 해석 생략
                      </Text>
                    )}
                    <ImageGallery
                      images={comment.images}
                      skipped={comment.imagesSkipped}
                      postId={id}
                    />
                    {comment.hasMedia && !comment.images?.length && (
                      <Text as="p" size="1" color="gray">
                        이전 수집본은 미디어 표시만 있고 이미지 주소가 남아 있지
                        않을 수 있습니다.
                      </Text>
                    )}
                    <Box mt="2">
                      <Keywords values={comment.keywords} />
                    </Box>
                    <Separator size="4" mt="4" />
                  </Box>
                ))
              ) : (
                <Empty>저장된 댓글이 없습니다.</Empty>
              )}
              {data.commentsLimited && (
                <Text as="p" size="2" color="gray">
                  저장된 댓글 중 처음 100개를 표시합니다. 나머지는 포커고수
                  원문에서 확인해 주세요.
                </Text>
              )}
            </Section>
          </>
        )
      )}
    </>
  );
}
function OpinionOverview() {
  const query = useQuery(pokergosuSummaryQuery()),
    data = query.data;
  return (
    <>
      <PageHeader
        title="포커고수 여론"
        description="관심 키워드와 수집 현황을 살펴보고, 원문은 게시글 목록에서 확인합니다."
        actions={
          <>
            <Button
              intent="secondary"
              loading={query.isFetching}
              onClick={() => query.refetch()}
            >
              <RefreshCw size={14} />
              수집 데이터 새로고침
            </Button>
            <Button asChild>
              <Link to="/posts">게시글 목록</Link>
            </Button>
          </>
        }
      />
      {query.isPending ? (
        <Pending />
      ) : query.isError ? (
        <Failure error={query.error} retry={query.refetch} />
      ) : (
        data && (
          <>
            <Status summary={data} />
            {!data.available && (
              <Callout.Root mb="4">
                <Callout.Text>
                  포커고수 수집 데이터가 아직 연결되지 않았습니다.
                </Callout.Text>
              </Callout.Root>
            )}
            <Section
              title="발견된 관심 키워드"
              description="본문·댓글에 일치한 포함 키워드입니다. 키워드를 누르면 해당 게시글을 볼 수 있습니다."
              actions={
                <Button intent="quiet" asChild>
                  <Link to="/posts?match=matched">
                    관심 글 {data.matched}개 보기
                  </Link>
                </Button>
              }
            >
              {data.keywords.length ? (
                <Flex gap="2" wrap="wrap">
                  {data.keywords.map((keyword) => (
                    <Button key={keyword} intent="secondary" asChild>
                      <Link
                        to={`/posts?keyword=${encodeURIComponent(keyword)}`}
                      >
                        {keyword}
                      </Link>
                    </Button>
                  ))}
                </Flex>
              ) : (
                <Empty>아직 발견된 관심 키워드가 없습니다.</Empty>
              )}
            </Section>
            <Section title="여론 분석 상태">
              <Callout.Root>
                <Callout.Text>
                  현재 관심 글 {data.matched}개는 미분류 상태입니다. 긍정·부정은
                  아직 분류하지 않았으며, 키워드 일치 자체가 여론 판단을
                  뜻하지는 않습니다.
                </Callout.Text>
              </Callout.Root>
            </Section>
          </>
        )
      )}
    </>
  );
}
export default function Pokergosu() {
  const { id } = useParams();
  const { pathname } = useLocation();
  return id ? (
    <PostDetail id={id} />
  ) : pathname === "/pokergosu" ? (
    <OpinionOverview />
  ) : (
    <PostList />
  );
}
