export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
export class ConsecutiveDuplicatesError extends Error {
    count;
    constructor(count) {
        super(`Encountered ${count} consecutive duplicate tracks.`);
        this.name = 'ConsecutiveDuplicatesError';
        this.count = count;
    }
}
