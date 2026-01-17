export function calculatePortOffset(instanceId: string): number {
  if (!instanceId) return 0;

  // djb2 hash - deterministic string hash that spreads well
  let hash = 0;
  for (let i = 0; i < instanceId.length; i++) {
    hash = (hash << 5) - hash + instanceId.charCodeAt(i);
    hash = hash & hash;
  }

  // Range 1-999 (never 0 to ensure offset instances differ from default)
  return (Math.abs(hash) % 999) + 1;
}

export function resolvePort(basePort: number, instanceId: string): number {
  return basePort + calculatePortOffset(instanceId);
}
