import { useQuery } from '@tanstack/react-query';
import { listExamples } from '@/services/example';

/**
 * 샘플 페이지 — TanStack Query 로 서버 데이터를 가져오는 최소 예시.
 * 페이지는 App.tsx 에서 React.lazy 로 등록된다.
 */
export default function Home() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['example', 'list'],
    queryFn: listExamples,
  });

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">공통 코어 스켈레톤</h1>
      <p className="mt-2 text-gray-600">
        이 저장소를 복사해서 새 프로젝트를 시작합니다. 자세한 규칙은 README 참고.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Examples</h2>
        {isLoading && <p className="text-gray-400">불러오는 중…</p>}
        {isError && <p className="text-red-500">불러오지 못했습니다.</p>}
        {data && data.length === 0 && <p className="text-gray-400">아직 없습니다.</p>}
        <ul className="mt-2 list-disc pl-5">
          {data?.map((e) => (
            <li key={e.id}>{e.name}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
