/*---------------------------------------------------------------------------------------------
 *  SuperCode Context Manager
 *  Advanced workspace scanning and AI-powered codebase context gathering
 *  Enables Cursor-like full project understanding for the AI agent
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { URI } from '../../../../base/common/uri.js';
// import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface FileContext {
    path: string;
    relativePath: string;
    language: string;
    summary: string;
    imports: string[];
    exports: string[];
    contentSnippet: string;
    lineCount: number;
    size: number;
    lastModified?: number;
}

export interface GraphQLContext {
    queries: string[];
    mutations: string[];
    subscriptions: string[];
    fragments: string[];
    types: string[];
}

export interface CodebaseContext {
    projectName: string;
    projectType: string;
    fileCount: number;
    files: FileContext[];
    graphql?: GraphQLContext;
    dependencies: Map<string, string>;
    devDependencies: Map<string, string>;
    testFramework?: string;
    buildTool?: string;
    summary: string;
}

export interface ContextManagerOptions {
    maxFiles: number;
    maxContentLength: number;
    excludePatterns: string[];
    includePatterns: string[];
    enableAISummaries: boolean;
    cacheDuration: number; // ms
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_OPTIONS: ContextManagerOptions = {
    maxFiles: 50,
    maxContentLength: 6000,
    excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/out/**',
        '**/.git/**',
        '**/coverage/**',
        '**/*.min.js',
        '**/*.map',
        '**/package-lock.json',
        '**/yarn.lock',
        '**/pnpm-lock.yaml'
    ],
    includePatterns: [
        '**/*.ts',
        '**/*.tsx',
        '**/*.js',
        '**/*.jsx',
        '**/*.py',
        '**/*.go',
        '**/*.rs',
        '**/*.java',
        '**/*.graphql',
        '**/*.gql',
        '**/*.json',
        '**/*.yaml',
        '**/*.yml',
        '**/*.md',
        '**/*.sql',
        '**/*.prisma',
        '**/*.proto'
    ],
    enableAISummaries: false,
    cacheDuration: 5 * 60 * 1000 // 5 minutes
};

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

const LANGUAGE_MAP: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.graphql': 'graphql',
    '.gql': 'graphql',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.sql': 'sql',
    '.prisma': 'prisma',
    '.proto': 'protobuf',
    '.css': 'css',
    '.scss': 'scss',
    '.html': 'html',
    '.vue': 'vue',
    '.svelte': 'svelte'
};

// ============================================================================
// CONTEXT MANAGER CLASS
// ============================================================================

export class ContextManager {
    private _cache: Map<string, { data: CodebaseContext; timestamp: number }> = new Map();
    private _fileCache: Map<string, { data: FileContext; timestamp: number }> = new Map();
    private _options: ContextManagerOptions;

    constructor(
        private readonly logService: ILogService,
        private readonly workspaceContextService: IWorkspaceContextService,
        private readonly fileService: IFileService,
        private readonly storageService: IStorageService,
        // private readonly configService: IConfigurationService, // Unused for now
        options?: Partial<ContextManagerOptions>
    ) {
        this._options = { ...DEFAULT_OPTIONS, ...options };
        this.loadCachedSummaries();
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Build comprehensive codebase context for AI prompts
     */
    public async buildCodebaseContext(): Promise<CodebaseContext> {
        const workspaceFolder = this.getWorkspaceRoot();
        if (!workspaceFolder) {
            return this.getEmptyContext();
        }

        const cacheKey = workspaceFolder.toString();
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this._options.cacheDuration) {
            this.logService.debug('[ContextManager] Using cached codebase context');
            return cached.data;
        }

        this.logService.info('[ContextManager] Building codebase context...');

        try {
            // Gather all components
            const [files, packageInfo, graphqlContext] = await Promise.all([
                this.discoverFiles(workspaceFolder),
                this.parsePackageJson(workspaceFolder),
                this.parseGraphQLFiles(workspaceFolder)
            ]);

            const context: CodebaseContext = {
                projectName: packageInfo.name || this.getProjectName(workspaceFolder),
                projectType: this.detectProjectType(files, packageInfo),
                fileCount: files.length,
                files: files.slice(0, this._options.maxFiles),
                graphql: graphqlContext,
                dependencies: packageInfo.dependencies,
                devDependencies: packageInfo.devDependencies,
                testFramework: this.detectTestFramework(packageInfo),
                buildTool: this.detectBuildTool(files, packageInfo),
                summary: ''
            };

            // Build summary
            context.summary = this.buildContextSummary(context);

            // Cache result
            this._cache.set(cacheKey, { data: context, timestamp: Date.now() });
            this.logService.info(`[ContextManager] Built context: ${files.length} files, ${context.projectType}`);

            return context;
        } catch (error) {
            this.logService.error('[ContextManager] Failed to build context:', error);
            return this.getEmptyContext();
        }
    }

