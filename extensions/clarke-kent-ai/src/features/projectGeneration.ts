import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OpenRouterClient } from '../openrouter/client';

interface ProjectFile {
    path: string;
    content: string;
}

export class ProjectGenerationFeature {
    constructor(private client: OpenRouterClient) { }

    async generateProject(description: string): Promise<void> {
        // Ask for project location
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Project Location'
        });

        if (!folderUri || folderUri.length === 0) {
            return;
        }

        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter project name',
            placeHolder: 'my-awesome-project'
        });

        if (!projectName) {
            return;
        }

        const projectPath = path.join(folderUri[0].fsPath, projectName);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Clarke Kent is generating your project...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: 'Planning project structure...' });

                // First, get the project plan
                const plan = await this.client.planProject(description);

                progress.report({ message: 'Generating files...', increment: 30 });

                // Parse the plan and generate individual files
                const files = await this.generateProjectFiles(description, plan);

                progress.report({ message: 'Writing files to disk...', increment: 30 });

                // Create project directory
                if (!fs.existsSync(projectPath)) {
                    fs.mkdirSync(projectPath, { recursive: true });
                }

                // Write all files
                for (const file of files) {
                    const filePath = path.join(projectPath, file.path);
                    const fileDir = path.dirname(filePath);

                    if (!fs.existsSync(fileDir)) {
                        fs.mkdirSync(fileDir, { recursive: true });
                    }

                    fs.writeFileSync(filePath, file.content, 'utf-8');
                }

                progress.report({ message: 'Opening project...', increment: 30 });

                // Write the project plan as README
                const readmePath = path.join(projectPath, 'CLARKE_KENT_PLAN.md');
                fs.writeFileSync(readmePath, `# Project Plan by Clarke Kent\n\n${plan}`, 'utf-8');

                // Open the project in a new window
                const openFolder = await vscode.window.showInformationMessage(
                    `Clarke Kent: Project "${projectName}" generated successfully!`,
                    'Open Project',
                    'Open in New Window'
                );

                if (openFolder === 'Open Project') {
                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), false);
                } else if (openFolder === 'Open in New Window') {
                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), true);
                }

            } catch (error: any) {
                vscode.window.showErrorMessage(`Clarke Kent Error: ${error.message}`);
            }
        });
    }

    private async generateProjectFiles(description: string, plan: string): Promise<ProjectFile[]> {
        // Parse the plan to identify files needed
        const messages = [
            {
                role: 'user' as const,
                content: `Based on this project plan, generate all the necessary files with their complete content.

Project Description: ${description}

Project Plan:
${plan}

Return the response in this exact JSON format only (no markdown, no explanation):
{
    "files": [
        {"path": "src/index.ts", "content": "// file content here"},
        {"path": "package.json", "content": "{ ... }"}
    ]
}

Include all necessary files: package.json, config files, source files, etc.
Make sure each file has complete, working content.`
            }
        ];

        const response = await this.client.chat(messages, 'codeGen');

        try {
            // Try to extract JSON from the response
            let jsonStr = response;

            // Remove markdown code blocks if present
            const jsonMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }

            const parsed = JSON.parse(jsonStr);
            return parsed.files || [];
        } catch (e) {
            // If parsing fails, return a basic structure
            return [
                {
                    path: 'README.md',
                    content: `# ${description}\n\nGenerated by Clarke Kent AI\n\n${plan}`
                }
            ];
        }
    }
}
