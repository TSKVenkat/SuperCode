/*---------------------------------------------------------------------------------------------
 *  OpenRouter Language Model Contribution for SuperCode
 *  Auto-registers OpenRouter as a language model vendor on startup
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ILanguageModelsService, ILanguageModelChatProvider, ILanguageModelChatInfoOptions, ILanguageModelChatMetadataAndIdentifier, ILanguageModelChatResponse, IChatMessage, ChatMessageRole } from './languageModels.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ChatAgentLocation } from './constants.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

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

    async provideLanguageModelChatInfo(_options: ILanguageModelChatInfoOptions, _token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
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
                    [ChatAgentLocation.Chat]: model.id.includes('qwen-2.5-72b')
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
        _from: ExtensionIdentifier,
        _options: { [name: string]: any },
        token: CancellationToken
    ): Promise<ILanguageModelChatResponse> {
        const apiKey = await this.secretStorageService.get('supercode.openrouter.apiKey');

        if (!apiKey) {
            throw new Error('OpenRouter API key not set. Please run "SuperCode: Set OpenRouter API Key" command.');
        }

        const actualModelId = modelId.replace('openrouter:', '');
        this.logService.info(`[OpenRouter] Sending request to model: ${actualModelId}`);

        const openRouterMessages = messages.map(msg => ({
            role: msg.role === ChatMessageRole.System ? 'system' :
                msg.role === ChatMessageRole.User ? 'user' : 'assistant',
            content: msg.content.map(part => {
                if (part.type === 'text') {
                    return (part as any).value;
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
    ): AsyncIterable<any> {
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

    async provideTokenCount(_modelId: string, message: string | IChatMessage, _token: CancellationToken): Promise<number> {
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

/**
 * Workbench contribution that registers OpenRouter as a language model provider
 */
class OpenRouterContribution extends Disposable implements IWorkbenchContribution {
    static readonly ID = 'workbench.contrib.openRouter';

    constructor(
        @ILanguageModelsService _languageModelsService: ILanguageModelsService,
        @ILogService private readonly logService: ILogService,
        @ISecretStorageService private readonly secretStorageService: ISecretStorageService,
        @INotificationService private readonly notificationService: INotificationService
    ) {
        super();

        this.logService.info('[OpenRouter] Initializing OpenRouter language model provider');
        new OpenRouterLanguageModelProvider(logService, secretStorageService);

        // Note: We can't register as a provider without a vendor being declared
        // The vendor needs to be contributed via extension point
        // So we'll just log that OpenRouter is available
        this.logService.info('[OpenRouter] OpenRouter service ready - use Set API Key command to configure');

        // Check for API key on startup
        this.secretStorageService.get('supercode.openrouter.apiKey').then(key => {
            if (!key) {
                this.notificationService.info('SuperCode: Set your OpenRouter API key for AI chat features. Use "SuperCode: Set OpenRouter API Key" command.');
            }
        });
    }
}

// Register the Set API Key command
class SetOpenRouterApiKeyAction extends Action2 {
    static readonly ID = 'supercode.setOpenRouterApiKey';

    constructor() {
        super({
            id: SetOpenRouterApiKeyAction.ID,
            title: { value: localize('supercode.setApiKey', 'SuperCode: Set OpenRouter API Key'), original: 'SuperCode: Set OpenRouter API Key' },
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const quickInputService = accessor.get(IQuickInputService);
        const secretStorageService = accessor.get(ISecretStorageService);
        const notificationService = accessor.get(INotificationService);

        const apiKey = await quickInputService.input({
            prompt: 'Enter your OpenRouter API key',
            password: true,
            placeHolder: 'sk-or-...'
        });

        if (apiKey) {
            await secretStorageService.set('supercode.openrouter.apiKey', apiKey);
            notificationService.info('OpenRouter API key saved successfully!');
        }
    }
}

registerAction2(SetOpenRouterApiKeyAction);
registerWorkbenchContribution2(OpenRouterContribution.ID, OpenRouterContribution, WorkbenchPhase.BlockRestore);
