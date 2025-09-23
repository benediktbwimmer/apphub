import { gunzipSync } from 'fflate';

const TAR_BLOCK_SIZE = 512;

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.cjs',
  '.mjs',
  '.json',
  '.md',
  '.txt',
  '.yaml',
  '.yml'
]);

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

export type BundleArchiveFile = {
  path: string;
  contents: string;
  encoding: 'utf8' | 'base64';
  executable: boolean;
};

function isGzipBuffer(buffer: Uint8Array): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function readNullTerminatedString(bytes: Uint8Array): string {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) {
    end += 1;
  }
  if (end === 0) {
    return '';
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes.subarray(0, end));
}

function parseOctal(bytes: Uint8Array): number {
  const raw = readNullTerminatedString(bytes).trim();
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProbableText(data: Uint8Array, path: string): boolean {
  const extensionIndex = path.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? path.slice(extensionIndex).toLowerCase() : '';
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  if (data.length === 0) {
    return true;
  }
  const sample = data.subarray(0, Math.min(data.length, 512));
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
  }
  return true;
}

function uint8ToBase64(data: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.length));
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  const globalBuffer = (globalThis as unknown as {
    Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(data).toString('base64');
  }
  let result = '';
  for (let index = 0; index < data.length; index += 3) {
    const byte1 = data[index];
    const byte2 = index + 1 < data.length ? data[index + 1] : undefined;
    const byte3 = index + 2 < data.length ? data[index + 2] : undefined;

    const enc1 = byte1 >> 2;
    const enc2 = ((byte1 & 0x03) << 4) | ((byte2 ?? 0) >> 4);
    let enc3 = byte2 !== undefined ? ((byte2 & 0x0f) << 2) | ((byte3 ?? 0) >> 6) : 64;
    let enc4 = byte3 !== undefined ? byte3 & 0x3f : 64;

    if (byte2 === undefined) {
      enc3 = 64;
      enc4 = 64;
    } else if (byte3 === undefined) {
      enc4 = 64;
    }

    result +=
      BASE64_CHARS.charAt(enc1) +
      BASE64_CHARS.charAt(enc2) +
      BASE64_CHARS.charAt(enc3) +
      BASE64_CHARS.charAt(enc4);
  }
  return result;
}

function decodeTarHeaderName(header: Uint8Array): string {
  const name = readNullTerminatedString(header.subarray(0, 100));
  const prefix = readNullTerminatedString(header.subarray(345, 500));
  if (prefix) {
    return `${prefix}/${name}`;
  }
  return name;
}

function isEmptyBlock(block: Uint8Array): boolean {
  for (let index = 0; index < block.length; index += 1) {
    if (block[index] !== 0) {
      return false;
    }
  }
  return true;
}

export function extractBundleArchive(input: Uint8Array): BundleArchiveFile[] {
  const payload = isGzipBuffer(input) ? gunzipSync(input) : input;
  const files: BundleArchiveFile[] = [];
  const decoder = new TextDecoder('utf-8');
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= payload.length) {
    const header = payload.subarray(offset, offset + TAR_BLOCK_SIZE);
    offset += TAR_BLOCK_SIZE;

    if (isEmptyBlock(header)) {
      break;
    }

    const name = decodeTarHeaderName(header);
    const typeFlag = header[156];
    const size = parseOctal(header.subarray(124, 136));
    const mode = parseOctal(header.subarray(100, 108));
    if (offset + size > payload.length) {
      break;
    }
    const fileData = payload.subarray(offset, offset + size);
    const paddedSize = Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    offset += paddedSize;

    if (!name || name.endsWith('/')) {
      continue;
    }

    // Type flag of '5' indicates directory; skip non-regular files.
    const isDirectory = typeFlag === 53; // '5'
    const isRegularFile = typeFlag === 0 || typeFlag === 48; // null or '0'
    if (isDirectory || !isRegularFile) {
      continue;
    }

    const executable = (mode & 0o111) !== 0;
    const text = isProbableText(fileData, name);
    const contents = text ? decoder.decode(fileData) : uint8ToBase64(fileData);
    const encoding: BundleArchiveFile['encoding'] = text ? 'utf8' : 'base64';

    files.push({
      path: name,
      contents,
      encoding,
      executable
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}
