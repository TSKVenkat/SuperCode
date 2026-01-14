/*---------------------------------------------------------------------------------------------
 *  Clarke Kent AI - Superman's AI Assistant for SuperCode
 *  Powered by OpenRouter with FREE models
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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
let currentModel = FREE_MODELS[0].id;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Clarke Kent AI: Initializing...');

    // Load saved API key
    apiKey = await context.secrets.get('openrouter.apiKey');
    currentModel = context.globalState.get('selectedModel', FREE_MODELS[0].id);

    // Register Set API Key command
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

    // Register Select Model command
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

    // Register Chat with Clarke command
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

                    // Show response in a new document
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

    // Register Explain Code command
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.explainCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const selection = editor.selection;
            const code = selection.isEmpty
                ? editor.document.getText()
                : editor.document.getText(selection);

            if (!code.trim()) {
                vscode.window.showWarningMessage('No code to explain');
                return;
            }

            if (!apiKey) {
                vscode.window.showWarningMessage('Set your OpenRouter API key first');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '🦸 Clarke Kent is analyzing...',
                cancellable: true
            }, async (progress, token) => {
                try {
                    const prompt = `Explain this code clearly and concisely:\n\n\`\`\`\n${code}\n\`\`\``;
                    const response = await sendMessage(prompt, token);

                    const doc = await vscode.workspace.openTextDocument({
                        content: `# Code Explanation by Clarke Kent\n\n${response}`,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
                } catch (error: any) {
                    if (!token.isCancellationRequested) {
                        vscode.window.showErrorMessage(`Error: ${error.message}`);
                    }
                }
            });
        })
    );

    // Register Fix Code command
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.fixCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const selection = editor.selection;
            const code = selection.isEmpty
                ? editor.document.getText()
                : editor.document.getText(selection);

            if (!code.trim()) {
                vscode.window.showWarningMessage('No code to fix');
                return;
            }

            if (!apiKey) {
                vscode.window.showWarningMessage('Set your OpenRouter API key first');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '🦸 Clarke Kent is fixing...',
                cancellable: true
            }, async (progress, token) => {
                try {
                    const prompt = `Fix any bugs or issues in this code. Return ONLY the fixed code without explanation:\n\n\`\`\`\n${code}\n\`\`\``;
                    const response = await sendMessage(prompt, token);

                    // Extract code from response
                    const codeMatch = response.match(/```[\w]*\n([\s\S]*?)```/) ||
                        response.match(/```([\s\S]*?)```/);
                    const fixedCode = codeMatch ? codeMatch[1].trim() : response.trim();

                    // Apply the fix
                    await editor.edit(editBuilder => {
                        if (selection.isEmpty) {
                            const fullRange = new vscode.Range(
                                editor.document.positionAt(0),
                                editor.document.positionAt(editor.document.getText().length)
                            );
                            editBuilder.replace(fullRange, fixedCode);
                        } else {
                            editBuilder.replace(selection, fixedCode);
                        }
                    });

                    vscode.window.showInformationMessage('✅ Code fixed by Clarke Kent!');
                } catch (error: any) {
                    if (!token.isCancellationRequested) {
                        vscode.window.showErrorMessage(`Error: ${error.message}`);
                    }
                }
            });
        })
    );

    // Show activation message
    if (apiKey) {
        vscode.window.showInformationMessage(`🦸 Clarke Kent AI is ready! Using ${FREE_MODELS.find(m => m.id === currentModel)?.name || 'AI'}`);
    } else {
        vscode.window.showInformationMessage('🦸 Clarke Kent AI is ready! Set your OpenRouter API key to start.', 'Set API Key')
            .then(selection => {
                if (selection) {
                    vscode.commands.executeCommand('clarkeKent.setApiKey');
                }
            });
    }

    console.log('Clarke Kent AI: Activated successfully!');
}

async function sendMessage(prompt: string, token: vscode.CancellationToken): Promise<string> {
    if (!apiKey) {
        throw new Error('OpenRouter API key not set');
    }

    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://supercode.dev',
            'X-Title': 'SuperCode IDE - Clarke Kent AI'
        },
        body: JSON.stringify({
            model: currentModel,
            messages: [
                {
                    role: 'system',
                    content: 'You are Clarke Kent, a brilliant AI coding assistant for SuperCode IDE. You are helpful, knowledgeable, and always ready to assist with programming tasks. Be concise but thorough in your explanations.'
                },
                {
                    role: 'user',
                    content: prompt
                }
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
