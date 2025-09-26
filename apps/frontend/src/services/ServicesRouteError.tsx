import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

export default function ServicesRouteError() {
  const error = useRouteError();
  const message = resolveMessage(error);

  return (
    <section className="flex flex-col gap-6">
      <div className="rounded-3xl border border-rose-300/70 bg-rose-50/80 p-6 text-left shadow-[0_20px_60px_-40px_rgba(244,63,94,0.5)] backdrop-blur-md dark:border-rose-500/50 dark:bg-rose-500/10">
        <h2 className="text-lg font-semibold text-rose-700 dark:text-rose-300">Unable to load services route</h2>
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-200">{message}</p>
      </div>
    </section>
  );
}

function resolveMessage(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'An unexpected error occurred while loading this section.';
}
