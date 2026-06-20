export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toIsoDateTimeSeconds(date: Date): string {
  return date.toISOString().slice(0, 19);
}

export function isFutureDate(value: string): boolean {
  const parsed = Date.parse(value);

  return Number.isFinite(parsed) && parsed > Date.now();
}

export function compareIsoDates(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return 0;
  }

  if (!Number.isFinite(leftTime)) {
    return 1;
  }

  if (!Number.isFinite(rightTime)) {
    return -1;
  }

  return leftTime - rightTime;
}
