import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface BuildIdentity {
  buildId: string;
  buildSha: string | null;
  buildDirty: boolean | null;
  builtAt: string;
}

// Explicit deployment metadata wins over the optional local checkout revision.
export const DEPLOYMENT_SHA_ENV_KEYS = [
  'BUILD_SHA', 'COMMIT_SHA', 'GITHUB_SHA', 'CI_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA', 'CF_PAGES_COMMIT_SHA', 'COMMIT_REF',
  'BUILD_SOURCEVERSION', 'SOURCE_VERSION', 'GIT_COMMIT',
] as const;

function validSha(value: string | undefined): string | null {
  const sha = value?.trim();
  return sha && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha) ? sha : null;
}

export function resolveBuildIdentity(cwd: string, env: NodeJS.ProcessEnv = process.env): BuildIdentity {
  const deploymentSha = DEPLOYMENT_SHA_ENV_KEYS.map(key => validSha(env[key])).find(Boolean) || null;
  let gitSha: string | null = null;
  let buildDirty: boolean | null = null;
  const git = (args: string[]) => execFileSync('git', args, {
    cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  try {
    gitSha = validSha(git(['rev-parse', 'HEAD']));
    if (gitSha) {
      try { buildDirty = Boolean(git(['status', '--porcelain'])); }
      catch { /* A checkout with unreadable status has unknown dirty state. */ }
    }
  } catch { /* Git or checkout metadata may be absent in deployment archives. */ }
  const buildSha = deploymentSha || gitSha;
  const builtAt = new Date().toISOString();
  // Vite evaluates this once and shares the returned identity across constants and metadata.
  // UUID prevents collisions even for builds started in the same millisecond without a SHA.
  return { buildSha, buildDirty, builtAt, buildId: `${buildSha || 'build'}-${builtAt}-${randomUUID()}` };
}
