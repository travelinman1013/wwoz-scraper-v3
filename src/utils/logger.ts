import chalk from 'chalk';

function timestamp(): string {
  return new Date().toISOString();
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
    console.debug(`${timestamp()} ${chalk.magenta('[DEBUG]')} ${message}`);
  }
}

