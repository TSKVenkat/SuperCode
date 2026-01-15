/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Network Resilience with Model Fallback
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ModelFallbackConfig {
    models: string[];
    maxRetries: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
}

export interface CachedResponse {
    prompt: string;
    response: string;
    modelId: string;
    timestamp: number;
    ttlMs: number;
}

export interface RetryState {
    attempt: number;
    lastError: string;
    backoffMs: number;
}

// ============================================================================
// DEFAULT FALLBACK CHAIN
// ============================================================================

const DEFAULT_FALLBACK_CHAIN: string[] = [
    'openrouter:qwen/qwen-2.5-coder-32b-instruct:free',
    'openrouter:deepseek/deepseek-r1:free',
    'openrouter:meta-llama/llama-3.3-70b-instruct:free',
    'openrouter:google/gemma-2-9b-it:free',
    'openrouter:mistralai/mistral-7b-instruct:free'
];

// ============================================================================
// MODEL FALLBACK SERVICE
// ============================================================================

export class ModelFallbackService {
    private _currentModelIndex: number = 0;
    private _retryState: RetryState = { attempt: 0, lastError: '', backoffMs: 1000 };
    private _responseCache: Map<string, CachedResponse> = new Map();
    private _config: ModelFallbackConfig;

    constructor(
        @ILogService private readonly logService: ILogService,
        @IStorageService private readonly storageService: IStorageService,
        config?: Partial<ModelFallbackConfig>
    ) {
        this._config = {
            models: config?.models || DEFAULT_FALLBACK_CHAIN,
            maxRetries: config?.maxRetries || 3,
            initialBackoffMs: config?.initialBackoffMs || 1000,
            maxBackoffMs: config?.maxBackoffMs || 30000
        };

        this.loadCache();
        this.logService.info('[ModelFallback] Service initialized with', this._config.models.length, 'fallback models');
    }

    /**
     * Get current model or next fallback
     */
    public getCurrentModel(): string {
        return this._config.models[this._currentModelIndex] || this._config.models[0];
    }

    /**
     * Switch to next model in fallback chain
     */
    public switchToNextModel(): string | null {
        this._currentModelIndex++;
        if (this._currentModelIndex >= this._config.models.length) {
            this._currentModelIndex = 0; // Wrap around
            this.logService.warn('[ModelFallback] All models exhausted, starting over');
            return null;
        }

        const nextModel = this._config.models[this._currentModelIndex];
        this.logService.info('[ModelFallback] Switching to model:', nextModel);
        return nextModel;
    }

    /**
     * Reset fallback state (after successful request)
     */
    public resetState(): void {
        this._currentModelIndex = 0;
        this._retryState = { attempt: 0, lastError: '', backoffMs: this._config.initialBackoffMs };
    }

    /**
     * Check if error is retryable
     */
    public isRetryableError(error: Error | string): boolean {
        const errorStr = typeof error === 'string' ? error : error.message;
        const retryablePatterns = [
            '404', 'Not Found',
            '429', 'Rate limit',
            '500', '502', '503', '504',
            'timeout', 'TIMEOUT',
            'network', 'ECONNREFUSED', 'ENOTFOUND',
            'fetch failed', 'Failed to fetch'
        ];

        return retryablePatterns.some(pattern => errorStr.includes(pattern));
    }

    /**
     * Get backoff delay for next retry
     */
    public getBackoffDelay(): number {
        const delay = Math.min(
            this._retryState.backoffMs * Math.pow(2, this._retryState.attempt),
            this._config.maxBackoffMs
        );
        this._retryState.attempt++;
        return delay;
    }

    /**
     * Should auto-switch model based on error?
     */
    public shouldSwitchModel(error: Error | string): boolean {
        const errorStr = typeof error === 'string' ? error : error.message;

        // 404 = model not found, definitely switch
        if (errorStr.includes('404') || errorStr.includes('Not Found')) {
            return true;
        }

        // Too many retries on same model
        if (this._retryState.attempt >= this._config.maxRetries) {
            return true;
        }

        return false;
    }

