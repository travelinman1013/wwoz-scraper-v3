import chalk from 'chalk';
function timestamp() {
    return new Date().toISOString();
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
        console.debug(`${timestamp()} ${chalk.magenta('[DEBUG]')} ${message}`);
    }
}
