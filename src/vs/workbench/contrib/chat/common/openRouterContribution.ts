/*---------------------------------------------------------------------------------------------
 *  OpenRouter Language Model Contribution for SuperCode
 *  Auto-registers OpenRouter as a language model vendor with enhanced commands
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ILanguageModelsService, ILanguageModelChatProvider, ILanguageModelChatInfoOptions, ILanguageModelChatMetadataAndIdentifier, ILanguageModelChatResponse, IChatMessage, ChatMessageRole, IChatResponsePart } from './languageModels.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ChatAgentLocation } from './constants.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';

// ============================================================================
// SUPERCODE AI MODELS (Free & Premium via OpenRouter)
// ============================================================================

interface SuperCodeModel {
    id: string;
    name: string;
    provider: string;
    tier: 'free' | 'premium';
    maxInputTokens: number;
    maxOutputTokens: number;
    description: string;
    isDefault?: boolean;
    supportsVision?: boolean;
    supportsThinking?: boolean;
    isCoder?: boolean;
    isReasoning?: boolean;
}

// FREE MODELS - No cost to users (verified working on OpenRouter)
const FREE_MODELS: SuperCodeModel[] = [
    {
        id: 'qwen/qwen-2.5-coder-32b-instruct:free',
        name: 'Qwen 2.5 Coder 32B',
        provider: 'Qwen',
        tier: 'free',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'Qwen 2.5 Coder - Specialized for coding tasks',
        isCoder: true,
        isDefault: true
    },
    {
        id: 'qwen/qwen-2.5-72b-instruct:free',
        name: 'Qwen 2.5 72B',
        provider: 'Qwen',
        tier: 'free',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'Qwen 2.5 72B - Powerful open-source model'
    },
    {
        id: 'deepseek/deepseek-r1:free',
        name: 'DeepSeek R1',
        provider: 'DeepSeek',
        tier: 'free',
        maxInputTokens: 65536,
        maxOutputTokens: 8192,
        description: 'DeepSeek R1 - Advanced reasoning model',
        isReasoning: true
    },
    {
        id: 'deepseek/deepseek-chat:free',
        name: 'DeepSeek Chat',
        provider: 'DeepSeek',
        tier: 'free',
        maxInputTokens: 65536,
        maxOutputTokens: 4096,
        description: 'DeepSeek Chat - General purpose AI'
    },
    {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Llama 3.3 70B',
        provider: 'Meta',
        tier: 'free',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'Meta Llama 3.3 70B - Latest Llama model'
    },
    {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
        name: 'Nemotron 70B',
        provider: 'NVIDIA',
        tier: 'free',
        maxInputTokens: 131072,
        maxOutputTokens: 4096,
        description: 'NVIDIA Nemotron 70B - High quality'
    },
    {
        id: 'mistralai/mistral-7b-instruct:free',
        name: 'Mistral 7B',
        provider: 'Mistral',
        tier: 'free',
        maxInputTokens: 32768,
        maxOutputTokens: 8192,
        description: 'Mistral 7B - Fast and efficient'
    },
    {
        id: 'google/gemma-2-9b-it:free',
        name: 'Gemma 2 9B',
        provider: 'Google',
        tier: 'free',
        maxInputTokens: 8192,
        maxOutputTokens: 8192,
        description: 'Google Gemma 2 9B - Compact and capable'
    }
];

// PREMIUM MODELS - Require payment/credits
const PREMIUM_MODELS: SuperCodeModel[] = [
    // Anthropic Claude
    {
        id: 'anthropic/claude-opus-4.5',
        name: 'Claude Opus 4.5',
        provider: 'Anthropic',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 16384,
        description: 'Claude Opus 4.5 - Most capable Claude model',
        isReasoning: true
    },
    {
        id: 'anthropic/claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        provider: 'Anthropic',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 16384,
        description: 'Claude Sonnet 4.5 - Balanced performance'
    },
    {
        id: 'anthropic/claude-3.7-sonnet',
        name: 'Claude 3.7 Sonnet',
        provider: 'Anthropic',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 16384,
        description: 'Claude 3.7 Sonnet - Extended capabilities',
        isCoder: true
    },
    {
        id: 'anthropic/claude-3.7-sonnet:thinking',
        name: 'Claude 3.7 Sonnet (Thinking)',
        provider: 'Anthropic',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 32768,
        description: 'Claude 3.7 with extended thinking',
        supportsThinking: true,
        isReasoning: true
    },
    {
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4',
        provider: 'Anthropic',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 16384,
        description: 'Claude Sonnet 4 - Latest generation'
    },
    {
        id: 'anthropic/claude-3.5-haiku',
        name: 'Claude 3.5 Haiku',
        provider: 'Anthropic',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 8192,
        description: 'Claude 3.5 Haiku - Fast and efficient'
    },
    {
        id: 'anthropic/claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        provider: 'Anthropic',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 8192,
        description: 'Claude Haiku 4.5 - Latest fast model'
    },

    // Google Gemini
    {
        id: 'google/gemini-3-pro-preview',
        name: 'Gemini 3 Pro',
        provider: 'Google',
        tier: 'premium',
        maxInputTokens: 2097152,
        maxOutputTokens: 16384,
        description: 'Gemini 3 Pro - Most capable Gemini',
        supportsVision: true
    },
    {
        id: 'google/gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: 'Google',
        tier: 'premium',
        maxInputTokens: 1048576,
        maxOutputTokens: 8192,
        description: 'Gemini 3 Flash - Fast and capable',
        supportsVision: true
    },
    {
        id: 'google/gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: 'Google',
        tier: 'premium',
        maxInputTokens: 2097152,
        maxOutputTokens: 16384,
        description: 'Gemini 2.5 Pro - Advanced reasoning',
        supportsVision: true,
        isReasoning: true
    },

    // xAI Grok
    {
        id: 'x-ai/grok-4.1-fast',
        name: 'Grok 4.1 Fast',
        provider: 'xAI',
        tier: 'premium',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'Grok 4.1 Fast - Quick responses'
    },
    {
        id: 'x-ai/grok-3',
        name: 'Grok 3',
        provider: 'xAI',
        tier: 'premium',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'Grok 3 - General purpose'
    },
    {
        id: 'x-ai/grok-4-fast',
        name: 'Grok 4 Fast',
        provider: 'xAI',
        tier: 'premium',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        description: 'Grok 4 Fast - Latest generation'
    },
    {
        id: 'x-ai/grok-code-fast-1',
        name: 'Grok Code Fast',
        provider: 'xAI',
        tier: 'premium',
        maxInputTokens: 131072,
        maxOutputTokens: 16384,
        description: 'Grok Code Fast - Optimized for coding',
        isCoder: true
    },

    // OpenAI GPT
    {
        id: 'openai/gpt-5.2-codex',
        name: 'GPT-5.2 Codex',
        provider: 'OpenAI',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 16384,
        description: 'GPT-5.2 Codex - Ultimate coding model',
        isCoder: true
    },
    {
        id: 'openai/gpt-5.2-chat',
        name: 'GPT-5.2 Chat',
        provider: 'OpenAI',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 16384,
        description: 'GPT-5.2 Chat - Most advanced chat'
    },
    {
        id: 'openai/gpt-5.1-codex-max',
        name: 'GPT-5.1 Codex Max',
        provider: 'OpenAI',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 32768,
        description: 'GPT-5.1 Codex Max - Extended output',
        isCoder: true
    },
    {
        id: 'openai/gpt-5-codex',
        name: 'GPT-5 Codex',
        provider: 'OpenAI',
        tier: 'premium',
        maxInputTokens: 200000,
        maxOutputTokens: 16384,
        description: 'GPT-5 Codex - Flagship coding model',
        isCoder: true
    }
];

// Combined models
const ALL_MODELS: SuperCodeModel[] = [...FREE_MODELS, ...PREMIUM_MODELS];

const PREFERRED_MODEL_STORAGE_KEY = 'supercode.openrouter.preferredModel';

// ============================================================================
// LANGUAGE MODEL PROVIDER
// ============================================================================

class OpenRouterLanguageModelProvider implements ILanguageModelChatProvider {
    private readonly _onDidChange = new Emitter<void>();
    readonly onDidChange: Event<void> = this._onDidChange.event;

    private _currentModelIndex = 0;
    private _preferredModelId: string | undefined;

    constructor(
        private readonly logService: ILogService,
        private readonly secretStorageService: ISecretStorageService,
        private readonly storageService: IStorageService
    ) {
        this._preferredModelId = this.storageService.get(PREFERRED_MODEL_STORAGE_KEY, StorageScope.PROFILE);
    }

    notifyChange(): void {
        this._onDidChange.fire();
    }

    setPreferredModel(modelId: string): void {
        this._preferredModelId = modelId;
        this.storageService.store(PREFERRED_MODEL_STORAGE_KEY, modelId, StorageScope.PROFILE, StorageTarget.USER);
        this.notifyChange();
    }

    getPreferredModelId(): string | undefined {
        return this._preferredModelId;
    }

    getFreeModels(): SuperCodeModel[] {
        return FREE_MODELS;
    }

    getPremiumModels(): SuperCodeModel[] {
        return PREMIUM_MODELS;
    }

    getAllModels(): SuperCodeModel[] {
        return ALL_MODELS;
    }

    getCoderModels(): SuperCodeModel[] {
        return ALL_MODELS.filter(m => m.isCoder);
    }

    async provideLanguageModelChatInfo(_options: ILanguageModelChatInfoOptions, _token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
        const apiKey = await this.secretStorageService.get('supercode.openrouter.apiKey');

        return ALL_MODELS.map(model => ({
            identifier: `openrouter:${model.id}`,
            metadata: {
                extension: new ExtensionIdentifier('supercode.openrouter'),
                name: model.name,
                id: model.id,
                vendor: 'openrouter',
                version: '1.0.0',
                tooltip: model.description,
                detail: `${model.provider} | ${model.tier === 'free' ? '🆓 Free' : '💎 Premium'} | ${Math.round(model.maxInputTokens / 1000)}k context`,
                family: model.provider.toLowerCase(),
                maxInputTokens: model.maxInputTokens,
                maxOutputTokens: model.maxOutputTokens,
                isDefaultForLocation: {
                    [ChatAgentLocation.Chat]: this._preferredModelId
                        ? model.id === this._preferredModelId
                        : model.isDefault
                },
                isUserSelectable: true,
                modelPickerCategory: {
                    label: model.tier === 'free' ? 'SuperCode Free Models' : `${model.provider} (Premium)`,
                    order: model.tier === 'free' ? 0 : 1
                },
                auth: apiKey ? { providerLabel: 'OpenRouter', accountLabel: 'API Key' } : undefined,
                capabilities: {
                    vision: model.supportsVision || false,
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
            throw new Error('OpenRouter API key not set. Run "SuperCode: Set OpenRouter API Key" (Ctrl+Shift+K)');
        }

        let actualModelId = modelId.replace('openrouter:', '');
        const model = ALL_MODELS.find(m => m.id === actualModelId);

        this.logService.info(`[SuperCode] Using ${model?.name || actualModelId} (${model?.tier || 'unknown'})`);

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

        // Try with fallback for free models and retry for network errors
        let lastError: Error | null = null;
        let attempts = 0;
        const maxAttempts = 3;
        const freeModels = FREE_MODELS;

        while (attempts < maxAttempts) {
            try {
                return await this.makeRequest(apiKey, actualModelId, openRouterMessages, token, model);
            } catch (error: any) {
                lastError = error;
                this.logService.warn(`[SuperCode] Request failed (Attempt ${attempts + 1}/${maxAttempts}): ${error.message}`);

                const isNetworkError = error.message?.includes('fetch') || error.message?.includes('network');
                const isModelError = error.message?.includes('404') || error.message?.includes('No endpoints');
                const currentModel = ALL_MODELS.find(m => m.id === actualModelId);

                if (isNetworkError) {
                    // Retry same model on network error
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
                    continue;
                } else if (currentModel?.tier === 'free' && isModelError) {
                    // Switch model on 404/No endpoints (only for free tier)
                    this._currentModelIndex = (this._currentModelIndex + 1) % freeModels.length;
                    actualModelId = freeModels[this._currentModelIndex].id;
                    this.logService.info(`[SuperCode] Model unavailable, trying fallback: ${actualModelId}`);
                    attempts++;
                } else {
                    // Fatal error (auth, rate limit, etc)
                    throw error;
                }
            }
        }

        throw lastError || new Error('All models failed or network is unstable');
    }

    private async makeRequest(
        apiKey: string,
        modelId: string,
        messages: { role: string; content: string }[],
        token: CancellationToken,
        model?: SuperCodeModel
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
                temperature: model?.isReasoning ? 0.3 : 0.7,
                max_tokens: Math.min(model?.maxOutputTokens || 4096, 8192)
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

// Global provider instance
let globalProvider: OpenRouterLanguageModelProvider | undefined;

// ============================================================================
// WORKBENCH CONTRIBUTION
// ============================================================================

class OpenRouterContribution extends Disposable implements IWorkbenchContribution {
    static readonly ID = 'workbench.contrib.openRouter';

    constructor(
        @ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
        @ILogService private readonly logService: ILogService,
        @ISecretStorageService private readonly secretStorageService: ISecretStorageService,
        @IStorageService _storageService: IStorageService,
        @INotificationService private readonly notificationService: INotificationService
    ) {
        super();

        this.logService.info('[SuperCode] Initializing AI language model provider');

        const provider = new OpenRouterLanguageModelProvider(logService, secretStorageService, _storageService);
        globalProvider = provider;

        try {
            const registration = this.languageModelsService.registerLanguageModelProvider('openrouter', provider);
            this._register(registration);
            this.logService.info(`[SuperCode] Registered ${ALL_MODELS.length} AI models (${FREE_MODELS.length} free, ${PREMIUM_MODELS.length} premium)`);
            provider.notifyChange();
        } catch (error) {
            this.logService.error('[SuperCode] Failed to register provider:', error);
        }

        // Check for API key
        this.secretStorageService.get('supercode.openrouter.apiKey').then(key => {
            if (!key) {
                this.notificationService.prompt(
                    Severity.Info,
                    '🚀 SuperCode AI: Set your OpenRouter API key to enable AI-powered coding assistance.',
                    [{
                        label: 'Set API Key (Ctrl+Shift+K)',
                        run: () => { /* Command will be triggered */ }
                    },
                    {
                        label: 'Get Free Key',
                        run: () => {
                            this.logService.info('[SuperCode] Opening OpenRouter website');
                        }
                    }]
                );
            }
        });
    }
}

