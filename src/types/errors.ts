export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ConsecutiveDuplicatesError extends Error {
  public readonly count: number;
  constructor(count: number) {
    super(`Encountered ${count} consecutive duplicate tracks.`);
    this.name = 'ConsecutiveDuplicatesError';
    this.count = count;
  }
}
