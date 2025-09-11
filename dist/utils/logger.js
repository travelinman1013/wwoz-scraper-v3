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
        // Print debug without the noisy [DEBUG] label
        console.debug(`${timestamp()} ${message}`);
    }
}