// ============================================================================
// COMMANDS
// ============================================================================

// Set API Key (Ctrl+Shift+K)
class SetOpenRouterApiKeyAction extends Action2 {
    static readonly ID = 'supercode.setOpenRouterApiKey';

    constructor() {
        super({
            id: SetOpenRouterApiKeyAction.ID,
            title: { value: localize('supercode.setApiKey', 'SuperCode: Set API Key'), original: 'SuperCode: Set API Key' },
            f1: true,
            keybinding: {
                weight: KeybindingWeight.WorkbenchContrib,
                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK
            }
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const quickInputService = accessor.get(IQuickInputService);
        const secretStorageService = accessor.get(ISecretStorageService);
        const notificationService = accessor.get(INotificationService);

        const apiKey = await quickInputService.input({
            prompt: 'Enter your OpenRouter API key (get free key at openrouter.ai/keys)',
            password: true,
            placeHolder: 'sk-or-...',
            ignoreFocusLost: true
        });

        if (apiKey) {
            await secretStorageService.set('supercode.openrouter.apiKey', apiKey);
            notificationService.info('✓ API key saved! SuperCode AI is ready.');
            globalProvider?.notifyChange();
        }
    }
}

// Select Model (Ctrl+Shift+M)
class SelectModelAction extends Action2 {
    static readonly ID = 'supercode.selectModel';

    constructor() {
        super({
            id: SelectModelAction.ID,
            title: { value: localize('supercode.selectModel', 'SuperCode: Select AI Model'), original: 'SuperCode: Select AI Model' },
            f1: true,
            keybinding: {
                weight: KeybindingWeight.WorkbenchContrib,
                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM
            }
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const quickInputService = accessor.get(IQuickInputService);
        const notificationService = accessor.get(INotificationService);

        if (!globalProvider) {
            notificationService.warn('SuperCode AI not initialized');
            return;
        }

        const currentModelId = globalProvider.getPreferredModelId();

        // Group models by tier
        const freeItems: IQuickPickItem[] = globalProvider.getFreeModels().map(model => ({
            label: `$(zap) ${model.name}`,
            description: model.id === currentModelId ? '$(check) Current' : model.provider,
            detail: `🆓 Free | ${model.description}`,
            id: model.id
        }));

        const premiumItems: IQuickPickItem[] = globalProvider.getPremiumModels().map(model => ({
            label: `$(${model.isCoder ? 'code' : model.isReasoning ? 'lightbulb' : 'comment'}) ${model.name}`,
            description: model.id === currentModelId ? '$(check) Current' : model.provider,
            detail: `💎 Premium | ${model.description}`,
            id: model.id
        }));

        const items: (IQuickPickItem | { type: 'separator', label: string })[] = [
            { type: 'separator', label: 'Free Models (No Cost)' },
            ...freeItems,
            { type: 'separator', label: 'Premium Models' },
            ...premiumItems
        ];

        const selected = await quickInputService.pick(items, {
            title: '🤖 Select AI Model',
            placeHolder: 'Choose your preferred AI model',
            ignoreFocusLost: true,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            globalProvider.setPreferredModel(selected.id as string);
            const modelName = selected.label.replace(/\$\([^)]+\)\s*/, '');
            notificationService.info(`✓ Switched to ${modelName}`);
        }
    }
}

// Select Coder Model (quick access to coding models)
class SelectCoderModelAction extends Action2 {
    static readonly ID = 'supercode.selectCoderModel';

    constructor() {
        super({
            id: SelectCoderModelAction.ID,
            title: { value: localize('supercode.selectCoderModel', 'SuperCode: Select Coding Model'), original: 'SuperCode: Select Coding Model' },
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const quickInputService = accessor.get(IQuickInputService);
        const notificationService = accessor.get(INotificationService);

        if (!globalProvider) return;

        const coderModels = globalProvider.getCoderModels();
        const currentModelId = globalProvider.getPreferredModelId();

        const items: IQuickPickItem[] = coderModels.map(model => ({
            label: `$(code) ${model.name}`,
            description: model.id === currentModelId ? '$(check) Current' : model.tier === 'free' ? '🆓 Free' : '💎',
            detail: model.description,
            id: model.id
        }));

        const selected = await quickInputService.pick(items, {
            title: '💻 Select Coding Model',
            placeHolder: 'Choose a model optimized for coding'
        });

        if (selected && 'id' in selected) {
            globalProvider.setPreferredModel(selected.id as string);
            notificationService.info(`✓ Switched to ${selected.label.replace(/\$\([^)]+\)\s*/, '')}`);
        }
    }
}

// Check API Status
class CheckApiKeyStatusAction extends Action2 {
    static readonly ID = 'supercode.checkApiKeyStatus';

    constructor() {
        super({
            id: CheckApiKeyStatusAction.ID,
            title: { value: localize('supercode.checkStatus', 'SuperCode: Check API Status'), original: 'SuperCode: Check API Status' },
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const secretStorageService = accessor.get(ISecretStorageService);
        const notificationService = accessor.get(INotificationService);

        const apiKey = await secretStorageService.get('supercode.openrouter.apiKey');

        if (!apiKey) {
            notificationService.warn('No API key set. Run "SuperCode: Set API Key" (Ctrl+Shift+K)');
            return;
        }

        try {
            const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (response.ok) {
                const data = await response.json();
                const credits = data.data?.limit_remaining !== undefined
                    ? `$${(data.data.limit_remaining / 100).toFixed(2)} remaining`
                    : 'Credits available';
                notificationService.info(`✓ API key valid! ${credits}`);
            } else {
                notificationService.error('✗ API key invalid. Please update it.');
            }
        } catch {
            notificationService.error('✗ Could not check status. Check internet connection.');
        }
    }
}

// Copy Current Model ID
class CopyModelIdAction extends Action2 {
    static readonly ID = 'supercode.copyModelId';

    constructor() {
        super({
            id: CopyModelIdAction.ID,
            title: { value: localize('supercode.copyModelId', 'SuperCode: Copy Current Model ID'), original: 'SuperCode: Copy Current Model ID' },
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const clipboardService = accessor.get(IClipboardService);
        const notificationService = accessor.get(INotificationService);

        const modelId = globalProvider?.getPreferredModelId() || FREE_MODELS[0].id;
        await clipboardService.writeText(modelId);
        notificationService.info(`Copied: ${modelId}`);
    }
}

// Clear API Key
class ClearApiKeyAction extends Action2 {
    static readonly ID = 'supercode.clearApiKey';

    constructor() {
        super({
            id: ClearApiKeyAction.ID,
            title: { value: localize('supercode.clearApiKey', 'SuperCode: Clear API Key'), original: 'SuperCode: Clear API Key' },
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const secretStorageService = accessor.get(ISecretStorageService);
        const notificationService = accessor.get(INotificationService);
        const quickInputService = accessor.get(IQuickInputService);

        const confirm = await quickInputService.pick([
            { label: '$(trash) Yes, clear the API key', id: 'yes' },
            { label: '$(close) Cancel', id: 'no' }
        ], { title: 'Clear SuperCode API Key?' });

        if (confirm && 'id' in confirm && confirm.id === 'yes') {
            await secretStorageService.delete('supercode.openrouter.apiKey');
            notificationService.info('API key cleared.');
            globalProvider?.notifyChange();
        }
    }
}

// Register all commands and contribution
registerAction2(SetOpenRouterApiKeyAction);
registerAction2(SelectModelAction);
registerAction2(SelectCoderModelAction);
registerAction2(CheckApiKeyStatusAction);
registerAction2(CopyModelIdAction);
registerAction2(ClearApiKeyAction);
registerWorkbenchContribution2(OpenRouterContribution.ID, OpenRouterContribution, WorkbenchPhase.BlockRestore);
