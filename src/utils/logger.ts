const PREFIX = 'Steward:';

/**
 * Logger utility class for consistent logging with debug toggle
 */
export class Logger {
	private isDebugEnabled = false;

	/**
	 * Set the debug mode
	 * @param enabled Whether debug logging is enabled
	 */
	public setDebug(enabled: boolean): void {
		this.isDebugEnabled = enabled;
	}

	/**
	 * Log a debug message (only if debug is enabled)
	 * @param args Arguments to log
	 */
	public log(...args: any[]): void {
		if (this.isDebugEnabled) {
			console.log(`${PREFIX}`, ...args);
		}
	}

	/**
	 * Log an error message (always shown, regardless of debug setting)
	 * @param args Arguments to log
	 */
	public error(...args: any[]): void {
		console.error(`${PREFIX}`, ...args);
	}

	/**
	 * Log a warning message (always shown, regardless of debug setting)
	 * @param args Arguments to log
	 */
	public warn(...args: any[]): void {
		console.warn(`${PREFIX}`, ...args);
	}
}

// Create a singleton instance
export const logger = new Logger();
