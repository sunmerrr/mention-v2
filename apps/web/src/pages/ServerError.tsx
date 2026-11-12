import { Link } from 'react-router-dom';

/** 500 페이지 — 서버 오류 안내. 라우트로 직접 진입하거나 에러 처리에서 이동. */
export default function ServerError() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">일시적인 오류가 발생했어요</h1>
      <p className="text-gray-600">잠시 후 다시 시도해주세요.</p>
      <Link to="/" className="text-blue-600 underline">
        홈으로
      </Link>
    </main>
  );
}
