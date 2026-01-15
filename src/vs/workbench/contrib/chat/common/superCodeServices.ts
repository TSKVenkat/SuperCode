/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Unified Services Module - Integrates all v2 features
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';

// Import all services
import { TestGeneratorService, GeneratedTest, TestFramework } from '../supercode/testing/testGenerator.js';
import { ModelFallbackService } from '../supercode/network/modelFallback.js';
import { WebSearchService, WebSearchResult } from '../supercode/search/webSearchService.js';
import { DependencyGraphService, DependencyGraph } from '../supercode/context/dependencyGraph.js';
import { SecurityScannerService, SecurityReport } from '../supercode/security/securityScanner.js';
import { AgenticPlannerService, ExecutionPlan } from '../supercode/agent/planner.js';
import { UserMemoryService } from '../supercode/memory/userProfile.js';
import { ProjectOnboardingService, OnboardingResult } from '../supercode/onboarding/projectScanner.js';

// ============================================================================
// UNIFIED SERVICES
// ============================================================================

export interface SuperCodeServices {
    testGenerator: TestGeneratorService;
    modelFallback: ModelFallbackService;
    webSearch: WebSearchService;
    dependencyGraph: DependencyGraphService;
    securityScanner: SecurityScannerService;
    planner: AgenticPlannerService;
    memory: UserMemoryService;
    onboarding: ProjectOnboardingService;
}

export class SuperCodeServicesManager {
    private _services: SuperCodeServices | null = null;
    private _initialized: boolean = false;

    constructor(
        private readonly logService: ILogService,
        private readonly fileService: IFileService,
        private readonly storageService: IStorageService,
        private readonly workspaceContextService: IWorkspaceContextService
    ) {
        this.logService.info('[SuperCodeServices] Manager created');
    }

    /**
     * Initialize all services
     */
    public async initialize(): Promise<SuperCodeServices> {
        if (this._services && this._initialized) {
            return this._services;
        }

        this.logService.info('[SuperCodeServices] Initializing all services...');

        this._services = {
            testGenerator: new TestGeneratorService(this.logService, this.fileService),
            modelFallback: new ModelFallbackService(this.logService, this.storageService),
            webSearch: new WebSearchService(this.logService, this.storageService),
            dependencyGraph: new DependencyGraphService(this.logService, this.fileService, this.storageService),
            securityScanner: new SecurityScannerService(this.logService, this.fileService),
            planner: new AgenticPlannerService(this.logService),
            memory: new UserMemoryService(this.logService, this.storageService),
            onboarding: new ProjectOnboardingService(this.logService, this.fileService)
        };

        this._initialized = true;
        this.logService.info('[SuperCodeServices] All services initialized');

        return this._services;
    }

    public get services(): SuperCodeServices | null {
        return this._services;
    }

    // ========================================================================
    // COMMAND HANDLERS
    // ========================================================================

    /**
     * Handle /test command
     */
    public async handleTestCommand(code: string, filePath: string, workspaceRoot: URI): Promise<{ tests: GeneratedTest; message: string }> {
        const services = await this.initialize();

        const framework = await services.testGenerator.detectFramework(workspaceRoot);
        const language = this.getLanguageFromPath(filePath);
        const functions = services.testGenerator.extractFunctions(code, language);

        if (functions.length === 0) {
            return {
                tests: { filePath: '', content: '', framework: 'unknown' as TestFramework },
                message: 'No functions found to generate tests for.'
            };
        }

        const tests = services.testGenerator.generateTestFile(filePath, functions, framework);

        return {
            tests,
            message: `Generated ${functions.length} test case(s) for ${framework} framework.`
        };
    }

    /**
     * Handle /security command
     */
    public async handleSecurityCommand(workspaceRoot: URI): Promise<{ report: SecurityReport; formatted: string }> {
        const services = await this.initialize();
        const report = await services.securityScanner.scanWorkspace(workspaceRoot);
        const formatted = services.securityScanner.formatReportForAI(report);

        return { report, formatted };
    }

    /**
     * Handle /onboard command
     */
    public async handleOnboardCommand(workspaceRoot: URI): Promise<{ result: OnboardingResult; formatted: string }> {
        const services = await this.initialize();
        const result = await services.onboarding.scanProject(workspaceRoot);

        let formatted = `## Project: ${result.project.name}\n\n`;
        formatted += `**Type:** ${result.project.type} | **Framework:** ${result.project.framework}\n`;
        formatted += `**Language:** ${result.project.language}\n\n`;

        if (result.setupSteps.length > 0) {
            formatted += `### Setup Steps\n`;
            for (const step of result.setupSteps) {
                formatted += `1. **${step.title}**: \`${step.command}\`\n`;
            }
            formatted += '\n';
        }

        if (result.suggestedAdditions.length > 0) {
            formatted += `### Suggestions\n`;
            for (const suggestion of result.suggestedAdditions) {
                formatted += `- ${suggestion}\n`;
            }
        }

        return { result, formatted };
    }

