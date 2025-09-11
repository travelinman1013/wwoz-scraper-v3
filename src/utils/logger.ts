import chalk from 'chalk';
import dayjs from 'dayjs';

function timestamp(): string {
  // Local time in a readable format
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

export class Logger {
  static info(message: string): void {
    console.log(`${timestamp()} ${chalk.blueBright('[INFO]')} ${message}`);
  }

  static warn(message: string): void {
    console.warn(`${timestamp()} ${chalk.yellow('[WARN]')} ${message}`);
  }

  static error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `\n${err.name}: ${err.message}\n${err.stack ?? ''}` : '';
    console.error(`${timestamp()} ${chalk.red('[ERROR]')} ${message}${detail}`);
  }

  static debug(message: string): void {
    // Print debug without the noisy [DEBUG] label
    console.debug(`${timestamp()} ${message}`);
  }
}
