import { API_BASE_URL as BASE_URL } from '../config';
import type { IngestStatus } from './types';

export const API_BASE_URL = BASE_URL;
export const BUILD_PAGE_SIZE = 5;

export const INGEST_STATUSES: IngestStatus[] = ['seed', 'pending', 'processing', 'ready', 'failed'];