    /**
     * Handle /plan command for agentic workflows
     */
    public async handlePlanCommand(goal: string, context: string): Promise<{ plan: ExecutionPlan; formatted: string }> {
        const services = await this.initialize();
        const plan = services.planner.generatePlan(goal, context);
        const formatted = services.planner.formatPlanForDisplay(plan);

        return { plan, formatted };
    }

    /**
     * Handle web search for context enrichment
     */
    public async enrichWithWebSearch(prompt: string): Promise<string> {
        const services = await this.initialize();
        const needsSearch = services.webSearch.needsExternalInfo(prompt);

        if (!needsSearch.needsSearch) {
            return '';
        }

        let results: WebSearchResult[] = [];

        switch (needsSearch.searchType) {
            case 'web':
                results = await services.webSearch.searchWeb(needsSearch.query);
                break;
            case 'package':
                const npmInfo = await services.webSearch.searchNpm(needsSearch.query);
                if (npmInfo) {
                    results = [{
                        title: npmInfo.name,
                        url: npmInfo.documentation,
                        snippet: npmInfo.description,
                        source: 'npm'
                    }];
                }
                break;
            case 'stackoverflow':
                const soResults = await services.webSearch.searchStackOverflow(needsSearch.query);
                results = soResults.map(r => ({
                    title: r.title,
                    url: r.link,
                    snippet: `Score: ${r.score}, Answers: ${r.answerCount}`,
                    source: 'stackoverflow' as const
                }));
                break;
        }

        return services.webSearch.formatResultsForContext(results);
    }

    /**
     * Get dependency graph context for a file
     */
    public async getDependencyContext(filePath: string, workspaceRoot: URI): Promise<string> {
        const services = await this.initialize();

        // Build graph if not already built
        await services.dependencyGraph.buildGraph(workspaceRoot);

        return services.dependencyGraph.formatForAI(filePath);
    }

    /**
     * Get user memory context
     */
    public async getUserContext(projectPath?: string): Promise<string> {
        const services = await this.initialize();
        return services.memory.generateAIContext(projectPath);
    }

    /**
     * Execute request with model fallback
     */
    public async executeWithFallback<T>(
        requestFn: (modelId: string) => Promise<T>,
        onFallback?: (from: string, to: string, error: string) => void
    ): Promise<T> {
        const services = await this.initialize();
        return services.modelFallback.executeWithFallback(requestFn, onFallback);
    }

    /**
     * Get cached response if available
     */
    public getCachedResponse(prompt: string): string | null {
        if (!this._services) return null;
        const cached = this._services.modelFallback.getCachedResponse(prompt);
        return cached?.response || null;
    }

    /**
     * Cache a response
     */
    public cacheResponse(prompt: string, response: string, modelId: string): void {
        if (!this._services) return;
        this._services.modelFallback.cacheResponse(prompt, response, modelId);
    }

    /**
     * Learn from user's code
     */
    public learnFromCode(code: string): void {
        if (!this._services) return;
        this._services.memory.learnFromCode(code);
    }

    /**
     * Remember conversation
     */
    public rememberConversation(projectPath: string, summary: string, topics: string[], decisions: string[]): void {
        if (!this._services) return;
        this._services.memory.rememberConversation(projectPath, summary, topics, decisions);
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    private getLanguageFromPath(filePath: string): string {
        const ext = filePath.substring(filePath.lastIndexOf('.'));
        const map: Record<string, string> = {
            '.ts': 'typescript', '.tsx': 'typescript',
            '.js': 'javascript', '.jsx': 'javascript',
            '.py': 'python', '.java': 'java',
            '.go': 'go', '.rs': 'rust'
        };
        return map[ext] || 'text';
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let _servicesManager: SuperCodeServicesManager | null = null;

export function getServicesManager(
    logService: ILogService,
    fileService: IFileService,
    storageService: IStorageService,
    workspaceContextService: IWorkspaceContextService
): SuperCodeServicesManager {
    if (!_servicesManager) {
        _servicesManager = new SuperCodeServicesManager(
            logService,
            fileService,
            storageService,
            workspaceContextService
        );
    }
    return _servicesManager;
}
