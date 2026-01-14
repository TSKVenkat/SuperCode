import * as vscode from 'vscode';
import axios from 'axios';

const DEBUG_SYSTEM_PROMPT = `You are an expert debugging assistant. Analyze the error and provide:
1. A clear explanation of what went wrong
2. The root cause of the error
3. A step-by-step fix
4. Code snippets to fix the issue (if applicable)

Be concise but thorough. Format code in markdown code blocks.`;

export class DebuggingAssistant {
    private apiKey: string | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadApiKey();
    }

    private async loadApiKey(): Promise<void> {
        this.apiKey = await this.context.secrets.get('clarkeKent.openRouterApiKey');
    }

    async analyzeError(errorText: string, codeContext?: string): Promise<string> {
        if (!this.apiKey) {
            return '🔑 Please set your OpenRouter API key first using "Clarke Kent: Set OpenRouter API Key"';
        }

        const messages = [
            { role: 'system', content: DEBUG_SYSTEM_PROMPT },
            {
                role: 'user',
                content: `Analyze this error:\n\n\`\`\`\n${errorText}\n\`\`\`${codeContext ? `\n\nRelevant code:\n\`\`\`\n${codeContext}\n\`\`\`` : ''}`
            }
        ];

        try {
            const config = vscode.workspace.getConfiguration('clarkeKent');
            const model = config.get('model', 'anthropic/claude-3.5-sonnet');

            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                { model, messages },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://supercode.dev',
                        'X-Title': 'SuperCode IDE - Debugging Assistant'
                    }
                }
            );

            return response.data.choices[0].message.content;
        } catch (error: any) {
            return `❌ Error analyzing: ${error.message}`;
        }
    }

    async analyzeCurrentDiagnostics(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
        const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

        if (errors.length === 0) {
            vscode.window.showInformationMessage('No errors found in current file');
            return;
        }

        // Get the first error
        const firstError = errors[0];
        const lineContent = editor.document.lineAt(firstError.range.start.line).text;

        // Get surrounding context (5 lines before and after)
        const startLine = Math.max(0, firstError.range.start.line - 5);
        const endLine = Math.min(editor.document.lineCount - 1, firstError.range.start.line + 5);
        const context = editor.document.getText(new vscode.Range(startLine, 0, endLine, 1000));

        const errorInfo = `${firstError.message}\nLine ${firstError.range.start.line + 1}: ${lineContent}`;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Clarke Kent is analyzing the error...',
                cancellable: false
            },
            async () => {
                const analysis = await this.analyzeError(errorInfo, context);
                this.showAnalysisPanel(analysis, firstError);
            }
        );
    }

    private showAnalysisPanel(analysis: string, diagnostic: vscode.Diagnostic): void {
        const panel = vscode.window.createWebviewPanel(
            'clarkeKentDebug',
            '🔍 Error Analysis',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
        h1 { color: #569cd6; border-bottom: 1px solid #333; padding-bottom: 10px; }
        .error-badge { background: #f48771; color: #1e1e1e; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        pre { background: #2d2d2d; padding: 16px; border-radius: 6px; overflow-x: auto; }
        code { font-family: Consolas, monospace; }
        .fix-button { background: #4fc3f7; color: #1e1e1e; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-top: 10px; }
        .fix-button:hover { background: #29b6f6; }
    </style>
</head>
<body>
    <h1>🦸 Clarke Kent Debug Analysis</h1>
    <p><span class="error-badge">ERROR</span> Line ${diagnostic.range.start.line + 1}</p>
    <div style="background:#2d2d2d;padding:16px;border-radius:6px;margin:16px 0;">
        <code>${diagnostic.message}</code>
    </div>
    <h2 style="color:#dcdcaa;">Analysis</h2>
    <div>${this.markdownToHtml(analysis)}</div>
</body>
</html>`;
    }

    private markdownToHtml(md: string): string {
        return md
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code style="background:#333;padding:2px 6px;border-radius:3px;">$1</code>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/^### (.*$)/gm, '<h3 style="color:#dcdcaa;">$1</h3>')
            .replace(/^## (.*$)/gm, '<h2 style="color:#dcdcaa;">$1</h2>')
            .replace(/^# (.*$)/gm, '<h1 style="color:#569cd6;">$1</h1>')
            .replace(/^- (.*$)/gm, '<li>$1</li>')
            .replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
            .replace(/\n/g, '<br>');
    }

    async suggestFix(errorText: string): Promise<string | undefined> {
        if (!this.apiKey) {
            return undefined;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }

        const document = editor.document;
        const fullCode = document.getText();

        const messages = [
            {
                role: 'system',
                content: 'You are a code repair assistant. Given an error and code, output ONLY the corrected code. No explanations, no markdown, just the fixed code.'
            },
            {
                role: 'user',
                content: `Error: ${errorText}\n\nCode:\n${fullCode}`
            }
        ];

        try {
            const config = vscode.workspace.getConfiguration('clarkeKent');
            const model = config.get('model', 'anthropic/claude-3.5-sonnet');

            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                { model, messages },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data.choices[0].message.content;
        } catch {
            return undefined;
        }
    }
}
