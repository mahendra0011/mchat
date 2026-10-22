const E2EE_SUPPORTED_KINDS = new Set<string>(['direct', 'group']);

export function hasE2EEForMode(kind: string): boolean {
  return E2EE_SUPPORTED_KINDS.has(kind);
}

export function getE2EEDescription(kind: string): string {
  return hasE2EEForMode(kind)
    ? 'End-to-end encrypted'
    : 'Not end-to-end encrypted';
}
