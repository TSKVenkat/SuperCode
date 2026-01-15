/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Advanced Context Management with Dependency Graph
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { URI } from '../../../../base/common/uri.js';

// ============================================================================
// TYPES
// ============================================================================

export interface FileNode {
    path: string;
    language: string;
    imports: string[];
    exports: string[];
    functions: string[];
    classes: string[];
    size: number;
    lastModified: number;
}

export interface DependencyEdge {
    from: string;
    to: string;
    type: 'import' | 'call' | 'extends' | 'implements';
}

export interface DependencyGraph {
    nodes: Map<string, FileNode>;
    edges: DependencyEdge[];
}

export interface GitChange {
    file: string;
    author: string;
    date: string;
    message: string;
    additions: number;
    deletions: number;
}

export interface ContextRule {
    pattern: string;
    priority: number;
    alwaysInclude: boolean;
}

// ============================================================================
// DEPENDENCY GRAPH SERVICE
// ============================================================================

export class DependencyGraphService {
    private _graph: DependencyGraph = { nodes: new Map(), edges: [] };
    private _customRules: ContextRule[] = [];

    constructor(
        @ILogService private readonly logService: ILogService,
        @IFileService private readonly fileService: IFileService,
        @IStorageService private readonly storageService: IStorageService
    ) {
        this.loadRules();
        this.logService.info('[DependencyGraph] Service initialized');
    }

    // ========================================================================
    // GRAPH BUILDING
    // ========================================================================

    /**
     * Build dependency graph for workspace
     */
    public async buildGraph(workspaceRoot: URI): Promise<DependencyGraph> {
        this.logService.info('[DependencyGraph] Building graph for workspace');
        this._graph = { nodes: new Map(), edges: [] };

        const files = await this.discoverFiles(workspaceRoot);

        for (const fileUri of files) {
            await this.analyzeFile(fileUri, workspaceRoot);
        }

        this.buildEdges();
        this.logService.info(`[DependencyGraph] Built graph: ${this._graph.nodes.size} nodes, ${this._graph.edges.length} edges`);

        return this._graph;
    }

    private async discoverFiles(root: URI): Promise<URI[]> {
        const files: URI[] = [];
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs'];

        try {
            const stat = await this.fileService.resolve(root);
            if (!stat.children) return files;

            for (const child of stat.children) {
                if (child.isDirectory) {
                    if (!this.isExcluded(child.name)) {
                        const subFiles = await this.discoverFiles(child.resource);
                        files.push(...subFiles);
                    }
                } else {
                    const ext = this.getExtension(child.name);
                    if (extensions.includes(ext)) {
                        files.push(child.resource);
                    }
                }
            }
        } catch {
            // Ignore errors
        }

        return files.slice(0, 500); // Cap at 500 files
    }

    private isExcluded(name: string): boolean {
        const excluded = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv'];
        return excluded.includes(name) || name.startsWith('.');
    }

    private getExtension(filename: string): string {
        const dot = filename.lastIndexOf('.');
        return dot >= 0 ? filename.substring(dot) : '';
    }

    private async analyzeFile(fileUri: URI, root: URI): Promise<void> {
        try {
            const content = (await this.fileService.readFile(fileUri)).value.toString();
            const stat = await this.fileService.stat(fileUri);
            const relativePath = fileUri.path.replace(root.path + '/', '');
            const ext = this.getExtension(relativePath);

            const node: FileNode = {
                path: relativePath,
                language: this.getLanguage(ext),
                imports: this.extractImports(content, ext),
                exports: this.extractExports(content, ext),
                functions: this.extractFunctions(content, ext),
                classes: this.extractClasses(content, ext),
                size: stat.size,
                lastModified: stat.mtime
            };

            this._graph.nodes.set(relativePath, node);
        } catch {
            // Skip files that can't be read
        }
    }

    private getLanguage(ext: string): string {
        const map: Record<string, string> = {
            '.ts': 'typescript', '.tsx': 'typescript',
            '.js': 'javascript', '.jsx': 'javascript',
            '.py': 'python', '.java': 'java',
            '.go': 'go', '.rs': 'rust'
        };
        return map[ext] || 'text';
    }

    private extractImports(content: string, ext: string): string[] {
        const imports: string[] = [];

        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            // ES imports
            const esImportRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g;
            let match;
            while ((match = esImportRegex.exec(content)) !== null) {
                imports.push(match[1]);
            }
            // require
            const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            while ((match = requireRegex.exec(content)) !== null) {
                imports.push(match[1]);
            }
        }

        if (ext === '.py') {
            const pyImportRegex = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
            let match;
            while ((match = pyImportRegex.exec(content)) !== null) {
                imports.push(match[1] || match[2]);
            }
        }

