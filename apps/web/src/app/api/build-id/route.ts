import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function resolveBuildId(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), '.next', 'BUILD_ID'),
    path.join(process.cwd(), 'apps', 'web', '.next', 'BUILD_ID'),
  ];

  for (const candidate of candidates) {
    try {
      const value = await fs.readFile(candidate, 'utf8');
      const normalized = String(value || '').trim();
      if (normalized) return normalized;
    } catch {
    }
  }

  return 'development';
}

export async function GET() {
  const buildId = await resolveBuildId();

  return NextResponse.json(
    { buildId },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      },
    },
  );
}