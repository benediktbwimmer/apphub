/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom/vitest" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_TIMESTORE_BASE_URL?: string;
  readonly VITE_METASTORE_BASE_URL?: string;
  readonly VITE_FILESTORE_BASE_URL?: string;
  readonly VITE_DEMO_OPERATOR_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
