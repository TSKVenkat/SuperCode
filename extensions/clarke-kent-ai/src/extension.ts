import * as vscode from 'vscode';
import { OpenRouterClient } from './openrouter/client';
import { ChatViewProvider } from './webview/chatPanel';
import { CodeGenerationFeature } from './features/codeGeneration';
import { DebuggingFeature } from './features/debugging';
import { ProjectGenerationFeature } from './features/projectGeneration';

let openRouterClient: OpenRouterClient;
let chatViewProvider: ChatViewProvider;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Clarke Kent AI Assistant is now active!');

    // Initialize OpenRouter client
    openRouterClient = new OpenRouterClient(context);

    // Initialize features
    const codeGeneration = new CodeGenerationFeature(openRouterClient);
    const debugging = new DebuggingFeature(openRouterClient);
    const projectGeneration = new ProjectGenerationFeature(openRouterClient);

    // Register Chat View Provider
    chatViewProvider = new ChatViewProvider(context.extensionUri, openRouterClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('clarkeKent.chatView', chatViewProvider)
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.clarke-kent');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.generateCode', async () => {
            const prompt = await vscode.window.showInputBox({
                prompt: 'Describe the code you want to generate',
                placeHolder: 'e.g., Create a function that sorts an array of objects by a specified key'
            });
            if (prompt) {
                await codeGeneration.generateFromPrompt(prompt);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.refineSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showErrorMessage('Please select some code to refine');
                return;
            }

            const selectedText = editor.document.getText(selection);
            const instruction = await vscode.window.showInputBox({
                prompt: 'How would you like to refine this code?',
                placeHolder: 'e.g., Add error handling, optimize for performance, add comments'
            });

            if (instruction) {
                await codeGeneration.refineCode(selectedText, instruction, editor, selection);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.explainCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showErrorMessage('Please select some code to explain');
                return;
            }

            const selectedText = editor.document.getText(selection);
            await chatViewProvider.explainCode(selectedText);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.analyzeError', async () => {
            const errorText = await vscode.window.showInputBox({
                prompt: 'Paste the error message or stack trace',
                placeHolder: 'Error: ...'
            });
            if (errorText) {
                await debugging.analyzeError(errorText);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.generateProject', async () => {
            const description = await vscode.window.showInputBox({
                prompt: 'Describe the project you want to generate',
                placeHolder: 'e.g., A React todo app with authentication and local storage'
            });
            if (description) {
                await projectGeneration.generateProject(description);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.setApiKey', async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your OpenRouter API key',
                password: true,
                placeHolder: 'sk-or-...'
            });
            if (apiKey) {
                await openRouterClient.setApiKey(apiKey);
                vscode.window.showInformationMessage('Clarke Kent: API key saved successfully!');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.selectModel', async () => {
            const models = [
                { label: 'Claude 3.5 Sonnet', description: 'Best for complex reasoning', value: 'anthropic/claude-3.5-sonnet' },
                { label: 'Claude 3 Opus', description: 'Most capable Claude', value: 'anthropic/claude-3-opus' },
                { label: 'GPT-4o', description: 'Fast and capable', value: 'openai/gpt-4o' },
                { label: 'GPT-4 Turbo', description: 'Long context', value: 'openai/gpt-4-turbo' },
                { label: 'GPT-3.5 Turbo', description: 'Fast and cheap', value: 'openai/gpt-3.5-turbo' },
                { label: 'Gemini Pro', description: 'Google\'s model', value: 'google/gemini-pro' },
                { label: 'Llama 3.1 70B', description: 'Open source', value: 'meta-llama/llama-3.1-70b-instruct' }
            ];

            const selected = await vscode.window.showQuickPick(models, {
                placeHolder: 'Select an AI model'
            });

            if (selected) {
                const config = vscode.workspace.getConfiguration('clarkeKent');
                await config.update('defaultModel', selected.value, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Clarke Kent: Model set to ${selected.label}`);
            }
        })
    );

    // Show welcome message if no API key is set
    const hasApiKey = await openRouterClient.hasApiKey();
    if (!hasApiKey) {
        const setKey = await vscode.window.showInformationMessage(
            'Welcome to Clarke Kent AI! Set your OpenRouter API key to get started.',
            'Set API Key'
        );
        if (setKey) {
            vscode.commands.executeCommand('clarkeKent.setApiKey');
        }
    }
}

export function deactivate() {
    console.log('Clarke Kent AI Assistant deactivated');
}
