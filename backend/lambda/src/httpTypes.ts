// Minimal request/response shapes for a Lambda Function URL (which uses the
// API Gateway v2 HTTP API payload format). Hand-rolled instead of pulling in
// @types/aws-lambda so each handler bundle stays dependency-light — Function
// URLs are simple enough that the two fields below cover every handler here.

export interface LambdaHttpEvent {
  rawPath?: string;
  rawQueryString?: string;
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface LambdaHttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

export function jsonResponse(statusCode: number, data: unknown, extraHeaders?: Record<string, string>): LambdaHttpResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(data),
  };
}

/** Case-insensitive header lookup — Function URLs may lowercase header names. */
export function getHeader(event: LambdaHttpEvent, name: string): string | undefined {
  const headers = event.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}
