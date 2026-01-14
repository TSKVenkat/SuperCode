import * as vscode from 'vscode';
import { PlanningService, Plan } from './planningService';

export class PlanningPanel {
    public static currentPanel: PlanningPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _planningService: PlanningService;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, planningService: PlanningService) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._planningService = planningService;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'executeStep':
                        await this.executeStep(message.stepId);
                        return;
                    case 'updateStatus':
                        this._planningService.updateStepStatus(message.stepId, message.status);
                        this._update();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, planningService: PlanningService) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (PlanningPanel.currentPanel) {
            PlanningPanel.currentPanel._panel.reveal(column);
            PlanningPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'clarkeKentPlanning',
            'Clarke Kent: Plan',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        PlanningPanel.currentPanel = new PlanningPanel(panel, extensionUri, planningService);
    }

    public dispose() {
        PlanningPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async executeStep(stepId: string) {
        const plan = this._planningService.getCurrentPlan();
        if (!plan) return;

        const step = plan.steps.find(s => s.id === stepId);
        if (!step) return;

        this._planningService.updateStepStatus(stepId, 'in-progress');
        this._update();

        try {
            if (step.command) {
                const terminal = vscode.window.createTerminal(`Clarke Kent: ${step.id}`);
                terminal.show();
                terminal.sendText(step.command);
                // Note: We can't easily know when the terminal command finishes without more complex logic
                // For now, we'll mark it as completed, but in a real agent we'd wait for exit code
                this._planningService.updateStepStatus(stepId, 'completed');
            } else {
                // If no command, it might be a manual step or code generation
                // For now, just mark completed
                this._planningService.updateStepStatus(stepId, 'completed');
            }
        } catch (error) {
            this._planningService.updateStepStatus(stepId, 'failed');
            vscode.window.showErrorMessage(`Failed to execute step: ${error}`);
        }

        this._update();
    }

    private _update() {
        const plan = this._planningService.getCurrentPlan();
        this._panel.webview.html = this._getHtmlForWebview(plan);
    }

    private _getHtmlForWebview(plan: Plan | undefined) {
        if (!plan) {
            return `<!DOCTYPE html>
            <html lang="en">
            <body>
                <h1>No Active Plan</h1>
                <p>Use "Clarke Kent: Create Plan" to start.</p>
            </body>
            </html>`;
        }

        const stepsHtml = plan.steps.map(step => `
            <div class="step ${step.status}">
                <div class="header">
                    <span class="status-icon ${step.status}"></span>
                    <span class="title">${step.description}</span>
                </div>
                ${step.command ? `<div class="command"><code>${step.command}</code></div>` : ''}
                <div class="actions">
                    ${step.status !== 'completed' ? `<button onclick="executeStep('${step.id}')">Execute</button>` : ''}
                </div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Clarke Kent Plan</title>
            <style>
                body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
                .step { border: 1px solid var(--vscode-widget-border); margin-bottom: 10px; padding: 10px; border-radius: 4px; }
                .step.completed { border-color: var(--vscode-testing-iconPassed); }
                .step.in-progress { border-color: var(--vscode-progressBar-background); }
                .header { display: flex; align-items: center; gap: 10px; font-weight: bold; }
                .command { background: var(--vscode-textBlockQuote-background); padding: 5px; margin-top: 5px; font-family: monospace; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 10px; cursor: pointer; margin-top: 5px; }
                button:hover { background: var(--vscode-button-hoverBackground); }
            </style>
        </head>
        <body>
            <h1>${plan.goal}</h1>
            <div class="steps">
                ${stepsHtml}
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                function executeStep(stepId) {
                    vscode.postMessage({ command: 'executeStep', stepId: stepId });
                }
            </script>
        </body>
        </html>`;
    }
}
