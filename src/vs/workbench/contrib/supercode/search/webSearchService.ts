/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Web Search Service for Real-time Information
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

// ============================================================================
// TYPES
// ============================================================================

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
    source: 'web' | 'npm' | 'pypi' | 'stackoverflow';
}

export interface SearchResponse {
    query: string;
    results: WebSearchResult[];
    cached: boolean;
    timestamp: number;
}

export interface PackageInfo {
    name: string;
    version: string;
    description: string;
    homepage: string;
    documentation: string;
}

export interface StackOverflowAnswer {
    questionId: number;
    title: string;
    link: string;
    score: number;
    answerCount: number;
    isAnswered: boolean;
    tags: string[];
}

// ============================================================================
// WEB SEARCH SERVICE
// ============================================================================

export class WebSearchService {
    private _searchCache: Map<string, SearchResponse> = new Map();
    private _tavilyApiKey: string = '';

    constructor(
        @ILogService private readonly logService: ILogService,
        @IStorageService private readonly storageService: IStorageService
    ) {
        this.loadApiKey();
        this.logService.info('[WebSearch] Service initialized');
    }

    // ========================================================================
    // GENERAL WEB SEARCH (Tavily)
    // ========================================================================

    /**
     * Search the web using Tavily API
     */
    public async searchWeb(query: string): Promise<WebSearchResult[]> {
        // Check cache first
        const cached = this._searchCache.get(query);
        if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hour cache
            this.logService.debug('[WebSearch] Cache hit for:', query);
            return cached.results;
        }

        if (!this._tavilyApiKey) {
            this.logService.warn('[WebSearch] Tavily API key not set');
            return [];
        }

        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: this._tavilyApiKey,
                    query,
                    search_depth: 'basic',
                    max_results: 5
                })
            });

            if (!response.ok) {
                throw new Error(`Tavily API error: ${response.status}`);
            }

            const data = await response.json();
            const results: WebSearchResult[] = (data.results || []).map((r: any) => ({
                title: r.title,
                url: r.url,
                snippet: r.content?.substring(0, 300) || '',
                source: 'web' as const
            }));

            // Cache results
            this._searchCache.set(query, {
                query,
                results,
                cached: false,
                timestamp: Date.now()
            });

            return results;
        } catch (error) {
            this.logService.error('[WebSearch] Search failed:', error);
            return [];
        }
    }

    // ========================================================================
    // NPM PACKAGE SEARCH
    // ========================================================================

    /**
     * Search npm registry for package information
     */
    public async searchNpm(packageName: string): Promise<PackageInfo | null> {
        try {
            const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            const latest = data['dist-tags']?.latest;
            const latestVersion = data.versions?.[latest] || {};

            return {
                name: data.name,
                version: latest || 'unknown',
                description: data.description || '',
                homepage: data.homepage || latestVersion.homepage || '',
                documentation: `https://www.npmjs.com/package/${data.name}`
            };
        } catch (error) {
            this.logService.error('[WebSearch] npm search failed:', error);
            return null;
        }
    }

    // ========================================================================
    // PYPI PACKAGE SEARCH
    // ========================================================================

    /**
     * Search PyPI for Python package information
     */
    public async searchPyPI(packageName: string): Promise<PackageInfo | null> {
        try {
            const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`);

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            const info = data.info || {};

            return {
                name: info.name,
                version: info.version || 'unknown',
                description: info.summary || '',
                homepage: info.home_page || info.project_url || '',
                documentation: info.docs_url || `https://pypi.org/project/${info.name}/`
            };
        } catch (error) {
            this.logService.error('[WebSearch] PyPI search failed:', error);
            return null;
        }
    }

    // ========================================================================
    // STACK OVERFLOW SEARCH
    // ========================================================================

    /**
     * Search Stack Overflow for relevant questions
     */
    public async searchStackOverflow(query: string): Promise<StackOverflowAnswer[]> {
        try {
            const encodedQuery = encodeURIComponent(query);
            const response = await fetch(
                `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodedQuery}&site=stackoverflow&filter=!nNPvSNPI7A`
            );

            if (!response.ok) {
                throw new Error(`Stack Overflow API error: ${response.status}`);
            }

            const data = await response.json();
            const items = data.items || [];

            return items.slice(0, 5).map((item: any) => ({
                questionId: item.question_id,
                title: item.title,
                link: item.link,
                score: item.score,
                answerCount: item.answer_count,
                isAnswered: item.is_answered,
                tags: item.tags || []
            }));
        } catch (error) {
            this.logService.error('[WebSearch] Stack Overflow search failed:', error);
            return [];
        }
    }

    /**
     * Search for error message on Stack Overflow
     */
    public async searchError(errorMessage: string): Promise<StackOverflowAnswer[]> {
        // Clean up error message for better search
        const cleanedError = errorMessage
            .replace(/at\s+.*:\d+:\d+/g, '') // Remove stack trace lines
            .replace(/['"]/g, '') // Remove quotes
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim()
            .substring(0, 200); // Limit length

        return this.searchStackOverflow(cleanedError);
    }

    // ========================================================================
    // AUTO-DETECT EXTERNAL INFO NEED
    // ========================================================================

    /**
     * Detect if the prompt needs external information
     */
    public needsExternalInfo(prompt: string): { needsSearch: boolean; searchType: string; query: string } {
        const lowerPrompt = prompt.toLowerCase();

        // Detect latest/recent feature queries
        const latestPatterns = [
            /(?:latest|newest|recent|new)\s+(?:features?|updates?|changes?)\s+(?:in|for|of)\s+(\w+)/i,
            /what(?:'s| is) new in\s+(\w+(?:\s+\d+)?)/i,
            /(\w+)\s+(?:\d+\.\d+|\d{4})\s+(?:features?|release)/i
        ];

        for (const pattern of latestPatterns) {
            const match = prompt.match(pattern);
            if (match) {
                return { needsSearch: true, searchType: 'web', query: match[0] };
            }
        }

        // Detect package documentation queries
        const packagePatterns = [
            /how\s+(?:to|do\s+i)\s+(?:use|install|import)\s+(\w+(?:-\w+)*)/i,
            /(\w+(?:-\w+)*)\s+(?:documentation|docs|api|usage)/i
        ];

        for (const pattern of packagePatterns) {
            const match = prompt.match(pattern);
            if (match) {
                return { needsSearch: true, searchType: 'package', query: match[1] };
            }
        }

        // Detect error messages
        if (lowerPrompt.includes('error:') || lowerPrompt.includes('exception') ||
            lowerPrompt.includes('traceback') || /\w+error/i.test(prompt)) {
            return { needsSearch: true, searchType: 'stackoverflow', query: prompt.substring(0, 200) };
        }

        return { needsSearch: false, searchType: '', query: '' };
    }

    /**
     * Format search results for AI context
     */
    public formatResultsForContext(results: WebSearchResult[]): string {
        if (results.length === 0) {
            return '';
        }

        let context = '\n## Web Search Results\n';
        for (const result of results) {
            context += `### ${result.title}\n`;
            context += `Source: ${result.url}\n`;
            context += `${result.snippet}\n\n`;
        }

        return context;
    }

    // ========================================================================
    // API KEY MANAGEMENT
    // ========================================================================

    public setTavilyApiKey(key: string): void {
        this._tavilyApiKey = key;
        this.storageService.store('supercode.tavilyApiKey', key, StorageScope.APPLICATION, StorageTarget.MACHINE);
    }

    private loadApiKey(): void {
        this._tavilyApiKey = this.storageService.get('supercode.tavilyApiKey', StorageScope.APPLICATION) || '';
    }
}
