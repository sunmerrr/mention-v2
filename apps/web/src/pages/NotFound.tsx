import { Link } from 'react-router-dom';

/** SPA 내부 catch-all(path: '*') 404 페이지. → frontend/error-boundary.md */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">페이지를 찾을 수 없어요</h1>
      <p className="text-gray-600">요청하신 페이지가 없거나 이동되었습니다.</p>
      <Link to="/" className="text-blue-600 underline">
        홈으로
      </Link>
    </main>
  );
}
