import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
function minutesFromHHmm(hhmm) {
    const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m)
        return NaN;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 0 || h > 24 || mi < 0 || mi > 59)
        return NaN;
    return h * 60 + mi; // 24:00 -> 1440 (exclusive upper-bound)
}
function dayIndexToName(idx) {
    // dayjs().day(): 0=Sunday .. 6=Saturday
    const map = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
    ];
    return map[idx];
}
export class ProgramScheduleService {
    static instance = null;
    schedule = null;
    static getInstance() {
        if (!ProgramScheduleService.instance) {
            ProgramScheduleService.instance = new ProgramScheduleService();
        }
        return ProgramScheduleService.instance;
    }
    loadSchedule() {
        if (this.schedule)
            return this.schedule;
        const schedulePath = path.resolve(process.cwd(), 'src', 'data', 'schedule.json');
        const raw = fs.readFileSync(schedulePath, 'utf8');
        const json = JSON.parse(raw);
        this.schedule = json;
        return json;
    }
    resolveProgram(at) {
        const d = dayjs(at);
        if (!d.isValid())
            return null;
        const sched = this.loadSchedule();
        const dayName = dayIndexToName(d.day());
        const blocks = sched[dayName] || [];
        const minutesNow = d.hour() * 60 + d.minute();
        for (const block of blocks) {
            const start = minutesFromHHmm(block.start);
            const end = minutesFromHHmm(block.end);
            if (Number.isNaN(start) || Number.isNaN(end))
                continue;
            // Inclusive start, exclusive end; support 24:00 as end-of-day
            if (minutesNow >= start && minutesNow < end) {
                return block.show;
            }
        }
        return null;
    }
}
