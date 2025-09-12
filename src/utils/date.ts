import dayjs from 'dayjs';

// Resolve a song's calendar date using the scraped playedDate when present.
// - Supports M/D, MM/DD, M/D/YY, M/D/YYYY
// - If year is omitted, infer from the reference date's year and roll back a year
//   when the parsed month/day would fall "in the future" relative to the reference.
export function resolveSongDay(playedDate: string | undefined, referenceIso?: string): dayjs.Dayjs {
  const reference = referenceIso ? dayjs(referenceIso) : dayjs();
  const ref = reference.isValid() ? reference : dayjs();

  if (playedDate) {
    const m = playedDate.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) {
      const month = Math.max(1, Math.min(12, parseInt(m[1], 10)));
      const day = Math.max(1, Math.min(31, parseInt(m[2], 10)));
      let year: number | undefined = undefined;
      if (m[3]) {
        const yy = parseInt(m[3], 10);
        year = yy >= 100 ? yy : 2000 + yy; // assume 20xx for 2-digit years
      }

      if (year === undefined) {
        // Start with the reference year; if that date would be after the reference date,
        // assume it belongs to the previous year (cross-year rollover on Jan 1/early Jan).
        let candidate = ref.year(ref.year()).month(month - 1).date(day).startOf('day');
        if (candidate.isAfter(ref, 'day')) {
          candidate = candidate.subtract(1, 'year');
        }
        if (candidate.isValid()) return candidate;
      } else {
        const candidate = dayjs().year(year).month(month - 1).date(day).startOf('day');
        if (candidate.isValid()) return candidate;
      }
    }
  }

  // Fallback: use the reference date's day
  return ref.startOf('day');
}

export function resolveSongDayString(playedDate: string | undefined, referenceIso?: string): string {
  return resolveSongDay(playedDate, referenceIso).format('YYYY-MM-DD');
}

// Build display title: "WWOZ <Weekday>, <Month/full-or-AP-abbrev> <DayOrdinal>, <Year>"
// AP-style month abbreviations: Jan., Feb., Aug., Sept., Oct., Nov., Dec.
function apMonth(monthFull: string): string {
  switch (monthFull) {
    case 'January':
      return 'Jan.';
    case 'February':
      return 'Feb.';
    case 'August':
      return 'Aug.';
    case 'September':
      return 'Sept.';
    case 'October':
      return 'Oct.';
    case 'November':
      return 'Nov.';
    case 'December':
      return 'Dec.';
    default:
      return monthFull; // March, April, May, June, July stay spelled out
  }
}

function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  if (j === 1) return `${n}st`;
  if (j === 2) return `${n}nd`;
  if (j === 3) return `${n}rd`;
  return `${n}th`;
}

export function buildWwozDisplayTitle(d: dayjs.Dayjs): string {
  const dow = d.format('dddd');
  const monthFull = d.format('MMMM');
  const month = apMonth(monthFull);
  const day = ordinal(d.date());
  const year = d.format('YYYY');
  return `WWOZ ${dow}, ${month} ${day}, ${year}`;
}
