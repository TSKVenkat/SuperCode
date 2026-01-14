import * as vscode from 'vscode';
import axios from 'axios';
import { PreviewPanel } from './features/previewPanel';
import { CodeRunner } from './features/codeRunner';
import { DebuggingAssistant } from './features/debuggingAssistant';
import { ProjectGenerator } from './features/projectGenerator';

const CLARKE_KENT_SYSTEM_PROMPT = `You are Clarke Kent, a mild-mannered but extraordinarily capable AI coding assistant built into SuperCode IDE. Like your namesake, you have hidden superpowers when it comes to coding.

Your personality:
- Professional and helpful, like a friendly colleague
- Confident but not arrogant
- You occasionally make subtle Superman references when appropriate
- You're direct and get to the point quickly

Your capabilities:
- Expert in all programming languages and frameworks
- Can generate, explain, debug, and refactor code
- Understand project context and can work with multiple files
- Can help with architecture decisions and best practices

Always format code responses in proper markdown code blocks with language tags.
Be concise but thorough. If asked about your identity, you can hint that there's "more than meets the eye" about you.`;

interface OpenRouterResponse {
    choices: Array<{
        message: {
            content: string;
        };
        delta?: {
            content?: string;
        };
    }>;
}

class ClarkeKentParticipant {
    private apiKey: string | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadApiKey();
    }

    private async loadApiKey(): Promise<void> {
        this.apiKey = await this.context.secrets.get('clarkeKent.openRouterApiKey');
    }

    async setApiKey(key: string): Promise<void> {
        await this.context.secrets.store('clarkeKent.openRouterApiKey', key);
        this.apiKey = key;
    }

    getModel(): string {
        return vscode.workspace.getConfiguration('clarkeKent').get('model', 'anthropic/claude-3.5-sonnet');
    }

    async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!this.apiKey) {
            stream.markdown('🔑 **API Key Required**\n\nPlease set your OpenRouter API key first:\n1. Open Command Palette (Ctrl+Shift+P)\n2. Run "Clarke Kent: Set OpenRouter API Key"\n3. Enter your API key from [openrouter.ai](https://openrouter.ai/keys)');
            return { metadata: { error: 'no_api_key' } };
        }

        try {
            // Build conversation history
            const messages = this.buildMessages(request, context);

            stream.progress('Clarke Kent is thinking...');

            // Make streaming request to OpenRouter
            const response = await this.streamCompletion(messages, stream, token);

            return { metadata: { success: true } };
        } catch (error: any) {
            const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
            stream.markdown(`\n\n❌ **Error**: ${errorMessage}`);
            return { metadata: { error: errorMessage } };
        }
    }

    private buildMessages(request: vscode.ChatRequest, context: vscode.ChatContext): Array<{ role: string; content: string }> {
        const messages: Array<{ role: string; content: string }> = [
            { role: 'system', content: CLARKE_KENT_SYSTEM_PROMPT }
        ];

        // Add conversation history
        for (const turn of context.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push({ role: 'user', content: turn.prompt });
            } else if (turn instanceof vscode.ChatResponseTurn) {
                // Collect all markdown parts from the response
                let responseText = '';
                for (const part of turn.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        responseText += part.value.value;
                    }
                }
                if (responseText) {
                    messages.push({ role: 'assistant', content: responseText });
                }
            }
        }

        // Add current request
        let userMessage = request.prompt;

        // Add file references if any
        for (const ref of request.references) {
            if (ref.value instanceof vscode.Uri) {
                userMessage += `\n\n[Reference: ${ref.value.fsPath}]`;
            } else if (ref.value instanceof vscode.Location) {
                userMessage += `\n\n[Reference: ${ref.value.uri.fsPath}:${ref.value.range.start.line}]`;
            }
        }

        messages.push({ role: 'user', content: userMessage });
        return messages;
    }

    private async streamCompletion(
        messages: Array<{ role: string; content: string }>,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const model = this.getModel();

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: model,
                messages: messages,
                stream: true
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://supercode.dev',
                    'X-Title': 'SuperCode IDE - Clarke Kent AI'
                },
                responseType: 'stream'
            }
        );

        return new Promise((resolve, reject) => {
            let buffer = '';

            response.data.on('data', (chunk: Buffer) => {
                if (token.isCancellationRequested) {
                    response.data.destroy();
                    resolve();
                    return;
                }

                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                stream.markdown(content);
                            }
                        } catch {
                            // Ignore parse errors
                        }
                    }
                }
            });

            response.data.on('end', () => resolve());
            response.data.on('error', (err: Error) => reject(err));
        });
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Clarke Kent AI is now active!');

    const clarkeKent = new ClarkeKentParticipant(context);

    // Create the chat participant
    const participant = vscode.chat.createChatParticipant('clarkeKent', async (request, chatContext, stream, token) => {
        return clarkeKent.handleRequest(request, chatContext, stream, token);
    });

    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'image.png');

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.setApiKey', async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your OpenRouter API key',
                password: true,
                placeHolder: 'sk-or-...'
            });
            if (apiKey) {
                await clarkeKent.setApiKey(apiKey);
                vscode.window.showInformationMessage('OpenRouter API key saved successfully!');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.selectModel', async () => {
            const models = [
                { label: 'Claude 3.5 Sonnet', value: 'anthropic/claude-3.5-sonnet', description: 'Best for coding tasks' },
                { label: 'Claude 3 Opus', value: 'anthropic/claude-3-opus', description: 'Most capable Claude model' },
                { label: 'GPT-4o', value: 'openai/gpt-4o', description: 'OpenAI\'s latest model' },
                { label: 'GPT-4 Turbo', value: 'openai/gpt-4-turbo', description: 'Fast and capable' },
                { label: 'Gemini Pro 1.5', value: 'google/gemini-pro-1.5', description: 'Google\'s best model' },
                { label: 'Llama 3.1 70B', value: 'meta-llama/llama-3.1-70b-instruct', description: 'Open source powerhouse' }
            ];

            const selected = await vscode.window.showQuickPick(models, {
                placeHolder: 'Select an AI model for Clarke Kent'
            });

            if (selected) {
                await vscode.workspace.getConfiguration('clarkeKent').update('model', selected.value, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Model set to ${selected.label}`);
            }
        })
    );

    // Register preview command
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.previewFile', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                PreviewPanel.show(context.extensionUri, editor.document);
            } else {
                vscode.window.showWarningMessage('No active file to preview');
            }
        })
    );

    // Register run command
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.runFile', () => {
            CodeRunner.runCurrentFile();
        })
    );

    // Register stop command
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.stopExecution', () => {
            CodeRunner.stopExecution();
        })
    );

    // Register debugging assistant
    const debugAssistant = new DebuggingAssistant(context);
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.analyzeError', () => {
            debugAssistant.analyzeCurrentDiagnostics();
        })
    );

    // Register project generator
    const projectGen = new ProjectGenerator(context);
    context.subscriptions.push(
        vscode.commands.registerCommand('clarkeKent.generateProject', async () => {
            const description = await vscode.window.showInputBox({
                prompt: 'Describe the project you want to create',
                placeHolder: 'e.g., A React todo app with TypeScript and Tailwind CSS'
            });
            if (description) {
                await projectGen.generateProject(description);
            }
        })
    );

    context.subscriptions.push(participant);
}

export function deactivate() { }
