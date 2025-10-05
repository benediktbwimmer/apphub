export interface CancelablePromiseLike<T> extends Promise<T> {
  cancel: () => void;
}

export function resolveCancelable<T>(promise: CancelablePromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    promise.cancel();
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      promise.cancel();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal.addEventListener('abort', abort, { once: true });

    promise
      .then((value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      })
      .catch((error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      });
  });
}

