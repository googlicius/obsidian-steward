import { logger } from '../utils/logger';

/**
 * Service for managing abort controllers to cancel ongoing operations
 */
export class AbortService {
	private static instance: AbortService;
	private abortControllers: Map<string, AbortController> = new Map();

	/**
	 * Get the singleton instance of the AbortService
	 */
	public static getInstance(): AbortService {
		if (!AbortService.instance) {
			AbortService.instance = new AbortService();
		}
		return AbortService.instance;
	}

	/**
	 * Create a new abort controller for a specific operation
	 * @param operationId Unique identifier for the operation
	 * @returns The abort signal from the created controller
	 */
	public createAbortController(operationId: string): AbortSignal {
		// If an existing controller exists for this operation, abort it first
		if (this.abortControllers.has(operationId)) {
			this.abortOperation(operationId);
		}

		// Create a new abort controller
		const controller = new AbortController();
		this.abortControllers.set(operationId, controller);

		return controller.signal;
	}

	/**
	 * Get an existing abort signal for an operation
	 * @param operationId Unique identifier for the operation
	 * @returns The abort signal or undefined if not found
	 */
	public getAbortSignal(operationId: string): AbortSignal | undefined {
		const controller = this.abortControllers.get(operationId);
		return controller?.signal;
	}

	/**
	 * Get the number of active operations
	 * @returns The count of active operations
	 */
	public getActiveOperationsCount(): number {
		return this.abortControllers.size;
	}

	/**
	 * Abort a specific operation
	 * @param operationId Unique identifier for the operation to abort
	 * @returns true if the operation was aborted, false if not found
	 */
	public abortOperation(operationId: string): boolean {
		const controller = this.abortControllers.get(operationId);

		if (controller) {
			try {
				controller.abort();
				this.abortControllers.delete(operationId);
				logger.log(`Aborted operation: ${operationId}`);
				return true;
			} catch (error) {
				logger.error(`Error aborting operation ${operationId}:`, error);
			}
		}

		return false;
	}

	/**
	 * Abort all ongoing operations
	 */
	public abortAllOperations(): void {
		// Create a copy of the keys to avoid modification during iteration
		const operationIds = Array.from(this.abortControllers.keys());

		// Abort each operation
		for (const operationId of operationIds) {
			this.abortOperation(operationId);
		}
	}
}
