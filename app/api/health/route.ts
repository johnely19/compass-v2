import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

const GIT_COMMIT = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const GIT_BRANCH = (() => {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
})();

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    git: GIT_COMMIT,
    branch: GIT_BRANCH,
    uptime: process.uptime() * 1000,
    nodeEnv: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}