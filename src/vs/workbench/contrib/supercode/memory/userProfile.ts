/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  User Memory and Personalization Service
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

// ============================================================================
// TYPES
// ============================================================================

export interface UserPreferences {
    codingStyle: 'functional' | 'oop' | 'mixed';
    preferredLanguages: string[];
    tabSize: number;
    useSemicolons: boolean;
    preferArrowFunctions: boolean;
    preferAsync: boolean;
    testingFramework: string;
    lintingStyle: string;
}

export interface ConversationMemory {
    id: string;
    projectPath: string;
    summary: string;
    topics: string[];
    decisions: string[];
    timestamp: number;
}

export interface CodePattern {
    pattern: string;
    frequency: number;
    examples: string[];
}

export interface UserProfile {
    preferences: UserPreferences;
    conversationHistory: ConversationMemory[];
    learnedPatterns: CodePattern[];
    projectContexts: Map<string, string>;
    lastUpdated: number;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const DEFAULT_PREFERENCES: UserPreferences = {
    codingStyle: 'mixed',
    preferredLanguages: ['typescript', 'javascript'],
    tabSize: 2,
    useSemicolons: true,
    preferArrowFunctions: true,
    preferAsync: true,
    testingFramework: 'jest',
    lintingStyle: 'eslint'
};

// ============================================================================
// MEMORY SERVICE
// ============================================================================

export class UserMemoryService {
    private _profile: UserProfile;
    private _sessionMemory: Map<string, string> = new Map();

    constructor(
        @ILogService private readonly logService: ILogService,
        @IStorageService private readonly storageService: IStorageService
    ) {
        this._profile = this.loadProfile();
        this.logService.info('[UserMemory] Service initialized');
    }

    // ========================================================================
    // PREFERENCE MANAGEMENT
    // ========================================================================

    public getPreferences(): UserPreferences {
        return { ...this._profile.preferences };
    }

