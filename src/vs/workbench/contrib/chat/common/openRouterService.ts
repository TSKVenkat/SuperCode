/*---------------------------------------------------------------------------------------------
 *  SuperCode OpenRouter Integration
 *  Provides free AI models via OpenRouter for SuperCode chat
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ChatAgentLocation } from './constants.js';
import {
    ChatMessageRole,
    IChatMessage,
    IChatResponsePart,
    ILanguageModelChatInfoOptions,
    ILanguageModelChatMetadataAndIdentifier,
    ILanguageModelChatProvider,
    ILanguageModelChatResponse
} from './languageModels.js';

export const IOpenRouterService = createDecorator<IOpenRouterService>('openRouterService');

export interface IOpenRouterModel {
    id: string;
    name: string;
    family: string;
    maxInputTokens: number;
    maxOutputTokens: number;
    description: string;
    isDefault?: boolean;
    isCoder?: boolean;
}

export interface IOpenRouterService {
    readonly _serviceBrand: undefined;
    getProvider(): ILanguageModelChatProvider;
    setApiKey(key: string): Promise<void>;
    getApiKey(): Promise<string | undefined>;
    getAvailableModels(): IOpenRouterModel[];
    getPreferredModelId(): string | undefined;
    setPreferredModelId(modelId: string): void;
    refreshModels(): Promise<void>;
}

// Updated free models on OpenRouter (January 2026)
const OPENROUTER_FREE_MODELS: IOpenRouterModel[] = [
    {
        id: 'google/gemini-2.0-flash-exp:free',
        name: 'Gemini 2.0 Flash',
        family: 'gemini',
        maxInputTokens: 1048576,
        maxOutputTokens: 8192,
        description: 'Google Gemini 2.0 Flash - Fast and capable',
        isDefault: true
    },
    {
        id: 'google/gemini-exp-1206:free',
        name: 'Gemini Exp 1206',
        family: 'gemini',
        maxInputTokens: 2097152,
        maxOutputTokens: 8192,
        description: 'Google Gemini Experimental - Cutting edge'
    },
    {
        id: 'deepseek/deepseek-r1:free',
        name: 'DeepSeek R1',
        family: 'deepseek',
        maxInputTokens: 163840,
        maxOutputTokens: 8192,
        description: 'DeepSeek R1 - Advanced reasoning model'
    },
    {
        id: 'deepseek/deepseek-chat:free',
        name: 'DeepSeek V3',
        family: 'deepseek',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'DeepSeek V3 - Powerful chat model',
        isCoder: true
    },
    {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Llama 3.3 70B',
        family: 'llama',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'Meta Llama 3.3 70B - Open source excellence'
    },
    {
        id: 'qwen/qwq-32b:free',
        name: 'QwQ 32B',
        family: 'qwen',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'Qwen QwQ 32B - Strong reasoning capabilities'
    },
    {
        id: 'mistralai/mistral-small-24b-instruct-2501:free',
        name: 'Mistral Small 24B',
        family: 'mistral',
        maxInputTokens: 32768,
        maxOutputTokens: 8192,
        description: 'Mistral Small - Efficient and fast'
    },
    {
        id: 'microsoft/phi-4:free',
        name: 'Phi-4',
        family: 'phi',
        maxInputTokens: 16384,
        maxOutputTokens: 8192,
        description: 'Microsoft Phi-4 - Compact powerhouse'
    },
    {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
        name: 'Nemotron 70B',
        family: 'nemotron',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'NVIDIA Nemotron - High quality outputs'
    }
];

export class OpenRouterService extends Disposable implements IOpenRouterService {
    readonly _serviceBrand: undefined;

    private readonly _provider: OpenRouterLanguageModelProvider;
    private _preferredModelId: string | undefined;
    private _dynamicModels: IOpenRouterModel[] = [];

    constructor(
        @ILogService private readonly logService: ILogService,
        @ISecretStorageService private readonly secretStorageService: ISecretStorageService
    ) {
        super();
        this.logService.info('[OpenRouter] Initializing SuperCode OpenRouter service');
        this._provider = new OpenRouterLanguageModelProvider(this, logService, secretStorageService);
    }

    getProvider(): ILanguageModelChatProvider {
        return this._provider;
    }

    async setApiKey(key: string): Promise<void> {
        await this.secretStorageService.set('supercode.openrouter.apiKey', key);
        this._provider.notifyChange();
        this.logService.info('[OpenRouter] API key updated');
    }

    async getApiKey(): Promise<string | undefined> {
        return this.secretStorageService.get('supercode.openrouter.apiKey');
    }

    getAvailableModels(): IOpenRouterModel[] {
        return this._dynamicModels.length > 0 ? this._dynamicModels : OPENROUTER_FREE_MODELS;
    }

    getPreferredModelId(): string | undefined {
        return this._preferredModelId;
    }

    setPreferredModelId(modelId: string): void {
        this._preferredModelId = modelId;
        this._provider.notifyChange();
        this.logService.info(`[OpenRouter] Preferred model set to: ${modelId}`);
    }

    async refreshModels(): Promise<void> {
        try {
            const apiKey = await this.getApiKey();
            if (!apiKey) {
                this.logService.warn('[OpenRouter] No API key, using static model list');
                return;
            }

            const response = await fetch('https://openrouter.ai/api/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (response.ok) {
                const data = await response.json();
                const freeModels = (data.data || [])
                    .filter((m: any) => m.id?.includes(':free') || m.pricing?.prompt === '0')
                    .map((m: any) => ({
                        id: m.id,
                        name: m.name || m.id.split('/').pop()?.replace(/:free$/, '') || m.id,
                        family: m.id.split('/')[0] || 'unknown',
                        maxInputTokens: m.context_length || 32768,
                        maxOutputTokens: m.top_provider?.max_completion_tokens || 8192,
                        description: m.description || `${m.name} on OpenRouter`
                    }));

                if (freeModels.length > 0) {
                    this._dynamicModels = freeModels;
                    this._provider.notifyChange();
                    this.logService.info(`[OpenRouter] Loaded ${freeModels.length} free models from API`);
                }
            }
        } catch (error) {
            this.logService.warn('[OpenRouter] Failed to fetch models from API, using static list', error);
        }
    }
}

class OpenRouterLanguageModelProvider implements ILanguageModelChatProvider {
    private readonly _onDidChange = new Emitter<void>();
    readonly onDidChange: Event<void> = this._onDidChange.event;

    private _currentModelIndex = 0;

    constructor(
        private readonly service: OpenRouterService,
        private readonly logService: ILogService,
        private readonly secretStorageService: ISecretStorageService
    ) { }

    notifyChange(): void {
        this._onDidChange.fire();
    }

    async provideLanguageModelChatInfo(options: ILanguageModelChatInfoOptions, token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
        const apiKey = await this.secretStorageService.get('supercode.openrouter.apiKey');
        const models = this.service.getAvailableModels();
        const preferredModelId = this.service.getPreferredModelId();

        return models.map(model => ({
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
                    [ChatAgentLocation.Chat]: preferredModelId ? model.id === preferredModelId : model.isDefault
                },
                isUserSelectable: true,
                modelPickerCategory: { label: 'SuperCode AI (Free)', order: 0 },
                auth: apiKey ? { providerLabel: 'OpenRouter', accountLabel: 'API Key' } : undefined,
                capabilities: {
                    vision: model.family === 'gemini',
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
        let actualModelId = modelId.replace('openrouter:', '');

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

        // Try to send request, with fallback to other models on failure
        const models = this.service.getAvailableModels();
        let lastError: Error | null = null;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                const response = await this.makeRequest(apiKey, actualModelId, openRouterMessages, token);
                return response;
            } catch (error: any) {
                lastError = error;
                this.logService.warn(`[OpenRouter] Request failed for ${actualModelId}: ${error.message}`);

                // Try next model if this one fails
                if (error.message?.includes('404') || error.message?.includes('No endpoints')) {
                    this._currentModelIndex = (this._currentModelIndex + 1) % models.length;
                    actualModelId = models[this._currentModelIndex].id;
                    this.logService.info(`[OpenRouter] Trying fallback model: ${actualModelId}`);
                    attempts++;
                } else {
                    throw error;
                }
            }
        }

        throw lastError || new Error('All models failed');
    }

    private async makeRequest(
        apiKey: string,
        modelId: string,
        messages: { role: string; content: string }[],
        token: CancellationToken
    ): Promise<ILanguageModelChatResponse> {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://supercode.dev',
                'X-Title': 'SuperCode IDE'
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                stream: true,
                temperature: 0.7,
                max_tokens: 4096
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
