import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

const PROJECT_PLANNING_PROMPT = `You are a project scaffolding assistant. Based on the user's description, create a complete project structure.

Output a JSON object with this structure:
{
    "projectName": "name-of-project",
    "description": "Brief description",
    "files": [
        {
            "path": "relative/path/to/file.ext",
            "content": "file content here"
        }
    ],
    "commands": ["npm install", "other setup commands"]
}

Create production-ready code with:
- Proper file organization
- Best practices
- Comments where helpful
- Complete implementation (not stubs)`;

interface ProjectFile {
    path: string;
    content: string;
}

interface ProjectPlan {
    projectName: string;
    description: string;
    files: ProjectFile[];
    commands: string[];
}

export class ProjectGenerator {
    private apiKey: string | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadApiKey();
    }

    private async loadApiKey(): Promise<void> {
        this.apiKey = await this.context.secrets.get('clarkeKent.openRouterApiKey');
    }

    async generateProject(description: string): Promise<void> {
        if (!this.apiKey) {
            vscode.window.showErrorMessage('Please set your OpenRouter API key first');
            return;
        }

        // Get target folder
        const folders = vscode.workspace.workspaceFolders;
        let targetFolder: string;

        if (folders && folders.length > 0) {
            targetFolder = folders[0].uri.fsPath;
        } else {
            const selected = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: 'Select project location'
            });

            if (!selected || selected.length === 0) {
                return;
            }
            targetFolder = selected[0].fsPath;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Clarke Kent is generating your project...',
                cancellable: false
            },
            async (progress) => {
                progress.report({ message: 'Planning project structure...' });

                const plan = await this.generatePlan(description);
                if (!plan) {
                    vscode.window.showErrorMessage('Failed to generate project plan');
                    return;
                }

                progress.report({ message: 'Creating files...', increment: 30 });

                const projectPath = path.join(targetFolder, plan.projectName);

                // Create project directory
                if (!fs.existsSync(projectPath)) {
                    fs.mkdirSync(projectPath, { recursive: true });
                }

                // Create all files
                for (const file of plan.files) {
                    const filePath = path.join(projectPath, file.path);
                    const fileDir = path.dirname(filePath);

                    if (!fs.existsSync(fileDir)) {
                        fs.mkdirSync(fileDir, { recursive: true });
                    }

                    fs.writeFileSync(filePath, file.content, 'utf8');
                }

                progress.report({ message: 'Opening project...', increment: 50 });

                // Open the project
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), { forceNewWindow: false });

                vscode.window.showInformationMessage(
                    `Project "${plan.projectName}" created successfully!`,
                    'Run Setup Commands'
                ).then(selection => {
                    if (selection === 'Run Setup Commands' && plan.commands.length > 0) {
                        const terminal = vscode.window.createTerminal('Project Setup');
                        terminal.show();
                        for (const cmd of plan.commands) {
                            terminal.sendText(cmd);
                        }
                    }
                });
            }
        );
    }

    private async generatePlan(description: string): Promise<ProjectPlan | null> {
        const config = vscode.workspace.getConfiguration('clarkeKent');
        const model = config.get('model', 'anthropic/claude-3.5-sonnet');

        try {
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: PROJECT_PLANNING_PROMPT },
                        { role: 'user', content: description }
                    ],
                    response_format: { type: 'json_object' }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://supercode.dev'
                    }
                }
            );

            const content = response.data.choices[0].message.content;

            // Extract JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as ProjectPlan;
            }

            return JSON.parse(content) as ProjectPlan;
        } catch (error: any) {
            console.error('Project generation error:', error);
            return null;
        }
    }
}
