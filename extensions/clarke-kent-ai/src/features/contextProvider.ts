/*---------------------------------------------------------------------------------------------
 *  Clarke Kent AI - Context Provider
 *  Extracts rich context from the editor for AI prompts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

export interface EditorContext {
    code: string;
    language: string;
    fileName: string;
    filePath: string;
    workspaceName: string;
    selection: {
        startLine: number;
        endLine: number;
        isEmpty: boolean;
    };
    diagnostics: vscode.Diagnostic[];
    relatedFiles: string[];
}

export class ContextProvider {
    /**
     * Get comprehensive context from the active editor
     */
    public static async getEditorContext(): Promise<EditorContext | null> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return null;
        }

        const document = editor.document;
        const selection = editor.selection;

        // Get selected code or entire file
        const code = selection.isEmpty
            ? document.getText()
            : document.getText(selection);

        // Get diagnostics for current file
        const diagnostics = vscode.languages.getDiagnostics(document.uri);

        // Get related files in workspace
        const relatedFiles = await this.findRelatedFiles(document);

        return {
            code,
            language: document.languageId,
            fileName: path.basename(document.fileName),
            filePath: document.fileName,
            workspaceName: vscode.workspace.name || 'Unknown',
            selection: {
                startLine: selection.start.line + 1,
                endLine: selection.end.line + 1,
                isEmpty: selection.isEmpty
            },
            diagnostics,
            relatedFiles
        };
    }

    /**
     * Get surrounding code context for better understanding
     */
    public static getSurroundingCode(document: vscode.TextDocument, range: vscode.Range, linesBeforeAfter: number = 10): string {
        const startLine = Math.max(0, range.start.line - linesBeforeAfter);
        const endLine = Math.min(document.lineCount - 1, range.end.line + linesBeforeAfter);

        return document.getText(new vscode.Range(startLine, 0, endLine, 1000));
    }

    /**
     * Find related files based on imports/requires
     */
    private static async findRelatedFiles(document: vscode.TextDocument): Promise<string[]> {
        const text = document.getText();
        const languageId = document.languageId;
        const relatedFiles: string[] = [];

        try {
            // JavaScript/TypeScript imports
            if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(languageId)) {
                const importPattern = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;
                let match;
                while ((match = importPattern.exec(text)) !== null) {
                    const importPath = match[1];
                    if (importPath.startsWith('.')) {
                        relatedFiles.push(importPath);
                    }
                }
            }

            // Python imports
            if (languageId === 'python') {
                const importPattern = /(?:from|import)\s+(\w+)/g;
                let match;
                while ((match = importPattern.exec(text)) !== null) {
                    relatedFiles.push(match[1]);
                }
            }

            // Limit to first 5 related files for token efficiency
            return relatedFiles.slice(0, 5);
        } catch {
            return [];
        }
    }

    /**
     * Get project structure summary
     */
    public static async getProjectStructure(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return 'No workspace open';
        }

        try {
            const files = await vscode.workspace.findFiles(
                '**/*.{ts,js,py,java,c,cpp,go,rs}',
                '**/node_modules/**',
                50
            );

            const structure = files
                .map(f => vscode.workspace.asRelativePath(f))
                .sort()
                .join('\n');

            return structure || 'No source files found';
        } catch {
            return 'Unable to read project structure';
        }
    }

    /**
     * Build a context-aware prompt prefix
     */
    public static buildContextPrefix(context: EditorContext): string {
        let prefix = `**File**: ${context.fileName}\n`;
        prefix += `**Language**: ${context.language}\n`;

        if (!context.selection.isEmpty) {
            prefix += `**Selected Lines**: ${context.selection.startLine}-${context.selection.endLine}\n`;
        }

        if (context.diagnostics.length > 0) {
            const errors = context.diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
            if (errors.length > 0) {
                prefix += `**Active Errors**: ${errors.length}\n`;
            }
        }

        prefix += '\n';
        return prefix;
    }

    /**
     * Get the testing framework likely used in the project
     */
    public static async detectTestFramework(): Promise<string> {
        try {
            // Check package.json for JS/TS projects
            const packageFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 1);
            if (packageFiles.length > 0) {
                const content = await vscode.workspace.fs.readFile(packageFiles[0]);
                const pkg = JSON.parse(content.toString());
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };

                if (deps.jest) return 'Jest';
                if (deps.mocha) return 'Mocha';
                if (deps.jasmine) return 'Jasmine';
                if (deps.vitest) return 'Vitest';
                if (deps['@testing-library/react']) return 'React Testing Library with Jest';
                return 'Jest'; // Default for JS/TS
            }

            // Check for pytest (Python)
            const pytestFiles = await vscode.workspace.findFiles('**/pytest.ini', '', 1);
            if (pytestFiles.length > 0) return 'pytest';

            const setupPy = await vscode.workspace.findFiles('**/setup.py', '', 1);
            if (setupPy.length > 0) return 'pytest';

            return 'appropriate framework';
        } catch {
            return 'appropriate framework';
        }
    }
}
