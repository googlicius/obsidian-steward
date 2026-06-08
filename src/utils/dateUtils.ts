import { getBundledSyncLibSync } from 'src/utils/bundledLibs';

const RELATIVE_TIME_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

/**
 * Parse a frontmatter date value into a Date.
 * Supports ISO strings, timestamps, and natural language via chrono-node.
 */
export function parseFrontmatterDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const isoDate = new Date(value);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const chrono = getBundledSyncLibSync('chrono-node');
  const parsed = chrono.parseDate(value);
  if (parsed) {
    return parsed;
  }

  return null;
}

/**
 * Format a date as relative time (e.g. "5 minutes ago", "yesterday").
 */
export function formatRelativeTime(date: Date, locale = 'en'): string {
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (let i = 0; i < RELATIVE_TIME_UNITS.length; i++) {
    const unit = RELATIVE_TIME_UNITS[i][0];
    const secondsInUnit = RELATIVE_TIME_UNITS[i][1];
    if (Math.abs(diffSec) >= secondsInUnit || unit === 'second') {
      return rtf.format(Math.round(diffSec / secondsInUnit), unit);
    }
  }

  return rtf.format(0, 'second');
}

/**
 * Formats a date in the format 'yyyy-MM-dd_HH-mm-ss'
 * @param date - The date to format (defaults to current date/time)
 * @returns Formatted date string
 */
export function formatDateTime(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}
