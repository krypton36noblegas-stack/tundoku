export const DEFAULT_REQUESTED_COUNT = 8;
export const MAX_REQUESTED_COUNT = 20;

export const normalizeRequestedCount = (value, fallback = DEFAULT_REQUESTED_COUNT) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, MAX_REQUESTED_COUNT);
};
