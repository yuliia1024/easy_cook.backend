import { Test } from 'supertest';

/** A chunk of the AI SDK UI message stream (`data: {...}` lines of the SSE body). */
export interface StreamChunk {
  type: string;
  id?: string;
  delta?: string;
  data?: any;
  errorText?: string;
}

/** Sends a streamed request and returns its chunks; `[DONE]` and keep-alives are dropped. */
export async function readStream(req: Test): Promise<{ status: number; chunks: StreamChunk[] }> {
  const res = await req.buffer(true).parse((stream, callback) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (part: string) => (body += part));
    stream.on('end', () => callback(null, body));
  });
  const chunks = String(res.body)
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)) as StreamChunk);
  return { status: res.status, chunks };
}
