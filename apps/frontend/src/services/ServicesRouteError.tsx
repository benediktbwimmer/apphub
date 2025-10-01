import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import {
  SERVICE_ROUTE_ERROR_CONTAINER,
  SERVICE_ROUTE_ERROR_MESSAGE,
  SERVICE_ROUTE_ERROR_TITLE
} from './serviceTokens';

export default function ServicesRouteError() {
  const error = useRouteError();
  const message = resolveMessage(error);

  return (
    <section className="flex flex-col gap-6">
      <div className={SERVICE_ROUTE_ERROR_CONTAINER}>
        <h2 className={SERVICE_ROUTE_ERROR_TITLE}>Unable to load services route</h2>
        <p className={SERVICE_ROUTE_ERROR_MESSAGE}>{message}</p>
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