    /**
     * Execute request with automatic fallback
     */
    public async executeWithFallback<T>(
        requestFn: (modelId: string) => Promise<T>,
        onFallback?: (fromModel: string, toModel: string, error: string) => void
    ): Promise<T> {
        let lastError: Error | null = null;
        let attempts = 0;
        const maxTotalAttempts = this._config.models.length * this._config.maxRetries;

        while (attempts < maxTotalAttempts) {
            const currentModel = this.getCurrentModel();

            try {
                const result = await requestFn(currentModel);
                this.resetState();
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this._retryState.lastError = lastError.message;
                attempts++;

                this.logService.warn(`[ModelFallback] Request failed (attempt ${attempts}):`, lastError.message);

                if (!this.isRetryableError(lastError)) {
                    throw lastError;
                }

                if (this.shouldSwitchModel(lastError)) {
                    const previousModel = currentModel;
                    const nextModel = this.switchToNextModel();

                    if (nextModel && onFallback) {
                        onFallback(previousModel, nextModel, lastError.message);
                    }

                    this._retryState.attempt = 0;
                } else {
                    const delay = this.getBackoffDelay();
                    this.logService.info(`[ModelFallback] Retrying in ${delay}ms...`);
                    await this.delay(delay);
                }
            }
        }

        throw lastError || new Error('All models failed after maximum attempts');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========================================================================
    // OFFLINE CACHE
    // ========================================================================

    /**
     * Cache a response for offline access
     */
    public cacheResponse(prompt: string, response: string, modelId: string, ttlMs: number = 3600000): void {
        const hash = this.hashPrompt(prompt);
        const cached: CachedResponse = {
            prompt: prompt.substring(0, 200), // Store truncated prompt
            response,
            modelId,
            timestamp: Date.now(),
            ttlMs
        };

        this._responseCache.set(hash, cached);
        this.saveCache();
        this.logService.debug('[ModelFallback] Cached response for prompt hash:', hash);
    }

    /**
     * Get cached response if available
     */
    public getCachedResponse(prompt: string): CachedResponse | null {
        const hash = this.hashPrompt(prompt);
        const cached = this._responseCache.get(hash);

        if (!cached) return null;

        // Check TTL
        if (Date.now() - cached.timestamp > cached.ttlMs) {
            this._responseCache.delete(hash);
            return null;
        }

        this.logService.debug('[ModelFallback] Cache hit for prompt hash:', hash);
        return cached;
    }

    /**
     * Check if we have a cached response
     */
    public hasCachedResponse(prompt: string): boolean {
        return this.getCachedResponse(prompt) !== null;
    }

    private hashPrompt(prompt: string): string {
        // Simple hash for prompts
        let hash = 0;
        for (let i = 0; i < prompt.length; i++) {
            const char = prompt.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'cache_' + Math.abs(hash).toString(36);
    }

    private loadCache(): void {
        try {
            const stored = this.storageService.get('supercode.responseCache', StorageScope.WORKSPACE);
            if (stored) {
                const entries = JSON.parse(stored);
                this._responseCache = new Map(entries);
            }
        } catch {
            this._responseCache = new Map();
        }
    }

    private saveCache(): void {
        try {
            // Keep only last 100 entries
            const entries = [...this._responseCache.entries()].slice(-100);
            this.storageService.store(
                'supercode.responseCache',
                JSON.stringify(entries),
                StorageScope.WORKSPACE,
                StorageTarget.MACHINE
            );
        } catch (error) {
            this.logService.error('[ModelFallback] Failed to save cache:', error);
        }
    }

    /**
     * Get user-friendly status message (no ugly errors!)
     */
    public getStatusMessage(): string {
        if (this._retryState.attempt === 0) {
            return '';
        }

        if (this._currentModelIndex > 0) {
            return `Switched to ${this.getCurrentModel().split('/').pop()}...`;
        }

        return 'Retrying...';
    }
}