    public updatePreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]): void {
        this._profile.preferences[key] = value;
        this._profile.lastUpdated = Date.now();
        this.saveProfile();
        this.logService.info(`[UserMemory] Updated preference: ${key} = ${value}`);
    }

    public updatePreferences(updates: Partial<UserPreferences>): void {
        this._profile.preferences = { ...this._profile.preferences, ...updates };
        this._profile.lastUpdated = Date.now();
        this.saveProfile();
    }

    /**
     * Learn preferences from code samples
     */
    public learnFromCode(code: string): void {
        // Detect tab style
        if (code.includes('    ')) {
            this._profile.preferences.tabSize = 4;
        } else if (code.includes('  ')) {
            this._profile.preferences.tabSize = 2;
        }

        // Detect semicolon preference
        const lines = code.split('\n').filter(l => l.trim());
        const withSemi = lines.filter(l => l.trimEnd().endsWith(';')).length;
        this._profile.preferences.useSemicolons = withSemi > lines.length / 2;

        // Detect arrow function preference
        const arrowCount = (code.match(/=>/g) || []).length;
        const functionCount = (code.match(/function\s/g) || []).length;
        this._profile.preferences.preferArrowFunctions = arrowCount > functionCount;

        // Detect async preference
        this._profile.preferences.preferAsync = code.includes('async ') || code.includes('await ');

        this.saveProfile();
        this.logService.info('[UserMemory] Learned preferences from code sample');
    }

    // ========================================================================
    // CONVERSATION MEMORY
    // ========================================================================

    /**
     * Remember a conversation
     */
    public rememberConversation(projectPath: string, summary: string, topics: string[], decisions: string[]): void {
        const memory: ConversationMemory = {
            id: this.generateId(),
            projectPath,
            summary,
            topics,
            decisions,
            timestamp: Date.now()
        };

        this._profile.conversationHistory.push(memory);

        // Keep only last 50 conversations
        if (this._profile.conversationHistory.length > 50) {
            this._profile.conversationHistory = this._profile.conversationHistory.slice(-50);
        }

        this.saveProfile();
        this.logService.info('[UserMemory] Remembered conversation:', summary.substring(0, 50));
    }

    /**
     * Recall conversations about a project
     */
    public recallProjectConversations(projectPath: string): ConversationMemory[] {
        return this._profile.conversationHistory.filter(c => c.projectPath === projectPath);
    }

    /**
     * Recall conversations about a topic
     */
    public recallTopicConversations(topic: string): ConversationMemory[] {
        return this._profile.conversationHistory.filter(c =>
            c.topics.some(t => t.toLowerCase().includes(topic.toLowerCase()))
        );
    }

    /**
     * Get recent decisions
     */
    public getRecentDecisions(): string[] {
        const recent = this._profile.conversationHistory.slice(-10);
        return recent.flatMap(c => c.decisions);
    }

    // ========================================================================
    // SESSION MEMORY
    // ========================================================================

    /**
     * Store session-specific memory (not persisted)
     */
    public setSessionMemory(key: string, value: string): void {
        this._sessionMemory.set(key, value);
    }

    public getSessionMemory(key: string): string | undefined {
        return this._sessionMemory.get(key);
    }

    public clearSessionMemory(): void {
        this._sessionMemory.clear();
    }

    // ========================================================================
    // PROJECT CONTEXT
    // ========================================================================

    /**
     * Store project-specific context
     */
    public setProjectContext(projectPath: string, context: string): void {
        this._profile.projectContexts.set(projectPath, context);
        this.saveProfile();
    }

    public getProjectContext(projectPath: string): string | undefined {
        return this._profile.projectContexts.get(projectPath);
    }

    // ========================================================================
    // PATTERN LEARNING
    // ========================================================================

    /**
     * Learn a code pattern from user's code
     */
    public learnPattern(pattern: string, example: string): void {
        const existing = this._profile.learnedPatterns.find(p => p.pattern === pattern);

        if (existing) {
            existing.frequency++;
            if (!existing.examples.includes(example)) {
                existing.examples.push(example);
                if (existing.examples.length > 3) {
                    existing.examples = existing.examples.slice(-3);
                }
            }
        } else {
            this._profile.learnedPatterns.push({
                pattern,
                frequency: 1,
                examples: [example]
            });
        }

        // Keep only top 20 patterns
        this._profile.learnedPatterns.sort((a, b) => b.frequency - a.frequency);
        this._profile.learnedPatterns = this._profile.learnedPatterns.slice(0, 20);

        this.saveProfile();
    }

    public getCommonPatterns(): CodePattern[] {
        return this._profile.learnedPatterns.slice(0, 10);
    }

    // ========================================================================
    // AI CONTEXT GENERATION
    // ========================================================================

    /**
     * Generate context for AI based on user profile
     */
    public generateAIContext(projectPath?: string): string {
        let context = '\n## User Preferences\n';
        const prefs = this._profile.preferences;

        context += `- Coding style: ${prefs.codingStyle}\n`;
        context += `- Preferred languages: ${prefs.preferredLanguages.join(', ')}\n`;
        context += `- Uses semicolons: ${prefs.useSemicolons ? 'yes' : 'no'}\n`;
        context += `- Prefers arrow functions: ${prefs.preferArrowFunctions ? 'yes' : 'no'}\n`;
        context += `- Testing framework: ${prefs.testingFramework}\n`;

        // Add project-specific context
        if (projectPath) {
            const projectContext = this.getProjectContext(projectPath);
            if (projectContext) {
                context += `\n## Project Context\n${projectContext}\n`;
            }

            const recentConvos = this.recallProjectConversations(projectPath).slice(-3);
            if (recentConvos.length > 0) {
                context += '\n## Recent Conversations\n';
                for (const c of recentConvos) {
                    context += `- ${c.summary}\n`;
                }
            }
        }

        // Add common patterns
        const patterns = this.getCommonPatterns();
        if (patterns.length > 0) {
            context += '\n## User Patterns\n';
            for (const p of patterns.slice(0, 5)) {
                context += `- ${p.pattern} (used ${p.frequency} times)\n`;
            }
        }

        return context;
    }

    // ========================================================================
    // PERSISTENCE
    // ========================================================================

    private loadProfile(): UserProfile {
        try {
            const stored = this.storageService.get('supercode.userProfile', StorageScope.APPLICATION);
            if (stored) {
                const parsed = JSON.parse(stored);
                return {
                    preferences: { ...DEFAULT_PREFERENCES, ...parsed.preferences },
                    conversationHistory: parsed.conversationHistory || [],
                    learnedPatterns: parsed.learnedPatterns || [],
                    projectContexts: new Map(parsed.projectContexts || []),
                    lastUpdated: parsed.lastUpdated || Date.now()
                };
            }
        } catch (e) {
            this.logService.warn('[UserMemory] Failed to load profile:', e);
        }

        return {
            preferences: { ...DEFAULT_PREFERENCES },
            conversationHistory: [],
            learnedPatterns: [],
            projectContexts: new Map(),
            lastUpdated: Date.now()
        };
    }

    private saveProfile(): void {
        try {
            const toStore = {
                preferences: this._profile.preferences,
                conversationHistory: this._profile.conversationHistory,
                learnedPatterns: this._profile.learnedPatterns,
                projectContexts: [...this._profile.projectContexts.entries()],
                lastUpdated: this._profile.lastUpdated
            };

            this.storageService.store(
                'supercode.userProfile',
                JSON.stringify(toStore),
                StorageScope.APPLICATION,
                StorageTarget.USER
            );
        } catch (e) {
            this.logService.error('[UserMemory] Failed to save profile:', e);
        }
    }

    private generateId(): string {
        return 'mem_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    }
}
