import fs from 'fs';
import path from 'path';

type ShowBlock = { start: string; end: string; show: string };
type WeekSchedule = Record<
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
  ShowBlock[]
>;

function minutesFromHHmm(hhmm: string): number {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 24 || mi < 0 || mi > 59) return NaN;
  return h * 60 + mi; // 24:00 -> 1440
}

function weekdayInCentral(date: Date): keyof WeekSchedule {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'America/Chicago',
  }).format(date);
  return weekday.toLowerCase() as keyof WeekSchedule;
}

function hhmmInCentral(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Chicago',
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function splitShowAndHost(raw: string): { show: string; host: string } {
  const s = raw.trim();
  const idx = s.toLowerCase().lastIndexOf(' with ');
  if (idx === -1) return { show: s, host: '' };
  const show = s.slice(0, idx).trim();
  const host = s.slice(idx + ' with '.length).trim();
  return { show: show || s, host };
}

export class ShowGuesser {
  private schedule: WeekSchedule;

  constructor() {
    const schedulePath = path.resolve(process.cwd(), 'src', 'data', 'schedule.json');
    const raw = fs.readFileSync(schedulePath, 'utf8');
    this.schedule = JSON.parse(raw) as WeekSchedule;
  }

  guessShow(timestamp: string | Date): { show: string; host: string } | null {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (isNaN(date.getTime())) return null;

    const day = weekdayInCentral(date);
    const hhmm = hhmmInCentral(date);
    const minutesNow = minutesFromHHmm(hhmm);
    if (Number.isNaN(minutesNow)) return null;

    const blocks = this.schedule[day] || [];
    for (const block of blocks) {
      const start = minutesFromHHmm(block.start);
      const end = minutesFromHHmm(block.end);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (minutesNow >= start && minutesNow < end) {
        return splitShowAndHost(block.show);
      }
    }
    return null;
  }

  /**
   * Guess show using per-row local parts when available.
   * - If playedTime is provided (e.g., "12:49pm" or "23:10"), it is parsed to HH:mm (24h).
   * - If playedDate is provided (e.g., "09/11"), its weekday is computed using the fallback year.
   * - Falls back to the fallback timestamp's Central Time weekday/time when parts are missing.
   */
  guessShowFromLocalParts(
    playedDate: string | undefined,
    playedTime: string | undefined,
    fallbackTimestamp: string | Date
  ): { show: string; host: string } | null {
    const fb = fallbackTimestamp instanceof Date ? fallbackTimestamp : new Date(fallbackTimestamp);
    if (isNaN(fb.getTime())) return null;

    // Resolve fallback day/time in Central
    const fbDay: keyof WeekSchedule = weekdayInCentral(fb);
    const fbHHMM: string = hhmmInCentral(fb);

    const targetHHMM = normalizeTo24h(playedTime) || fbHHMM;
    const targetDay: keyof WeekSchedule = (() => {
      const md = parseMonthDay(playedDate);
      if (!md) return fbDay;
      // Use the fallback year; day of week for a calendar date is timezone-agnostic
      const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Chicago' })
        .formatToParts(fb)
        .find((p) => p.type === 'year')?.value;
      const y = Number(year || new Date().getFullYear());
      const d = new Date(y, md.month - 1, md.day);
      const weekday = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      return weekday as keyof WeekSchedule;
    })();

    const blocks = this.schedule[targetDay] || [];
    const minutesNow = minutesFromHHmm(targetHHMM);
    if (Number.isNaN(minutesNow)) return null;

    for (const block of blocks) {
      const start = minutesFromHHmm(block.start);
      const end = minutesFromHHmm(block.end);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (minutesNow >= start && minutesNow < end) {
        return splitShowAndHost(block.show);
      }
    }
    return null;
  }
}

function parseMonthDay(input?: string): { month: number; day: number } | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function normalizeTo24h(input?: string): string | null {
  if (!input) return null;
  // Normalize: lowercase, drop periods (a.m. -> am), collapse spaces
  const s = input.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  // 12-hour clock with am/pm
  let m = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (m) {
    let h = Number(m[1]);
    const mi = Number(m[2]);
    const ampm = m[3].toLowerCase();
    if (h < 1 || h > 12 || mi < 0 || mi > 59) return null;
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  // 24-hour clock
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  return null;
}
