import chalk from 'chalk';
import dayjs from 'dayjs';
function timestamp() {
    // Local time in a readable format
    return dayjs().format('YYYY-MM-DD HH:mm:ss');
}
export class Logger {
    static info(message) {
        console.log(`${timestamp()} ${chalk.blueBright('[INFO]')} ${message}`);
    }
    static warn(message) {
        console.warn(`${timestamp()} ${chalk.yellow('[WARN]')} ${message}`);
    }
    static error(message, err) {
        const detail = err instanceof Error ? `\n${err.name}: ${err.message}\n${err.stack ?? ''}` : '';
        console.error(`${timestamp()} ${chalk.red('[ERROR]')} ${message}${detail}`);
    }
    static debug(message) {
        // Only emit debug logs when LOG_LEVEL=debug or DEBUG is truthy
        const ll = (process.env.LOG_LEVEL || '').toLowerCase();
        const dbg = (process.env.DEBUG || '').toLowerCase();
        const debugEnabled = ll === 'debug' || dbg === '1' || dbg === 'true' || dbg === 'yes' || dbg === 'on';
        if (!debugEnabled)
            return;
        // Print debug without the noisy [DEBUG] label
        console.debug(`${timestamp()} ${message}`);
    }
}
