import * as vscode from 'vscode';
import { OpenRouterClient } from '../openrouter/client';

export class CodeGenerationFeature {
    constructor(private client: OpenRouterClient) { }

    async generateFromPrompt(prompt: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;

        // Determine language from current file
        let language: string | undefined;
        let context: string | undefined;

        if (editor) {
            language = editor.document.languageId;
            // Get some context from surrounding code
            const document = editor.document;
            const position = editor.selection.active;
            const startLine = Math.max(0, position.line - 10);
            const endLine = Math.min(document.lineCount, position.line + 10);
            context = document.getText(new vscode.Range(startLine, 0, endLine, 0));
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Clarke Kent is generating code...',
            cancellable: false
        }, async () => {
            try {
                const generatedCode = await this.client.generateCode(prompt, language, context);

                if (editor) {
                    // Insert at cursor position
                    await editor.edit(editBuilder => {
                        editBuilder.insert(editor.selection.active, generatedCode);
                    });
                } else {
                    // Create a new untitled document with the code
                    const doc = await vscode.workspace.openTextDocument({
                        content: generatedCode,
                        language: language || 'plaintext'
                    });
                    await vscode.window.showTextDocument(doc);
                }

                vscode.window.showInformationMessage('Clarke Kent: Code generated successfully!');
            } catch (error: any) {
                vscode.window.showErrorMessage(`Clarke Kent Error: ${error.message}`);
            }
        });
    }

    async refineCode(
        code: string,
        instruction: string,
        editor: vscode.TextEditor,
        selection: vscode.Selection
    ): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Clarke Kent is refining your code...',
            cancellable: false
        }, async () => {
            try {
                const refinedCode = await this.client.refineCode(code, instruction);

                // Extract just the code from the response (remove markdown formatting if present)
                const cleanCode = this.extractCode(refinedCode);

                // Show diff and ask for confirmation
                const apply = await vscode.window.showInformationMessage(
                    'Clarke Kent has refined your code. Apply changes?',
                    'Apply',
                    'Preview',
                    'Cancel'
                );

                if (apply === 'Apply') {
                    await editor.edit(editBuilder => {
                        editBuilder.replace(selection, cleanCode);
                    });
                    vscode.window.showInformationMessage('Clarke Kent: Code refined successfully!');
                } else if (apply === 'Preview') {
                    // Show in a diff view
                    const originalUri = vscode.Uri.parse('untitled:Original');
                    const refinedUri = vscode.Uri.parse('untitled:Refined');

                    // For now, just show in a new document
                    const doc = await vscode.workspace.openTextDocument({
                        content: cleanCode,
                        language: editor.document.languageId
                    });
                    await vscode.window.showTextDocument(doc, { preview: true });
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Clarke Kent Error: ${error.message}`);
            }
        });
    }

    private extractCode(response: string): string {
        // Remove markdown code blocks if present
        const codeBlockMatch = response.match(/```[\w]*\n([\s\S]*?)\n```/);
        if (codeBlockMatch) {
            return codeBlockMatch[1].trim();
        }
        return response.trim();
    }
}
