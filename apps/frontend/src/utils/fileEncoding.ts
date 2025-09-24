export async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export type EncodedFilePayload = {
  data: string;
  filename?: string;
  contentType?: string;
};

export async function fileToEncodedPayload(file: File): Promise<EncodedFilePayload> {
  return {
    data: await fileToBase64(file),
    filename: file.name,
    contentType: file.type || undefined
  };
}
