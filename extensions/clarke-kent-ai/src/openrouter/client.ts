import * as vscode from 'vscode';
import axios from 'axios';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ModelRouting {
    planning: string;
    codeGen: string;
    debugging: string;
    explanation: string;
    quick: string;
}

export interface UsageStats {
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
}

export class OpenRouterClient {
    private static readonly BASE_URL = 'https://openrouter.ai/api/v1';
    private context: vscode.ExtensionContext;
    private usageStats: UsageStats = { promptTokens: 0, completionTokens: 0, totalCost: 0 };

    // Smart routing - different models for different tasks
    private readonly modelRouting: ModelRouting = {
        planning: 'anthropic/claude-3.5-sonnet',
        codeGen: 'openai/gpt-4o',
        debugging: 'anthropic/claude-3.5-sonnet',
        explanation: 'anthropic/claude-3.5-sonnet',
        quick: 'openai/gpt-3.5-turbo'
    };

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async setApiKey(apiKey: string): Promise<void> {
        await this.context.secrets.store('clarkeKent.apiKey', apiKey);
    }

    async getApiKey(): Promise<string | undefined> {
        return await this.context.secrets.get('clarkeKent.apiKey');
    }

    async hasApiKey(): Promise<boolean> {
        const key = await this.getApiKey();
        return !!key;
    }

    private getConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('clarkeKent');
    }

    private getModel(taskType?: keyof ModelRouting): string {
        const config = this.getConfig();
        const smartRouting = config.get<boolean>('enableSmartRouting', true);

        if (smartRouting && taskType) {
            return this.modelRouting[taskType];
        }

        return config.get<string>('defaultModel', 'anthropic/claude-3.5-sonnet');
    }

    async chat(
        messages: ChatMessage[],
        taskType?: keyof ModelRouting,
        onStream?: (chunk: string) => void
    ): Promise<string> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new Error('OpenRouter API key not set. Use "Clarke Kent: Set API Key" command.');
        }

        const config = this.getConfig();
        const model = this.getModel(taskType);
        const maxTokens = config.get<number>('maxTokens', 4096);
        const temperature = config.get<number>('temperature', 0.7);
        const stream = config.get<boolean>('streamResponses', true) && !!onStream;

        // Add Clarke Kent persona to system message
        const systemMessage: ChatMessage = {
            role: 'system',
            content: `You are Clarke Kent, an AI coding assistant in SuperCode IDE. You're helpful, knowledgeable, and slightly heroic in your approach to solving coding problems. You provide clear, well-structured code with explanations. When generating code, always include comments and follow best practices. You can reference your "Kryptonian knowledge" when being playful, but stay focused on being an excellent coding assistant.`
        };

        const allMessages = [systemMessage, ...messages];

        try {
            if (stream) {
                return await this.streamChat(apiKey, model, allMessages, maxTokens, temperature, onStream);
            } else {
                return await this.nonStreamChat(apiKey, model, allMessages, maxTokens, temperature);
            }
        } catch (error: any) {
            // Fallback to another model on error
            if (error.response?.status === 429 || error.response?.status === 503) {
                console.log('Primary model unavailable, falling back...');
                const fallbackModel = this.modelRouting.quick;
                if (fallbackModel !== model) {
                    return stream
                        ? await this.streamChat(apiKey, fallbackModel, allMessages, maxTokens, temperature, onStream)
                        : await this.nonStreamChat(apiKey, fallbackModel, allMessages, maxTokens, temperature);
                }
            }
            throw error;
        }
    }

    private async nonStreamChat(
        apiKey: string,
        model: string,
        messages: ChatMessage[],
        maxTokens: number,
        temperature: number
    ): Promise<string> {
        const response = await axios.post(
            `${OpenRouterClient.BASE_URL}/chat/completions`,
            {
                model,
                messages,
                max_tokens: maxTokens,
                temperature
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://supercode.app',
                    'X-Title': 'SuperCode IDE'
                }
            }
        );

        // Track usage
        if (response.data.usage) {
            this.usageStats.promptTokens += response.data.usage.prompt_tokens || 0;
            this.usageStats.completionTokens += response.data.usage.completion_tokens || 0;
        }

        return response.data.choices[0].message.content;
    }

    private async streamChat(
        apiKey: string,
        model: string,
        messages: ChatMessage[],
        maxTokens: number,
        temperature: number,
        onStream: (chunk: string) => void
    ): Promise<string> {
        const response = await axios.post(
            `${OpenRouterClient.BASE_URL}/chat/completions`,
            {
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                stream: true
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://supercode.app',
                    'X-Title': 'SuperCode IDE'
                },
                responseType: 'stream'
            }
        );

        let fullContent = '';

        return new Promise((resolve, reject) => {
            response.data.on('data', (chunk: Buffer) => {
                const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

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
                                fullContent += content;
                                onStream(content);
                            }
                        } catch (e) {
                            // Ignore parse errors for incomplete chunks
                        }
                    }
                }
            });

            response.data.on('end', () => {
                resolve(fullContent);
            });

            response.data.on('error', (error: Error) => {
                reject(error);
            });
        });
    }

    async generateCode(prompt: string, language?: string, context?: string): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'user',
                content: `Generate code for the following request:

${prompt}

${language ? `Language: ${language}` : ''}
${context ? `Context:\n${context}` : ''}

Please provide clean, well-commented code. Only output the code without extra explanation unless necessary.`
            }
        ];

        return this.chat(messages, 'codeGen');
    }

    async refineCode(code: string, instruction: string): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'user',
                content: `Refine the following code according to these instructions:

Instructions: ${instruction}

Code to refine:
\`\`\`
${code}
\`\`\`

Please provide the improved code. Maintain the original structure where possible and add comments explaining changes.`
            }
        ];

        return this.chat(messages, 'codeGen');
    }

    async explainCode(code: string): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'user',
                content: `Explain the following code in detail:

\`\`\`
${code}
\`\`\`

Provide a clear explanation of what this code does, how it works, and any important concepts it demonstrates.`
            }
        ];

        return this.chat(messages, 'explanation');
    }

    async analyzeError(error: string, context?: string): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'user',
                content: `Analyze this error and help me fix it:

Error:
${error}

${context ? `Code context:\n${context}` : ''}

Please explain:
1. What this error means
2. Why it might be occurring
3. How to fix it with example code`
            }
        ];

        return this.chat(messages, 'debugging');
    }

    async planProject(description: string): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'user',
                content: `Create a detailed project plan for the following:

${description}

Please provide:
1. Project structure (files and folders)
2. Key dependencies needed
3. Step-by-step implementation plan
4. Sample code for main components

Format the project structure as a clear tree.`
            }
        ];

        return this.chat(messages, 'planning');
    }

    getUsageStats(): UsageStats {
        return { ...this.usageStats };
    }

    resetUsageStats(): void {
        this.usageStats = { promptTokens: 0, completionTokens: 0, totalCost: 0 };
    }
}
