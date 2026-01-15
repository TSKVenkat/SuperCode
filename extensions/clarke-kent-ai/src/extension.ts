/*---------------------------------------------------------------------------------------------
 *  Clarke Kent AI - Superman's AI Assistant for SuperCode
 *  Powered by OpenRouter with FREE models
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentChatPanel } from './features/agentChat';
import { ContextProvider } from './features/contextProvider';
import { EditorIntegration } from './features/editorIntegration';
import { SLASH_COMMANDS, getModelForCommand, extractSuggestions } from './features/slashCommands';

// Free models on OpenRouter
const FREE_MODELS = [
    { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B', description: 'Powerful open-source model' },
    { id: 'qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B', description: 'Specialized for coding' },
    { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1', description: 'Reasoning-focused model' },
    { id: 'deepseek/deepseek-chat:free', name: 'DeepSeek Chat', description: 'General purpose AI' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct:free', name: 'Nemotron 70B', description: 'NVIDIA high quality' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', description: 'Latest Llama model' }
];

let apiKey: string | undefined;
let currentModel: string;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Clarke Kent AI: Initializing...');

    // Load saved API key and model
    apiKey = await context.secrets.get('openrouter.apiKey');
    currentModel = context.globalState.get('selectedModel', FREE_MODELS[0].id);

    // ========================
    // Core Commands
    // ========================

    // Set API Key
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                prompt: 'Enter your OpenRouter API Key',
                password: true,
                placeHolder: 'sk-or-...',
                ignoreFocusOut: true
            });
            if (key) {
                await context.secrets.store('openrouter.apiKey', key);
                apiKey = key;
                vscode.window.showInformationMessage('✅ OpenRouter API key saved!');
            }
        })
    );

    // Select Model
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.selectModel', async () => {
            const items = FREE_MODELS.map(m => ({
                label: m.name,
                description: m.description,
                detail: m.id,
                id: m.id
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select AI Model',
                matchOnDescription: true
            });

            if (selected) {
                currentModel = selected.id;
                await context.globalState.update('selectedModel', currentModel);
                vscode.window.showInformationMessage(`🤖 Now using ${selected.label}`);
            }
        })
    );

    // ========================
    // Agent Chat Panel (NEW)
    // ========================
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.openAgent', () => {
            AgentChatPanel.createOrShow(context);
        })
    );

    // ========================
    // Quick Chat (existing)
    // ========================
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.chat', async () => {
            if (!apiKey) {
                const setKey = await vscode.window.showWarningMessage(
                    'OpenRouter API key not set',
                    'Set API Key'
                );
                if (setKey) {
                    await vscode.commands.executeCommand('clarkeKent.setApiKey');
                }
                return;
            }

            const input = await vscode.window.showInputBox({
                prompt: 'Ask Clarke Kent anything...',
                placeHolder: 'How can I help you today?',
                ignoreFocusOut: true
            });

            if (!input) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '🦸 Clarke Kent is thinking...',
                cancellable: true
            }, async (progress, token) => {
                try {
                    const response = await sendMessage(input, token);
                    const doc = await vscode.workspace.openTextDocument({
                        content: `# Clarke Kent's Response\n\n${response}`,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, { preview: true });
                } catch (error: any) {
                    if (!token.isCancellationRequested) {
                        vscode.window.showErrorMessage(`Error: ${error.message}`);
                    }
                }
            });
        })
    );

    // ========================
    // Slash Commands (individual commands for menu/keybindings)
    // ========================

    // /explain
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.explainCode', async () => {
            await executeSlashCommand('/explain');
        })
    );

    // /fix
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.fixCode', async () => {
            await executeSlashCommand('/fix');
        })
    );

    // /test
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.generateTests', async () => {
            await executeSlashCommand('/test');
        })
    );

    // /refactor
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.refactorCode', async () => {
            await executeSlashCommand('/refactor');
        })
    );

    // /docs
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.generateDocs', async () => {
            await executeSlashCommand('/docs');
        })
    );

    // /review
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.reviewCode', async () => {
            await executeSlashCommand('/review');
        })
    );

    // /security
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.securityScan', async () => {
            await executeSlashCommand('/security');
        })
    );

    // /optimize
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.optimizeCode', async () => {
            await executeSlashCommand('/optimize');
        })
    );

    // /convert
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.convertCode', async () => {
            const targetLang = await vscode.window.showInputBox({
                prompt: 'Convert to which language?',
                placeHolder: 'e.g., Python, TypeScript, Go, Rust...'
            });
            if (targetLang) {
                await executeSlashCommand('/convert', targetLang);
            }
        })
    );

    // ========================
    // Helper Functions
    // ========================

    async function executeSlashCommand(command: string, args: string = ''): Promise<void> {
        if (!apiKey) {
            vscode.window.showWarningMessage('Set your OpenRouter API key first');
            return;
        }

        const editorContext = await ContextProvider.getEditorContext();
        if (!editorContext || !editorContext.code.trim()) {
            vscode.window.showWarningMessage('Select some code first');
            return;
        }

        const commandHandler = SLASH_COMMANDS[command];
        if (!commandHandler) {
            vscode.window.showErrorMessage(`Unknown command: ${command}`);
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `🦸 Clarke Kent: ${commandHandler.name}...`,
            cancellable: true
        }, async (progress, token) => {
            try {
                const result = await commandHandler.handler(args, editorContext);
                const model = getModelForCommand(command);

                const response = await sendMessageWithModel(result.content, model, token);

                // Handle action
                if (result.action === 'replace' || result.action === 'newFile') {
                    const choice = await vscode.window.showInformationMessage(
                        'Apply changes?',
                        'Apply',
                        'View Only',
                        'Cancel'
                    );

                    if (choice === 'Apply') {
                        await EditorIntegration.applyAction(
                            result.action,
                            response,
                            { language: editorContext.language, command }
                        );
                    } else if (choice === 'View Only') {
                        await EditorIntegration.displayResponse(response, commandHandler.name);
                    }
                } else {
                    await EditorIntegration.displayResponse(response, commandHandler.name);
                }

                // Show follow-up suggestions
                const suggestions = extractSuggestions(response);
                if (suggestions.length > 0) {
                    const next = await vscode.window.showInformationMessage(
                        'What next?',
                        ...suggestions.map(s => s.replace('/', ''))
                    );
                    if (next) {
                        await executeSlashCommand(`/${next}`);
                    }
                }

            } catch (error: any) {
                if (!token.isCancellationRequested) {
                    vscode.window.showErrorMessage(`Error: ${error.message}`);
                }
            }
        });
    }

    // Show activation message
    if (apiKey) {
        vscode.window.showInformationMessage(
            `🦸 Clarke Kent AI is ready! Using ${FREE_MODELS.find(m => m.id === currentModel)?.name || 'AI'}`,
            'Open Agent Panel'
        ).then(selection => {
            if (selection === 'Open Agent Panel') {
                vscode.commands.executeCommand('clarkeKent.openAgent');
            }
        });
    } else {
        vscode.window.showInformationMessage(
            '🦸 Clarke Kent AI is ready! Set your OpenRouter API key to start.',
            'Set API Key',
            'Open Agent'
        ).then(selection => {
            if (selection === 'Set API Key') {
                vscode.commands.executeCommand('clarkeKent.setApiKey');
            } else if (selection === 'Open Agent') {
                vscode.commands.executeCommand('clarkeKent.openAgent');
            }
        });
    }

    console.log('Clarke Kent AI: Activated successfully with 9 slash commands!');
}

async function sendMessage(prompt: string, token: vscode.CancellationToken): Promise<string> {
    return sendMessageWithModel(prompt, currentModel, token);
}

async function sendMessageWithModel(prompt: string, model: string, token: vscode.CancellationToken): Promise<string> {
    if (!apiKey) {
        throw new Error('OpenRouter API key not set');
    }

    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());

    const systemPrompt = `You are Clarke Kent, a brilliant AI coding assistant for SuperCode IDE. You are:
- Helpful, knowledgeable, and super-powered (like a certain Kryptonian)
- Concise but thorough in explanations
- Always ready to save developers from bugs and bad code

When providing code, always wrap it in markdown code blocks with the language specified.

IMPORTANT: At the end of your response, include:
**Suggestions:** /cmd1, /cmd2, /cmd3

where the commands are relevant follow-up actions from: explain, fix, test, refactor, docs, review, security, optimize, convert`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://supercode.dev',
            'X-Title': 'SuperCode IDE - Clarke Kent AI'
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ]
        }),
        signal: controller.signal
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || 'No response received';
}

export function deactivate() {
    console.log('Clarke Kent AI: Deactivated');
}
