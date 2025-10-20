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
        let detail = '';
        if (err instanceof Error) {
            detail = `\n${err.name}: ${err.message}`;
            // Handle WebapiError from spotify-web-api-node
            const webapiErr = err;
            if (webapiErr.statusCode !== undefined) {
                detail += `\nHTTP Status: ${webapiErr.statusCode}`;
            }
            if (webapiErr.body) {
                try {
                    const bodyStr = typeof webapiErr.body === 'string'
                        ? webapiErr.body
                        : JSON.stringify(webapiErr.body, null, 2);
                    detail += `\nResponse Body: ${bodyStr}`;
                }
                catch {
                    detail += `\nResponse Body: ${String(webapiErr.body)}`;
                }
            }
            if (webapiErr.headers) {
                try {
                    detail += `\nResponse Headers: ${JSON.stringify(webapiErr.headers, null, 2)}`;
                }
                catch {
                    // Skip headers if they can't be stringified
                }
            }
            if (err.stack) {
                detail += `\n${err.stack}`;
            }
        }
        else if (err) {
            try {
                detail = `\n${JSON.stringify(err, null, 2)}`;
            }
            catch {
                detail = `\n${String(err)}`;
            }
        }
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
