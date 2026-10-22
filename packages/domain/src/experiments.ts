import {
  ExperimentDefinitionSchema,
  ExperimentDefinition,
  ExperimentVariant,
  AccessibilityScenario,
  PREDEFINED_ACCESSIBILITY_SCENARIOS,
} from '@orbit/schemas';
function stableHash(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export interface ExperimentContext {
  accountId: string;
  workspaceId: string;
}

export interface VariantAssignment {
  experimentId: string;
  variant: ExperimentVariant;
}

export function deterministicBucket(accountId: string, experimentId: string): number {
  return stableHash(`${accountId}:${experimentId}`) / Number.MAX_SAFE_INTEGER;
}

export function assignVariant(
  context: ExperimentContext,
  experiment: ExperimentDefinition
): ExperimentVariant {
  const bucket = deterministicBucket(
    context.accountId,
    experiment.id
  );

  let treatmentPercentage = 0.5;
  if (experiment.audience === 'percentage' && experiment.audienceConfig) {
    const config = experiment.audienceConfig as { treatmentPercentage?: number };
    treatmentPercentage = config.treatmentPercentage ?? 0.5;
  }

  return bucket < treatmentPercentage ? 'treatment' : 'control';
}

export function canRunExperiment(experiment: ExperimentDefinition): boolean {
  const now = new Date();
  if (experiment.startDate && new Date(experiment.startDate) > now) return false;
  if (experiment.endDate && new Date(experiment.endDate) < now) return false;
  return experiment.status === 'running';
}

export function validateExperimentDefinition(def: unknown): { valid: boolean; errors: string[] } {
  const result = ExperimentDefinitionSchema.safeParse(def);
  if (!result.success) {
    return { valid: false, errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`) };
  }
  const exp = result.data;
  const errors: string[] = [];
  if (exp.audience === 'percentage') {
    const config = exp.audienceConfig as { treatmentPercentage?: number } | undefined;
    if (config?.treatmentPercentage !== undefined && (config.treatmentPercentage < 0 || config.treatmentPercentage > 1)) {
      errors.push('treatmentPercentage must be between 0 and 1');
    }
  }
  if (exp.rollbackThreshold && typeof exp.rollbackThreshold === 'object') {
    const threshold = exp.rollbackThreshold as { metric?: string; threshold?: number; direction?: 'above' | 'below' };
    if (threshold.metric && (threshold.threshold === undefined || !['above', 'below'].includes(threshold.direction ?? ''))) {
      errors.push('rollbackThreshold must include metric, threshold, and direction (above/below)');
    }
  }
  return { valid: errors.length === 0, errors };
}

export const EXPERIMENT_FORBIDDEN_PATHS = [
  '/crypto',
  '/keys',
  '/auth',
  '/session',
  '/permissions',
  '/e2ee',
];

export function checkExperimentSafety(experiment: ExperimentDefinition): { safe: boolean; reason?: string } {
  const primaryMetric = experiment.primaryMetric.toLowerCase();
  const hypothesis = experiment.hypothesis.toLowerCase();
  const securityPaths = ['encryption', 'key', 'auth', 'session', 'permission', 'access_control', 'e2ee'];
  if (securityPaths.some(p => primaryMetric.includes(p) || hypothesis.includes(p))) {
    return { safe: false, reason: 'Experiments on security/privacy/encryption paths are forbidden' };
  }
  return { safe: true };
}

export function getAccessibilityScenarios(): AccessibilityScenario[] {
  return [...PREDEFINED_ACCESSIBILITY_SCENARIOS];
}

export function createAccessibilityTestPlan(scenario: AccessibilityScenario): {
  name: string;
  description: string;
  setupSteps: string[];
  testCases: string[];
} {
  switch (scenario) {
    case 'keyboard_only':
      return {
        name: 'Keyboard-Only Navigation',
        description: 'Test all interactive elements are reachable and operable via keyboard',
        setupSteps: ['Disable mouse/trackpad', 'Use Tab, Shift+Tab, Enter, Space, Arrow keys'],
        testCases: [
          'Focus order is logical',
          'All buttons/links trigger on Enter/Space',
          'No keyboard traps',
          'Focus indicators visible',
        ],
      };
    case 'screen_reader':
      return {
        name: 'Screen Reader Compatibility',
        description: 'Test content is properly announced by screen readers',
        setupSteps: ['Enable VoiceOver (macOS/iOS) or NVDA/JAWS (Windows)', 'Navigate with screen reader'],
        testCases: [
          'All images have alt text',
          'Form labels announced correctly',
          'Live regions for dynamic content',
          'Heading hierarchy logical',
        ],
      };
    case 'reduced_motion':
      return {
        name: 'Reduced Motion',
        description: 'Test animations respect prefers-reduced-motion',
        setupSteps: ['Enable "Reduce Motion" in OS accessibility settings'],
        testCases: [
          'Transitions disabled or instant',
          'Auto-playing animations paused',
          'Parallax effects disabled',
        ],
      };
    case 'low_bandwidth':
      return {
        name: 'Low Bandwidth',
        description: 'Test functionality on slow connections',
        setupSteps: ['Throttle network to 3G/Slow 3G in DevTools'],
        testCases: [
          'Critical content loads first',
          'Images lazy-loaded',
          'Graceful degradation of media',
          'Offline fallback shown',
        ],
      };
    case 'small_screen':
      return {
        name: 'Small Screen',
        description: 'Test layout on mobile/small viewports',
        setupSteps: ['Resize viewport to 320px width', 'Test in mobile device simulator'],
        testCases: [
          'No horizontal scrolling',
          'Touch targets >= 44x44px',
          'Text readable without zoom',
          'Navigation accessible',
        ],
      };
    case 'low_end_device':
      return {
        name: 'Low-End Device',
        description: 'Test performance on constrained hardware',
        setupSteps: ['Enable CPU throttling (4x/6x) in DevTools', 'Limit memory'],
        testCases: [
          'UI remains responsive',
          'No jank on scroll/interaction',
          'Memory usage stable',
          'Battery drain minimal',
        ],
      };
    default:
      return {
        name: scenario,
        description: '',
        setupSteps: [],
        testCases: [],
      };
  }
}
