/*---------------------------------------------------------------------------------------------
 *  Clarke Kent AI - Editor Integration
 *  Apply AI responses directly to the editor
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { extractCodeBlock } from './slashCommands';

export class EditorIntegration {
    /**
     * Replace selected code or entire file with new code
     */
    public static async replaceCode(response: string): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return false;
        }

        const codeBlock = extractCodeBlock(response);
        if (!codeBlock) {
            vscode.window.showWarningMessage('No code block found in response');
            return false;
        }

        const success = await editor.edit(editBuilder => {
            if (editor.selection.isEmpty) {
                // Replace entire file
                const fullRange = new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(editor.document.getText().length)
                );
                editBuilder.replace(fullRange, codeBlock);
            } else {
                // Replace selection
                editBuilder.replace(editor.selection, codeBlock);
            }
        });

        if (success) {
            vscode.window.showInformationMessage('✅ Code applied by Clarke Kent!');
        }

        return success;
    }

    /**
     * Insert code at cursor position
     */
    public static async insertCode(response: string): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return false;
        }

        const codeBlock = extractCodeBlock(response);
        if (!codeBlock) {
            vscode.window.showWarningMessage('No code block found in response');
            return false;
        }

        const success = await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, codeBlock);
        });

        if (success) {
            vscode.window.showInformationMessage('✅ Code inserted by Clarke Kent!');
        }

        return success;
    }

    /**
     * Create a new file with the generated code
     */
    public static async createNewFile(
        response: string,
        suggestedName?: string,
        language?: string
    ): Promise<boolean> {
        const codeBlock = extractCodeBlock(response);
        if (!codeBlock) {
            // If no code block, use the entire response
            const doc = await vscode.workspace.openTextDocument({
                content: response,
                language: language || 'markdown'
            });
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
            return true;
        }

        // Determine file extension based on language
        const extension = this.getExtensionForLanguage(language);
        const defaultName = suggestedName || `new_file${extension}`;

        // Ask user for file name
        const fileName = await vscode.window.showInputBox({
            prompt: 'Enter file name for the generated code',
            value: defaultName,
            placeHolder: 'e.g., test_example.py or MyComponent.test.tsx'
        });

        if (!fileName) {
            // User cancelled, just open as untitled document
            const doc = await vscode.workspace.openTextDocument({
                content: codeBlock,
                language: language || 'plaintext'
            });
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
            return true;
        }

        // Get workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            // No workspace, open as untitled
            const doc = await vscode.workspace.openTextDocument({
                content: codeBlock,
                language: language || this.getLanguageFromExtension(path.extname(fileName))
            });
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
            return true;
        }

        // Create file in workspace
        const filePath = path.join(workspaceFolders[0].uri.fsPath, fileName);
        const dirPath = path.dirname(filePath);

        // Ensure directory exists
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        // Write file
        fs.writeFileSync(filePath, codeBlock, 'utf8');

        // Open the new file
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

        vscode.window.showInformationMessage(`✅ Created: ${fileName}`);
        return true;
    }

    /**
     * Run a command in the terminal
     */
    public static async runInTerminal(command: string, name: string = 'Clarke Kent'): Promise<void> {
        const terminal = vscode.window.createTerminal({
            name: `🦸 ${name}`,
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        });
        terminal.show();
        terminal.sendText(command);
    }

    /**
     * Display response in a new markdown document
     */
    public static async displayResponse(
        response: string,
        title: string = 'Clarke Kent Response'
    ): Promise<void> {
        const content = `# 🦸 ${title}\n\n${response}`;

        const doc = await vscode.workspace.openTextDocument({
            content,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        });
    }

    /**
     * Show diff between original and new code
     */
    public static async showDiff(original: string, modified: string, title: string = 'Changes'): Promise<void> {
        const originalUri = vscode.Uri.parse(`untitled:Original-${Date.now()}`);
        const modifiedUri = vscode.Uri.parse(`untitled:Modified-${Date.now()}`);

        // This is a simplified approach - in a real implementation,
        // you'd use a proper diff provider
        const diffTitle = `Clarke Kent: ${title}`;

        // For now, show side by side in markdown
        const content = `# Changes by Clarke Kent

## Original
\`\`\`
${original}
\`\`\`

## Modified
\`\`\`
${modified}
\`\`\`
`;
        await this.displayResponse(content, 'Code Changes');
    }

    /**
     * Highlight specific code regions (for review/security commands)
     */
    public static highlightRange(
        editor: vscode.TextEditor,
        startLine: number,
        endLine: number,
        type: 'error' | 'warning' | 'info' = 'warning'
    ): vscode.TextEditorDecorationType {
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: type === 'error'
                ? 'rgba(255, 0, 0, 0.2)'
                : type === 'warning'
                    ? 'rgba(255, 200, 0, 0.2)'
                    : 'rgba(0, 150, 255, 0.2)',
            borderRadius: '3px',
            isWholeLine: true
        });

        const range = new vscode.Range(startLine - 1, 0, endLine - 1, 1000);
        editor.setDecorations(decorationType, [range]);

        // Auto-dispose after 30 seconds
        setTimeout(() => decorationType.dispose(), 30000);

        return decorationType;
    }

    /**
     * Get file extension for a language
     */
    private static getExtensionForLanguage(language?: string): string {
        const map: Record<string, string> = {
            'javascript': '.js',
            'typescript': '.ts',
            'javascriptreact': '.jsx',
            'typescriptreact': '.tsx',
            'python': '.py',
            'java': '.java',
            'go': '.go',
            'rust': '.rs',
            'c': '.c',
            'cpp': '.cpp',
            'csharp': '.cs',
            'ruby': '.rb',
            'php': '.php',
            'swift': '.swift',
            'kotlin': '.kt'
        };
        return map[language || ''] || '.txt';
    }

    /**
     * Get language from file extension
     */
    private static getLanguageFromExtension(ext: string): string {
        const map: Record<string, string> = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.jsx': 'javascriptreact',
            '.tsx': 'typescriptreact',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.c': 'c',
            '.cpp': 'cpp',
            '.cs': 'csharp',
            '.rb': 'ruby',
            '.php': 'php',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.md': 'markdown'
        };
        return map[ext] || 'plaintext';
    }

    /**
     * Apply action based on command result
     */
    public static async applyAction(
        action: 'replace' | 'insert' | 'newFile' | 'terminal' | 'display',
        response: string,
        context?: { language?: string; command?: string }
    ): Promise<void> {
        switch (action) {
            case 'replace':
                await this.replaceCode(response);
                break;
            case 'insert':
                await this.insertCode(response);
                break;
            case 'newFile':
                const suggestedName = context?.command === '/test'
                    ? `test_${Date.now()}${this.getExtensionForLanguage(context?.language)}`
                    : undefined;
                await this.createNewFile(response, suggestedName, context?.language);
                break;
            case 'terminal':
                const codeBlock = extractCodeBlock(response);
                if (codeBlock) {
                    await this.runInTerminal(codeBlock);
                }
                break;
            case 'display':
            default:
                await this.displayResponse(response);
                break;
        }
    }
}
