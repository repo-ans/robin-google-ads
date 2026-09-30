import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 text-ink">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <Link to="/" className="mt-4 inline-block text-sm text-ink-subtle hover:underline">
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