    /**
     * Get context string formatted for AI prompts
     */
    public async getContextForPrompt(maxLength: number = 20000): Promise<string> {
        const context = await this.buildCodebaseContext();
        return this.formatContextForAI(context, maxLength);
    }

    /**
     * Get context for a specific file with related files
     */
    public async getFileContextWithRelated(filePath: string): Promise<string> {
        const context = await this.buildCodebaseContext();
        const targetFile = context.files.find(f => f.path === filePath || f.relativePath === filePath);

        if (!targetFile) {
            return '';
        }

        // Find related files based on imports
        const relatedFiles = context.files.filter(f =>
            targetFile.imports.some(imp => f.relativePath.includes(imp.replace(/['"@]/g, '')))
        );

        let result = `\n=== Target File: ${targetFile.relativePath} ===\n`;
        result += `Language: ${targetFile.language}\n`;
        result += `Summary: ${targetFile.summary}\n`;
        result += `Content:\n${targetFile.contentSnippet}\n`;

        if (relatedFiles.length > 0) {
            result += `\n=== Related Files (${relatedFiles.length}) ===\n`;
            for (const file of relatedFiles.slice(0, 5)) {
                result += `\nFile: ${file.relativePath}\n`;
                result += `Summary: ${file.summary}\n`;
            }
        }

        return result;
    }

    /**
     * Analyze dependencies and their usage
     */
    public async analyzeDependencies(): Promise<string> {
        const context = await this.buildCodebaseContext();
        let analysis = '# Dependency Analysis\n\n';

        analysis += '## Production Dependencies\n';
        for (const [dep, version] of context.dependencies) {
            const usageCount = context.files.filter(f =>
                f.imports.some(imp => imp.includes(dep))
            ).length;
            analysis += `- ${dep}@${version} (used in ${usageCount} files)\n`;
        }

        analysis += '\n## Dev Dependencies\n';
        for (const [dep, version] of context.devDependencies) {
            analysis += `- ${dep}@${version}\n`;
        }

        if (context.testFramework) {
            analysis += `\n## Test Framework: ${context.testFramework}\n`;
        }

        return analysis;
    }

    // ========================================================================
    // FILE DISCOVERY
    // ========================================================================

    private async discoverFiles(workspaceRoot: URI): Promise<FileContext[]> {
        const files: FileContext[] = [];
        const visited = new Set<string>();

        try {
            await this.walkDirectory(workspaceRoot, workspaceRoot, files, visited, 0);
        } catch (error) {
            this.logService.error('[ContextManager] Error walking directory:', error);
        }

        // Sort by relevance (entry points first, then by path)
        return files.sort((a, b) => {
            const aScore = this.getFileRelevanceScore(a);
            const bScore = this.getFileRelevanceScore(b);
            return bScore - aScore;
        });
    }

    private async walkDirectory(
        dir: URI,
        root: URI,
        files: FileContext[],
        visited: Set<string>,
        depth: number
    ): Promise<void> {
        if (depth > 10 || files.length >= this._options.maxFiles * 2) {
            return;
        }

        const dirPath = dir.path;
        if (visited.has(dirPath)) return;
        visited.add(dirPath);

        // Check exclusions
        for (const pattern of this._options.excludePatterns) {
            if (this.matchesPattern(dirPath, pattern)) {
                return;
            }
        }

        try {
            const stat = await this.fileService.resolve(dir);

            if (!stat.children) {
                return;
            }

            for (const child of stat.children) {
                // const name = child.name; // Unused
                const isDirectory = child.isDirectory;
                const childUri = child.resource;

                if (isDirectory) { // Directory
                    await this.walkDirectory(childUri, root, files, visited, depth + 1);
                } else { // File
                    const fileContext = await this.processFile(childUri, root);
                    if (fileContext) {
                        files.push(fileContext);
                    }
                }
            }
        } catch (error) {
            // Silently skip inaccessible directories
        }
    }

    private async processFile(fileUri: URI, root: URI): Promise<FileContext | null> {
        const filePath = fileUri.path;
        const ext = this.getFileExtension(filePath);

        // Check if file type is included
        if (!LANGUAGE_MAP[ext]) {
            return null;
        }

        // Check exclusions
        for (const pattern of this._options.excludePatterns) {
            if (this.matchesPattern(filePath, pattern)) {
                return null;
            }
        }

        // Check cache
        const cached = this._fileCache.get(filePath);
        if (cached && Date.now() - cached.timestamp < this._options.cacheDuration) {
            return cached.data;
        }

        try {
            const stat = await this.fileService.stat(fileUri);

            // Skip large files
            if (stat.size > 100000) {
                return null;
            }

            const contentBuffer = await this.fileService.readFile(fileUri);
            const content = contentBuffer.value.toString();
            const lines = content.split('\n');

            const fileContext: FileContext = {
                path: filePath,
                relativePath: filePath.replace(root.path + '/', ''),
                language: LANGUAGE_MAP[ext] || 'text',
                summary: this.summarizeFileContent(content, ext),
                imports: this.extractImports(content, ext),
                exports: this.extractExports(content, ext),
                contentSnippet: content.slice(0, this._options.maxContentLength),
                lineCount: lines.length,
                size: stat.size,
                lastModified: stat.mtime
            };

            // Cache
            this._fileCache.set(filePath, { data: fileContext, timestamp: Date.now() });

            return fileContext;
        } catch (error) {
            return null;
        }
    }

    // ========================================================================
    // FILE ANALYSIS
    // ========================================================================

    private summarizeFileContent(content: string, ext: string): string {
        const lines = content.split('\n');
        const summary: string[] = [];

        // Count key elements
        const imports = lines.filter(l => l.trim().startsWith('import') || l.includes('require(')).length;
        const functions = (content.match(/function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(/g) || []).length;
        const classes = (content.match(/class\s+\w+/g) || []).length;
        const interfaces = (content.match(/interface\s+\w+|type\s+\w+\s*=/g) || []).length;

        if (imports > 0) summary.push(`${imports} imports`);
        if (classes > 0) summary.push(`${classes} classes`);
        if (interfaces > 0) summary.push(`${interfaces} types/interfaces`);
        if (functions > 0) summary.push(`${functions} functions`);

        // Language-specific summaries
        if (ext === '.graphql' || ext === '.gql') {
            const queries = (content.match(/query\s+\w+/g) || []).length;
            const mutations = (content.match(/mutation\s+\w+/g) || []).length;
            if (queries > 0) summary.push(`${queries} queries`);
            if (mutations > 0) summary.push(`${mutations} mutations`);
        }

        return summary.length > 0 ? summary.join(', ') : 'utility file';
    }

    private extractImports(content: string, ext: string): string[] {
        const imports: string[] = [];

        // ES6 imports
        const es6Matches = content.matchAll(/import\s+.*?from\s+['"]([^'"]+)['"]/g);
        for (const match of es6Matches) {
            imports.push(match[1]);
        }

        // CommonJS requires
        const cjsMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
        for (const match of cjsMatches) {
            imports.push(match[1]);
        }

        // Python imports
        if (ext === '.py') {
            const pyMatches = content.matchAll(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
            for (const match of pyMatches) {
                imports.push(match[1] || match[2]);
            }
        }

        return [...new Set(imports)];
    }

    private extractExports(content: string, ext: string): string[] {
        const exports: string[] = [];

        // ES6 exports
        const namedExports = content.matchAll(/export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/g);
        for (const match of namedExports) {
            exports.push(match[1]);
        }

        // Default exports
        if (content.includes('export default')) {
            exports.push('default');
        }

        return exports;
    }

    // ========================================================================
    // GRAPHQL PARSING
    // ========================================================================

    private async parseGraphQLFiles(workspaceRoot: URI): Promise<GraphQLContext> {
        const context: GraphQLContext = {
            queries: [],
            mutations: [],
            subscriptions: [],
            fragments: [],
            types: []
        };

        const files = this._fileCache;
        for (const [path, cached] of files) {
            if (path.endsWith('.graphql') || path.endsWith('.gql')) {
                const content = cached.data.contentSnippet;
                this.parseGraphQLContent(content, context);
            }
        }

        // Also check for inline GraphQL in TS/JS files
        for (const [path, cached] of files) {
            if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js')) {
                const gqlMatches = cached.data.contentSnippet.matchAll(/gql`([^`]+)`|graphql`([^`]+)`/g);
                for (const match of gqlMatches) {
                    this.parseGraphQLContent(match[1] || match[2], context);
                }
            }
        }

        return context;
    }

    private parseGraphQLContent(content: string, context: GraphQLContext): void {
        // Extract queries
        const queries = content.matchAll(/query\s+(\w+)/g);
        for (const match of queries) {
            if (!context.queries.includes(match[1])) {
                context.queries.push(match[1]);
            }
        }

        // Extract mutations
        const mutations = content.matchAll(/mutation\s+(\w+)/g);
        for (const match of mutations) {
            if (!context.mutations.includes(match[1])) {
                context.mutations.push(match[1]);
            }
        }

        // Extract subscriptions
        const subscriptions = content.matchAll(/subscription\s+(\w+)/g);
        for (const match of subscriptions) {
            if (!context.subscriptions.includes(match[1])) {
                context.subscriptions.push(match[1]);
            }
        }

        // Extract fragments
        const fragments = content.matchAll(/fragment\s+(\w+)/g);
        for (const match of fragments) {
            if (!context.fragments.includes(match[1])) {
                context.fragments.push(match[1]);
            }
        }

        // Extract types
        const types = content.matchAll(/type\s+(\w+)/g);
        for (const match of types) {
            if (!context.types.includes(match[1]) && match[1] !== 'Query' && match[1] !== 'Mutation') {
                context.types.push(match[1]);
            }
        }
    }

    // ========================================================================
    // PACKAGE.JSON PARSING
    // ========================================================================

    private async parsePackageJson(workspaceRoot: URI): Promise<{
        name: string;
        dependencies: Map<string, string>;
        devDependencies: Map<string, string>;
        scripts: string[];
    }> {
        const result = {
            name: '',
            dependencies: new Map<string, string>(),
            devDependencies: new Map<string, string>(),
            scripts: [] as string[]
        };

        try {
            const packageUri = URI.joinPath(workspaceRoot, 'package.json');
            const contentBuffer = await this.fileService.readFile(packageUri);
            const pkg = JSON.parse(contentBuffer.value.toString());

            result.name = pkg.name || '';

            if (pkg.dependencies) {
                for (const [key, value] of Object.entries(pkg.dependencies)) {
                    result.dependencies.set(key, String(value));
                }
            }

            if (pkg.devDependencies) {
                for (const [key, value] of Object.entries(pkg.devDependencies)) {
                    result.devDependencies.set(key, String(value));
                }
            }

            if (pkg.scripts) {
                result.scripts = Object.keys(pkg.scripts);
            }
        } catch {
            // No package.json or parse error
        }

        return result;
    }

    // ========================================================================
    // PROJECT DETECTION
    // ========================================================================

    private detectProjectType(files: FileContext[], packageInfo: { dependencies: Map<string, string> }): string {
        const deps = packageInfo.dependencies;
        const fileNames = files.map(f => f.relativePath.toLowerCase());

        // Framework detection
        if (deps.has('next')) return 'Next.js';
        if (deps.has('nuxt')) return 'Nuxt.js';
        if (deps.has('@angular/core')) return 'Angular';
        if (deps.has('vue')) return 'Vue.js';
        if (deps.has('svelte')) return 'Svelte';
        if (deps.has('react')) return 'React';
        if (deps.has('express')) return 'Express.js';
        if (deps.has('fastify')) return 'Fastify';
        if (deps.has('nestjs') || deps.has('@nestjs/core')) return 'NestJS';
        if (deps.has('electron')) return 'Electron';

        // File-based detection
        if (fileNames.some(f => f.includes('prisma/schema.prisma'))) return 'Prisma + Node.js';
        if (fileNames.some(f => f.endsWith('.py'))) return 'Python';
        if (fileNames.some(f => f.endsWith('.go'))) return 'Go';
        if (fileNames.some(f => f.endsWith('.rs'))) return 'Rust';
        if (fileNames.some(f => f.endsWith('.java'))) return 'Java';

        return 'Node.js';
    }

    private detectTestFramework(packageInfo: { dependencies: Map<string, string>; devDependencies: Map<string, string> }): string | undefined {
        const allDeps = new Map([...packageInfo.dependencies, ...packageInfo.devDependencies]);

        if (allDeps.has('jest')) return 'Jest';
        if (allDeps.has('vitest')) return 'Vitest';
        if (allDeps.has('mocha')) return 'Mocha';
        if (allDeps.has('@testing-library/react')) return 'React Testing Library';
        if (allDeps.has('cypress')) return 'Cypress';
        if (allDeps.has('playwright')) return 'Playwright';
        if (allDeps.has('pytest')) return 'pytest';

        return undefined;
    }

    private detectBuildTool(files: FileContext[], packageInfo: { devDependencies: Map<string, string> }): string | undefined {
        const devDeps = packageInfo.devDependencies;
        const fileNames = files.map(f => f.relativePath.toLowerCase());

        if (devDeps.has('vite')) return 'Vite';
        if (devDeps.has('webpack')) return 'Webpack';
        if (devDeps.has('esbuild')) return 'esbuild';
        if (devDeps.has('rollup')) return 'Rollup';
        if (devDeps.has('parcel')) return 'Parcel';
        if (fileNames.some(f => f.includes('turbo.json'))) return 'Turborepo';

        return undefined;
    }

    // ========================================================================
    // CONTEXT FORMATTING
    // ========================================================================

    private buildContextSummary(context: CodebaseContext): string {
        const parts: string[] = [];

        parts.push(`Project: ${context.projectName} (${context.projectType})`);
        parts.push(`Files: ${context.fileCount}`);

        if (context.testFramework) {
            parts.push(`Testing: ${context.testFramework}`);
        }

        if (context.buildTool) {
            parts.push(`Build: ${context.buildTool}`);
        }

        if (context.graphql && context.graphql.queries.length > 0) {
            parts.push(`GraphQL: ${context.graphql.queries.length} queries, ${context.graphql.mutations.length} mutations`);
        }

        return parts.join(' | ');
    }

    public formatContextForAI(context: CodebaseContext, maxLength: number): string {
        let result = `\n## Codebase Context\n`;
        result += `${context.summary}\n\n`;

        // Key dependencies
        if (context.dependencies.size > 0) {
            result += `### Key Dependencies\n`;
            const topDeps = [...context.dependencies.entries()].slice(0, 15);
            result += topDeps.map(([name, version]) => `- ${name}@${version}`).join('\n');
            result += '\n\n';
        }

        // GraphQL context if present
        if (context.graphql && (context.graphql.queries.length > 0 || context.graphql.mutations.length > 0)) {
            result += `### GraphQL Operations\n`;
            if (context.graphql.queries.length > 0) {
                result += `Queries: ${context.graphql.queries.join(', ')}\n`;
            }
            if (context.graphql.mutations.length > 0) {
                result += `Mutations: ${context.graphql.mutations.join(', ')}\n`;
            }
            if (context.graphql.types.length > 0) {
                result += `Types: ${context.graphql.types.slice(0, 20).join(', ')}\n`;
            }
            result += '\n';
        }

        // File summaries
        result += `### Project Files (${context.files.length})\n`;
        let currentLength = result.length;

        for (const file of context.files) {
            const fileEntry = `\n**${file.relativePath}** (${file.language})\n${file.summary}\n`;

            if (currentLength + fileEntry.length > maxLength * 0.6) {
                break;
            }

            result += fileEntry;
            currentLength += fileEntry.length;

            // Include content snippet for important files
            if (this.getFileRelevanceScore(file) > 5) {
                const snippet = `\`\`\`${file.language}\n${file.contentSnippet.slice(0, 1500)}\n\`\`\`\n`;
                if (currentLength + snippet.length < maxLength) {
                    result += snippet;
                    currentLength += snippet.length;
                }
            }
        }

        return result;
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    private getWorkspaceRoot(): URI | null {
        const state = this.workspaceContextService.getWorkbenchState();
        if (state === WorkbenchState.EMPTY) {
            return null;
        }

        const folders = this.workspaceContextService.getWorkspace().folders;
        return folders.length > 0 ? folders[0].uri : null;
    }

    private getProjectName(uri: URI): string {
        const parts = uri.path.split('/');
        return parts[parts.length - 1] || 'unknown';
    }

    private getFileExtension(path: string): string {
        const parts = path.split('.');
        return parts.length > 1 ? '.' + parts.pop()! : '';
    }

    private matchesPattern(path: string, pattern: string): boolean {
        // Simple glob matching
        const regex = pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.');
        return new RegExp(regex).test(path);
    }

    private getFileRelevanceScore(file: FileContext): number {
        let score = 0;

        // Entry points
        if (file.relativePath.includes('index.')) score += 3;
        if (file.relativePath.includes('main.')) score += 3;
        if (file.relativePath.includes('app.')) score += 3;
        if (file.relativePath.includes('server.')) score += 2;

        // Configuration
        if (file.relativePath.includes('config')) score += 2;
        if (file.relativePath.endsWith('.json')) score += 1;

        // GraphQL
        if (file.language === 'graphql') score += 3;

        // Root level files
        if (!file.relativePath.includes('/')) score += 2;

        // More exports = more important
        score += Math.min(file.exports.length, 5);

        return score;
    }

    private getEmptyContext(): CodebaseContext {
        return {
            projectName: 'Unknown',
            projectType: 'Unknown',
            fileCount: 0,
            files: [],
            dependencies: new Map(),
            devDependencies: new Map(),
            summary: 'No workspace context available'
        };
    }

    private loadCachedSummaries(): void {
        try {
            const cached = this.storageService.get('supercode.contextManager.summaries', StorageScope.WORKSPACE);
            if (cached) {
                const data = JSON.parse(cached);
                for (const [key, value] of Object.entries(data)) {
                    if (typeof value === 'object' && value !== null) {
                        this._fileCache.set(key, value as any);
                    }
                }
            }
        } catch {
            // No cached data
        }
    }

    public saveCachedSummaries(): void {
        const data: Record<string, any> = {};
        for (const [key, value] of this._fileCache) {
            data[key] = value;
        }
        this.storageService.store(
            'supercode.contextManager.summaries',
            JSON.stringify(data),
            StorageScope.WORKSPACE,
            StorageTarget.MACHINE
        );
    }

    public clearCache(): void {
        this._cache.clear();
        this._fileCache.clear();
        this.logService.info('[ContextManager] Cache cleared');
    }
}
