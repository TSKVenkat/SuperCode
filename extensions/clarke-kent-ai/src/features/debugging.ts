import * as vscode from 'vscode';
import { OpenRouterClient } from '../openrouter/client';

export class DebuggingFeature {
    constructor(private client: OpenRouterClient) { }

    async analyzeError(errorText: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        let context: string | undefined;

        if (editor) {
            // Get the entire file as context
            context = editor.document.getText();
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Clarke Kent is analyzing the error...',
            cancellable: false
        }, async () => {
            try {
                const analysis = await this.client.analyzeError(errorText, context);

                // Show the analysis in a new document
                const doc = await vscode.workspace.openTextDocument({
                    content: `# Error Analysis by Clarke Kent\n\n${analysis}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc, { preview: true });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Clarke Kent Error: ${error.message}`);
            }
        });
    }

    async fixError(errorText: string, code: string): Promise<string | null> {
        try {
            const messages = [
                {
                    role: 'user' as const,
                    content: `Fix the following error in this code:

Error:
${errorText}

Code:
\`\`\`
${code}
\`\`\`

Provide only the corrected code without explanations.`
                }
            ];

            return await this.client.chat(messages, 'debugging');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Clarke Kent Error: ${error.message}`);
            return null;
        }
    }
}