        return [...new Set(imports)];
    }

    private extractExports(content: string, ext: string): string[] {
        const exports: string[] = [];

        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            // Named exports
            const namedRegex = /export\s+(?:const|let|function|class|interface|type)\s+(\w+)/g;
            let match;
            while ((match = namedRegex.exec(content)) !== null) {
                exports.push(match[1]);
            }
            // Default export
            if (/export\s+default/.test(content)) {
                exports.push('default');
            }
        }

        return exports;
    }

    private extractFunctions(content: string, ext: string): string[] {
        const functions: string[] = [];

        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            const funcRegex = /(?:function|const|let)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(|<|\()/g;
            let match;
            while ((match = funcRegex.exec(content)) !== null) {
                functions.push(match[1]);
            }
        }

        if (ext === '.py') {
            const funcRegex = /def\s+(\w+)\s*\(/g;
            let match;
            while ((match = funcRegex.exec(content)) !== null) {
                functions.push(match[1]);
            }
        }

        return functions.slice(0, 50); // Limit
    }

    private extractClasses(content: string, ext: string): string[] {
        const classes: string[] = [];
        const classRegex = /class\s+(\w+)/g;
        let match;
        while ((match = classRegex.exec(content)) !== null) {
            classes.push(match[1]);
        }
        return classes;
    }

    private buildEdges(): void {
        const nodeMap = this._graph.nodes;

        for (const [path, node] of nodeMap) {
            for (const imp of node.imports) {
                // Try to resolve import to a file in the graph
                const resolved = this.resolveImport(imp, path);
                if (resolved && nodeMap.has(resolved)) {
                    this._graph.edges.push({
                        from: path,
                        to: resolved,
                        type: 'import'
                    });
                }
            }
        }
    }

    private resolveImport(importPath: string, fromFile: string): string | null {
        // Handle relative imports
        if (importPath.startsWith('.')) {
            const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
            let resolved = `${dir}/${importPath}`.replace(/\/\.\//g, '/');

            // Handle ..
            while (resolved.includes('/../')) {
                resolved = resolved.replace(/\/[^/]+\/\.\.\//g, '/');
            }

            // Try common extensions
            for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
                if (this._graph.nodes.has(resolved + ext)) {
                    return resolved + ext;
                }
            }
            if (this._graph.nodes.has(resolved)) {
                return resolved;
            }
        }

        return null;
    }

    // ========================================================================
    // QUERY METHODS
    // ========================================================================

    /**
     * Get files that import a given file
     */
    public getImporters(filePath: string): string[] {
        return this._graph.edges
            .filter(e => e.to === filePath && e.type === 'import')
            .map(e => e.from);
    }

    /**
     * Get files that a given file imports
     */
    public getDependencies(filePath: string): string[] {
        return this._graph.edges
            .filter(e => e.from === filePath && e.type === 'import')
            .map(e => e.to);
    }

    /**
     * Get files related to a given file (importers + dependencies)
     */
    public getRelatedFiles(filePath: string): string[] {
        const related = new Set<string>();
        for (const e of this._graph.edges) {
            if (e.from === filePath) related.add(e.to);
            if (e.to === filePath) related.add(e.from);
        }
        return [...related];
    }

    /**
     * Format graph context for AI
     */
    public formatForAI(filePath: string): string {
        const node = this._graph.nodes.get(filePath);
        if (!node) return '';

        let context = `\n## File Relationships: ${filePath}\n`;
        context += `Functions: ${node.functions.slice(0, 10).join(', ')}\n`;
        context += `Classes: ${node.classes.join(', ')}\n`;

        const importers = this.getImporters(filePath);
        if (importers.length > 0) {
            context += `Imported by: ${importers.slice(0, 5).join(', ')}\n`;
        }

        const deps = this.getDependencies(filePath);
        if (deps.length > 0) {
            context += `Depends on: ${deps.slice(0, 5).join(', ')}\n`;
        }

        return context;
    }

    // ========================================================================
    // CUSTOM CONTEXT RULES
    // ========================================================================

    public addRule(rule: ContextRule): void {
        this._customRules.push(rule);
        this.saveRules();
    }

    public getRulesForContext(): string[] {
        const files: string[] = [];
        for (const rule of this._customRules) {
            if (rule.alwaysInclude) {
                for (const path of this._graph.nodes.keys()) {
                    if (this.matchPattern(path, rule.pattern)) {
                        files.push(path);
                    }
                }
            }
        }
        return files;
    }

    private matchPattern(path: string, pattern: string): boolean {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(path);
    }

    private loadRules(): void {
        try {
            const stored = this.storageService.get('supercode.contextRules', StorageScope.WORKSPACE);
            if (stored) {
                this._customRules = JSON.parse(stored);
            }
        } catch {
            this._customRules = [];
        }
    }

    private saveRules(): void {
        this.storageService.store(
            'supercode.contextRules',
            JSON.stringify(this._customRules),
            StorageScope.WORKSPACE,
            StorageTarget.MACHINE
        );
    }
}
