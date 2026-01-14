/*---------------------------------------------------------------------------------------------
 *  OpenRouter Language Model Provider for SuperCode
 *  Provides free AI models: Qwen, DeepSeek, Nemotron, QwenCoder
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import {
    IChatMessage,
    IChatResponsePart,
    ILanguageModelChatMetadata,
    ILanguageModelChatMetadataAndIdentifier,
    ILanguageModelChatProvider,
    ILanguageModelChatResponse,
    ILanguageModelChatInfoOptions,
    ChatMessageRole
} from './languageModels.js';
import { ChatAgentLocation } from './constants.js';

export const IOpenRouterService = createDecorator<IOpenRouterService>('openRouterService');

export interface IOpenRouterService {
    readonly _serviceBrand: undefined;
    getProvider(): ILanguageModelChatProvider;
    setApiKey(key: string): Promise<void>;
    getApiKey(): Promise<string | undefined>;
}

// Free models on OpenRouter
const OPENROUTER_FREE_MODELS = [
    {
        id: 'qwen/qwen-2.5-72b-instruct:free',
        name: 'Qwen 2.5 72B',
        family: 'qwen',
        maxInputTokens: 32768,
        maxOutputTokens: 8192,
        description: 'Qwen 2.5 72B - Free, powerful open-source model'
    },
    {
        id: 'qwen/qwen-2.5-coder-32b-instruct:free',
        name: 'Qwen 2.5 Coder 32B',
        family: 'qwen-coder',
        maxInputTokens: 32768,
        maxOutputTokens: 8192,
        description: 'Qwen 2.5 Coder - Specialized for coding tasks'
    },
    {
        id: 'deepseek/deepseek-r1:free',
        name: 'DeepSeek R1',
        family: 'deepseek',
        maxInputTokens: 64000,
        maxOutputTokens: 8192,
        description: 'DeepSeek R1 - Reasoning-focused model'
    },
    {
        id: 'deepseek/deepseek-chat:free',
        name: 'DeepSeek Chat',
        family: 'deepseek',
        maxInputTokens: 64000,
        maxOutputTokens: 8192,
        description: 'DeepSeek Chat - General purpose AI'
    },
    {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
        name: 'Nemotron 70B',
        family: 'nemotron',
        maxInputTokens: 32768,
        maxOutputTokens: 8192,
        description: 'NVIDIA Nemotron 70B - High quality responses'
    },
    {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Llama 3.3 70B',
        family: 'llama',
        maxInputTokens: 32768,
        maxOutputTokens: 8192,
        description: 'Meta Llama 3.3 70B - Latest Llama model'
    }
];

export class OpenRouterService extends Disposable implements IOpenRouterService {
    readonly _serviceBrand: undefined;

    private readonly _provider: OpenRouterLanguageModelProvider;

    constructor(
        @ILogService private readonly logService: ILogService,
        @ISecretStorageService private readonly secretStorageService: ISecretStorageService
    ) {
        super();
        this.logService.info('[OpenRouter] Initializing OpenRouter service for SuperCode');
        this._provider = new OpenRouterLanguageModelProvider(logService, secretStorageService);
    }

    getProvider(): ILanguageModelChatProvider {
        return this._provider;
    }

    async setApiKey(key: string): Promise<void> {
        await this.secretStorageService.set('supercode.openrouter.apiKey', key);
        this._provider.notifyChange();
    }

    async getApiKey(): Promise<string | undefined> {
        return this.secretStorageService.get('supercode.openrouter.apiKey');
    }
}

class OpenRouterLanguageModelProvider implements ILanguageModelChatProvider {
    private readonly _onDidChange = new Emitter<void>();
    readonly onDidChange: Event<void> = this._onDidChange.event;

    constructor(
        private readonly logService: ILogService,
        private readonly secretStorageService: ISecretStorageService
    ) { }

    notifyChange(): void {
        this._onDidChange.fire();
    }

    async provideLanguageModelChatInfo(options: ILanguageModelChatInfoOptions, token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
        const apiKey = await this.secretStorageService.get('supercode.openrouter.apiKey');

        return OPENROUTER_FREE_MODELS.map(model => ({
            identifier: `openrouter:${model.id}`,
            metadata: {
                extension: new ExtensionIdentifier('supercode.openrouter'),
                name: model.name,
                id: model.id,
                vendor: 'openrouter',
                version: '1.0.0',
                tooltip: model.description,
                detail: model.description,
                family: model.family,
                maxInputTokens: model.maxInputTokens,
                maxOutputTokens: model.maxOutputTokens,
                isDefaultForLocation: {
                    [ChatAgentLocation.Panel]: model.id.includes('qwen-2.5-72b')
                },
                isUserSelectable: true,
                modelPickerCategory: { label: 'OpenRouter (Free)', order: 1 },
                auth: apiKey ? { providerLabel: 'OpenRouter', accountLabel: 'API Key' } : undefined,
                capabilities: {
                    vision: false,
                    toolCalling: true,
                    agentMode: true
                }
            }
        }));
    }

    async sendChatRequest(
        modelId: string,
        messages: IChatMessage[],
        from: ExtensionIdentifier,
        options: { [name: string]: any },
        token: CancellationToken
    ): Promise<ILanguageModelChatResponse> {
        const apiKey = await this.secretStorageService.get('supercode.openrouter.apiKey');

        if (!apiKey) {
            throw new Error('OpenRouter API key not set. Please set it via "SuperCode: Set OpenRouter API Key" command.');
        }

        // Extract the actual model ID from our identifier format
        const actualModelId = modelId.replace('openrouter:', '');

        this.logService.info(`[OpenRouter] Sending request to model: ${actualModelId}`);

        const openRouterMessages = messages.map(msg => ({
            role: msg.role === ChatMessageRole.System ? 'system' :
                msg.role === ChatMessageRole.User ? 'user' : 'assistant',
            content: msg.content.map(part => {
                if (part.type === 'text') {
                    return part.value;
                }
                return '';
            }).join('')
        }));

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://supercode.dev',
                'X-Title': 'SuperCode IDE'
            },
            body: JSON.stringify({
                model: actualModelId,
                messages: openRouterMessages,
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body from OpenRouter');
        }

        const stream = this.createResponseStream(reader, token);

        return {
            stream,
            result: Promise.resolve({})
        };
    }

    private async *createResponseStream(
        reader: ReadableStreamDefaultReader<Uint8Array>,
        token: CancellationToken
    ): AsyncIterable<IChatResponsePart> {
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                if (token.isCancellationRequested) {
                    reader.cancel();
                    break;
                }

                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                yield { type: 'text', value: content };
                            }
                        } catch {
                            // Ignore parse errors
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    async provideTokenCount(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number> {
        // Rough estimation: ~4 characters per token
        if (typeof message === 'string') {
            return Math.ceil(message.length / 4);
        }
        const textContent = message.content
            .filter(part => part.type === 'text')
            .map(part => (part as any).value)
            .join('');
        return Math.ceil(textContent.length / 4);
    }
}
