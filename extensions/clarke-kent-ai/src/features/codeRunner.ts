import * as vscode from 'vscode';
import * as path from 'path';

interface RunConfiguration {
    [key: string]: string;
}

export class CodeRunner {
    private static currentTerminal: vscode.Terminal | undefined;
    private static runningProcess: boolean = false;

    public static async runCurrentFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active file to run');
            return;
        }

        const document = editor.document;
        await document.save();

        const languageId = document.languageId;
        const filePath = document.fileName;
        const fileDir = path.dirname(filePath);
        const fileBasename = path.basename(filePath);
        const fileBasenameNoExt = path.basename(filePath, path.extname(filePath));

        const config = vscode.workspace.getConfiguration('clarkeKent');
        const runConfigs: RunConfiguration = config.get('runConfigurations', {});

        let command = runConfigs[languageId];

        if (!command) {
            // Default fallback commands
            const defaults: RunConfiguration = {
                'python': 'python3 ${file}',
                'javascript': 'node ${file}',
                'typescript': 'npx ts-node ${file}',
                'go': 'go run ${file}',
                'rust': 'cargo run',
                'java': 'javac ${file} && java -cp ${fileDirname} ${fileBasenameNoExtension}',
                'c': 'gcc ${file} -o ${fileBasenameNoExtension} && ./${fileBasenameNoExtension}',
                'cpp': 'g++ ${file} -o ${fileBasenameNoExtension} && ./${fileBasenameNoExtension}',
                'ruby': 'ruby ${file}',
                'php': 'php ${file}',
                'perl': 'perl ${file}',
                'shellscript': 'bash ${file}',
                'powershell': 'pwsh ${file}'
            };
            command = defaults[languageId];
        }

        if (!command) {
            const customCommand = await vscode.window.showInputBox({
                prompt: `No run configuration for ${languageId}. Enter a command:`,
                placeHolder: 'e.g., python3 ${file}'
            });
            if (!customCommand) {
                return;
            }
            command = customCommand;
        }

        // Replace variables
        command = command
            .replace(/\$\{file\}/g, filePath)
            .replace(/\$\{fileBasename\}/g, fileBasename)
            .replace(/\$\{fileBasenameNoExtension\}/g, fileBasenameNoExt)
            .replace(/\$\{fileDirname\}/g, fileDir);

        // Create or reuse terminal
        if (!CodeRunner.currentTerminal || CodeRunner.currentTerminal.exitStatus !== undefined) {
            CodeRunner.currentTerminal = vscode.window.createTerminal({
                name: '⚡ SuperCode Runner',
                cwd: fileDir
            });
        }

        CodeRunner.currentTerminal.show();
        CodeRunner.currentTerminal.sendText(`cd "${fileDir}" && ${command}`);
        CodeRunner.runningProcess = true;

        vscode.window.showInformationMessage(`Running: ${fileBasename}`);
    }

    public static stopExecution(): void {
        if (CodeRunner.currentTerminal) {
            CodeRunner.currentTerminal.sendText('\x03'); // Ctrl+C
            vscode.window.showInformationMessage('Execution stopped');
            CodeRunner.runningProcess = false;
        } else {
            vscode.window.showWarningMessage('No running process to stop');
        }
    }

    public static isRunning(): boolean {
        return CodeRunner.runningProcess;
    }
}
