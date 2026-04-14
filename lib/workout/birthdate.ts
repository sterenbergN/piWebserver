function padDatePart(value: string) {
  return value.padStart(2, '0');
}

function isValidMonthDay(month: string, day: string) {
  const monthNumber = Number(month);
  const dayNumber = Number(day);

  return (
    Number.isInteger(monthNumber) &&
    Number.isInteger(dayNumber) &&
    monthNumber >= 1 &&
    monthNumber <= 12 &&
    dayNumber >= 1 &&
    dayNumber <= 31
  );
}

export function normalizeBirthdate(value: unknown): string {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  if (!trimmed) return '';

  const yearFirstMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (yearFirstMatch) {
    const [, year, month, day] = yearFirstMatch;
    if (!isValidMonthDay(month, day)) return trimmed;
    return `${padDatePart(month)}-${padDatePart(day)}-${year}`;
  }

  const monthFirstMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (monthFirstMatch) {
    const [, month, day, year] = monthFirstMatch;
    if (!isValidMonthDay(month, day)) return trimmed;
    return `${padDatePart(month)}-${padDatePart(day)}-${year}`;
  }

  return trimmed;
}

export function parseBirthdateParts(value: unknown): { month: number; day: number; year: number } | null {
  const normalized = normalizeBirthdate(value);
  const match = normalized.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;

  return { month, day, year };
}
