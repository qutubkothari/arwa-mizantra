export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getApiOrigin(): string {
  const configured = process.env.API_URL || 'http://127.0.0.1:4000';
  return configured.replace(/\/api\/v1\/?$/, '');
}

async function proxy(request: Request, pathSegments: string[]) {
  const apiOrigin = getApiOrigin();
  const incomingUrl = new URL(request.url);

  const targetUrl = new URL(apiOrigin);
  targetUrl.pathname = `/api/v1/${pathSegments.join('/')}`;
  targetUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');

  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  const response = await fetch(targetUrl.toString(), {
    method,
    headers,
    body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: Request, context: { params: { path: string[] } }) {
  return proxy(request, context.params.path);
}

export async function POST(request: Request, context: { params: { path: string[] } }) {
  return proxy(request, context.params.path);
}

export async function PUT(request: Request, context: { params: { path: string[] } }) {
  return proxy(request, context.params.path);
}

export async function PATCH(request: Request, context: { params: { path: string[] } }) {
  return proxy(request, context.params.path);
}

export async function DELETE(request: Request, context: { params: { path: string[] } }) {
  return proxy(request, context.params.path);
}

export async function OPTIONS(request: Request, context: { params: { path: string[] } }) {
  return proxy(request, context.params.path);
}

export async function HEAD(request: Request, context: { params: { path: string[] } }) {
  return proxy(request, context.params.path);
}
