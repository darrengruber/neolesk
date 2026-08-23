export class RequestBodyTooLargeError extends Error {
    constructor(readonly limit: number) {
        super(`Request body exceeds ${limit} bytes`);
        this.name = 'RequestBodyTooLargeError';
    }
}

export const limitRequestBody = async (request: Request, maxBytes: number): Promise<Request> => {
    if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return request;
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new RequestBodyTooLargeError(maxBytes);
    }

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            throw new RequestBodyTooLargeError(maxBytes);
        }
        chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: body.buffer,
        redirect: request.redirect,
    });
};
