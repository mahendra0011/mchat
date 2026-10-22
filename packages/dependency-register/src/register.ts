export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type DependencyCategory =
  | 'database'
  | 'cache'
  | 'logging'
  | 'auth'
  | 'crypto'
  | 'testing'
  | 'ui'
  | 'build'
  | 'api'
  | 'cli'
  | 'monitoring'
  | 'scheduling'
  | 'ml'
  | 'feature-flag';

export interface DependencyEntry {
  name: string;
  version: string;
  license: string;
  category: DependencyCategory;
  riskLevel: RiskLevel;
  homepage?: string;
  repo?: string;
  lastUpdated?: string;
}

const CATEGORY_RULES: Array<[RegExp, DependencyCategory]> = [
  [/^pg$|postgres|mysql|mongo|sqlite|prisma|drizzle|db|database/i, 'database'],
  [/redis|cache|memcached/i, 'cache'],
  [/pino|winston|log4|bunyan|logging/i, 'logging'],
  [/jwt|auth|passport|oidc|oauth/i, 'auth'],
  [/crypto|bcrypt|argon|scrypt|aes|cipher/i, 'crypto'],
  [/jest|vitest|mocha|chai|test/i, 'testing'],
  [/react|vite|tailwind|vue|svelte|ui/i, 'ui'],
  [/webpack|tsc|esbuild|rollup|babel|build/i, 'build'],
  [/fastify|express|axios|fetch|http|api/i, 'api'],
  [/commander|yargs|minimist|cli/i, 'cli'],
  [/otel|prometheus|metrics|monitor|telemetry/i, 'monitoring'],
  [/cron|schedule|bull|queue|agenda/i, 'scheduling'],
  [/tensorflow|onnx|ml|torch/i, 'ml'],
  [/flag|launchdarkly|unleash|growthbook/i, 'feature-flag'],
];

export class DependencyRegister {
  private entries = new Map<string, DependencyEntry>();

  registerDependency(
    name: string,
    version: string,
    license: string,
    category: DependencyCategory | string,
    riskLevel: RiskLevel,
    homepage?: string,
    repo?: string,
    lastUpdated?: string
  ): DependencyEntry {
    const resolvedCategory = (category && category !== 'auto'
      ? (category as DependencyCategory)
      : this.categorizeDependency(name)) as DependencyCategory;
    const entry: DependencyEntry = {
      name,
      version,
      license,
      category: resolvedCategory,
      riskLevel,
      homepage,
      repo,
      lastUpdated,
    };
    this.entries.set(name, entry);
    return entry;
  }

  categorizeDependency(name: string): DependencyCategory {
    for (const [pattern, category] of CATEGORY_RULES) {
      if (pattern.test(name)) return category;
    }
    return 'api';
  }

  checkCompatibility(name: string, version: string): boolean {
    if (!/^\d+\.\d+\.\d+/.test(version)) return false;
    const entry = this.entries.get(name);
    if (!entry) return true;
    const [aMajor] = entry.version.split('.');
    const [bMajor] = version.split('.');
    return aMajor === bMajor;
  }

  get(name: string): DependencyEntry | undefined {
    return this.entries.get(name);
  }

  list(): DependencyEntry[] {
    return Array.from(this.entries.values());
  }
}
