/*---------------------------------------------------------------------------------------------
 *  SuperCode Built-in Chat Agent
 *  Powerful AI assistant using free OpenRouter models with extensive features
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ChatAgentLocation, ChatModeKind } from './constants.js';
import {
    IChatAgentService,
    IChatAgentData,
    IChatAgentImplementation,
    IChatAgentRequest,
    IChatAgentResult,
    IChatAgentHistoryEntry
} from './participants/chatAgents.js';
import { IChatProgress, IChatFollowup } from './chatService/chatService.js';
import { ILanguageModelsService, ChatMessageRole, IChatMessage } from './languageModels.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
// import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextManager } from './contextManager.js';

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';

// ============================================================================
// SYSTEM PROMPTS - Personality and context-specific instructions
// ============================================================================

const SUPERCODE_SYSTEM_PROMPT = `You are SuperCode AI, an expert coding assistant built into the SuperCode IDE. You have FULL ACCESS to the user's codebase context and can EDIT FILES directly.

## Your Capabilities
- Write, explain, debug, and optimize code in any programming language
- Generate comprehensive tests, documentation, and code reviews
- Refactor code for better maintainability and performance
- Analyze code for security vulnerabilities
- Convert code between languages and frameworks
- **Understand the FULL project structure** from the codebase context provided
- **Create and Edit Files** directly in the workspace

## CRITICAL: File Editing
To create or edit a file, you MUST use the following XML format:

<file path="path/to/file.ext">
// Code content here
</file>

- Use relative paths from the project root.
- Provide the COMPLETE file content (no partial edits unless specifically requested).
- You can create multiple files in a single response.
- **ALWAYS** use this format when the user asks for code that should be saved.

## CRITICAL: Context Awareness
- You are provided with a comprehensive codebase context including file summaries, dependencies, and GraphQL operations
- **NEVER ask for more files** - analyze what's given and infer relationships
- Reference specific files, functions, and patterns from the context in your responses
- If information seems incomplete, make educated guesses based on common patterns and explain your assumptions
- Connect the dots between files - understand how components relate to each other

## Response Guidelines
1. Be concise but thorough - avoid unnecessary verbosity
2. Use markdown formatting for explanations
3. When creating files, use the <file> tag format described above
4. Explain what you are doing before or after the code blocks
5. Reference the provided codebase context in your explanations
6. If you see related files or patterns in the context, mention them proactively

## Important Rules
- Never include harmful, unethical, or dangerous code
- Always consider security best practices
- Prefer modern, idiomatic patterns for each language
- Include error handling where appropriate
- When analyzing code, check the dependencies and imports from context`;

const COMMAND_PROMPTS: Record<string, string> = {
    explain: `Explain the following code in detail. Break down:
1. What the code does (high-level overview)
2. How it works (step-by-step explanation)
3. Key concepts and patterns used
4. Any potential issues or improvements`,

    fix: `Analyze the following code for issues and bugs. For each issue:
1. Identify the problem
2. Explain why it's a problem
3. Provide the corrected code
4. Explain your fix`,

    test: `Generate comprehensive unit tests for the following code. Include:
1. Happy path tests
2. Edge cases
3. Error cases
4. Use appropriate testing framework for the language
5. Include setup/teardown if needed`,

    refactor: `Refactor the following code to improve its quality. Consider:
1. Code readability and clarity
2. Maintainability
3. Following best practices and design patterns
4. Reducing complexity
5. DRY principle (Don't Repeat Yourself)
Provide the refactored code with explanations.`,

    docs: `Generate comprehensive documentation for the following code:
1. Module/file level documentation
2. Function/method docstrings with parameters and return types
3. Inline comments for complex logic
4. Usage examples if applicable
Use the standard documentation format for the detected language.`,

    review: `Perform a thorough code review. Analyze:
1. **Correctness**: Does the code work as intended?
2. **Security**: Any security vulnerabilities?
3. **Performance**: Any performance issues?
4. **Maintainability**: Is it easy to understand and modify?
5. **Best Practices**: Does it follow conventions?
Provide specific, actionable feedback.`,

    security: `Analyze the following code for security vulnerabilities. Check for:
1. Injection attacks (SQL, XSS, Command, etc.)
2. Authentication/Authorization issues
3. Data exposure risks
4. Insecure dependencies
5. Hardcoded secrets
6. Input validation gaps
Rate each finding by severity (Critical/High/Medium/Low).`,

    optimize: `Optimize the following code for better performance. Consider:
1. Time complexity improvements
2. Space complexity improvements
3. Caching opportunities
4. Unnecessary operations removal
5. Better algorithms or data structures
Provide optimized code with performance analysis.`,

    convert: `Convert the following code to the target language/framework specified. Ensure:
1. Idiomatic patterns for the target platform
2. Equivalent functionality
3. Proper error handling
4. Modern best practices for the target`
};

// ============================================================================
// SLASH COMMANDS DEFINITION
// ============================================================================

const SLASH_COMMANDS = [
    { name: 'explain', description: 'Explain code in detail with step-by-step breakdown' },
    { name: 'fix', description: 'Find and fix bugs in the code' },
    { name: 'test', description: 'Generate comprehensive unit tests' },
    { name: 'refactor', description: 'Improve code structure and quality' },
    { name: 'docs', description: 'Generate documentation and comments' },
    { name: 'review', description: 'Perform thorough code review' },
    { name: 'security', description: 'Analyze for security vulnerabilities' },
    { name: 'optimize', description: 'Optimize for better performance' },
    { name: 'convert', description: 'Convert to another language/framework' }
];

// ============================================================================
// FOLLOW-UP SUGGESTIONS
// ============================================================================

function generateFollowups(command: string | undefined, response: string): IChatFollowup[] {
    const followups: IChatFollowup[] = [];

    const agentId = SuperCodeChatAgentContribution.AGENT_ID;

    switch (command) {
        case 'explain':
            followups.push(
                { kind: 'reply', title: 'Show me an example', message: 'Can you show me a usage example?', agentId },
                { kind: 'reply', title: 'What could go wrong?', message: 'What are potential edge cases or issues?', agentId }
            );
            break;
        case 'fix':
            followups.push(
                { kind: 'reply', title: 'Add error handling', message: 'Add comprehensive error handling to this code', agentId },
                { kind: 'reply', title: 'Write tests for fixes', message: '/test Generate tests to verify these fixes', agentId }
            );
            break;
        case 'test':
            followups.push(
                { kind: 'reply', title: 'Add more edge cases', message: 'Add more edge case tests', agentId },
                { kind: 'reply', title: 'Add mocking', message: 'Add mocking for external dependencies', agentId }
            );
            break;
        case 'review':
            followups.push(
                { kind: 'reply', title: 'Apply suggestions', message: '/refactor Apply the code review suggestions', agentId },
                { kind: 'reply', title: 'Security check', message: '/security Also check for security issues', agentId }
            );
            break;
        default:
            followups.push(
                { kind: 'reply', title: 'Explain this', message: '/explain Can you explain how this works?', agentId },
                { kind: 'reply', title: 'Write tests', message: '/test Generate tests for this code', agentId },
                { kind: 'reply', title: 'Improve it', message: '/refactor How can this be improved?', agentId }
            );
    }

    return followups;
}

// ============================================================================
// MAIN AGENT CONTRIBUTION
// ============================================================================

class SuperCodeChatAgentContribution extends Disposable implements IWorkbenchContribution {
    static readonly ID = 'workbench.contrib.superCodeChatAgent';
    static readonly AGENT_ID = 'supercode.chat';

    private _lastFollowups: IChatFollowup[] = [];
    private _contextManager: ContextManager;

    constructor(
        @IChatAgentService private readonly chatAgentService: IChatAgentService,
        @ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
        @ILogService private readonly logService: ILogService,
        @IEditorService private readonly editorService: IEditorService,
        @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
        @IFileService private readonly fileService: IFileService,
        @IStorageService private readonly storageService: IStorageService
    ) {
        super();

        this.logService.info('[SuperCode Agent] Initializing SuperCode AI chat agent');

        // Initialize Context Manager for full codebase awareness
        this._contextManager = new ContextManager(
            this.logService,
            this.workspaceContextService,
            this.fileService,
            this.storageService
            // this.configService // Removed as it's currently unused in ContextManager
        );

        this.registerAgent();
    }

    private registerAgent(): void {
        const agentData: IChatAgentData = {
            id: SuperCodeChatAgentContribution.AGENT_ID,
            name: 'SuperCode',
            fullName: 'SuperCode AI Assistant',
            description: 'Powerful AI assistant for coding with free models',
            extensionId: new ExtensionIdentifier('supercode.core'),
            extensionVersion: '1.0.0',
            extensionPublisherId: 'supercode',
            extensionDisplayName: 'SuperCode',
            isDefault: true,
            isCore: true,
            metadata: {
                themeIcon: { id: 'sparkle' },
                sampleRequest: 'Help me write a function to sort an array',
                followupPlaceholder: 'Ask a follow-up or use a /command...',
                additionalWelcomeMessage: '🚀 **SuperCode AI** - Your free AI coding assistant!\n\nTry these commands:\n- `/explain` - Understand code\n- `/fix` - Debug issues\n- `/test` - Generate tests\n- `/refactor` - Improve code\n- `/review` - Code review\n- `/security` - Security analysis'
            },
            slashCommands: SLASH_COMMANDS,
            locations: [ChatAgentLocation.Chat],
            modes: [ChatModeKind.Ask, ChatModeKind.Edit, ChatModeKind.Agent],
            disambiguation: [],
            capabilities: {
                supportsFileAttachments: true,
                supportsToolAttachments: true
            }
        };

        const agentImpl: IChatAgentImplementation = {
            invoke: async (
                request: IChatAgentRequest,
                progress: (parts: IChatProgress[]) => void,
                history: IChatAgentHistoryEntry[],
                token: CancellationToken
            ): Promise<IChatAgentResult> => {
                return this.handleRequest(request, progress, history, token);
            },
            provideFollowups: async (
                _request: IChatAgentRequest,
                _result: IChatAgentResult,
                _history: IChatAgentHistoryEntry[],
                _token: CancellationToken
            ): Promise<IChatFollowup[]> => {
                return this._lastFollowups;
            },
            provideChatTitle: async (
                history: IChatAgentHistoryEntry[],
                _token: CancellationToken
            ): Promise<string | undefined> => {
                if (history.length === 0) return undefined;
                const firstMessage = history[0].request.message;
                // Generate a short title from the first message
                const words = firstMessage.split(/\s+/).slice(0, 6).join(' ');
                return words.length > 50 ? words.substring(0, 47) + '...' : words;
            }
        };

        try {
            const dataRegistration = this.chatAgentService.registerAgent(agentData.id, agentData);
            this._register(dataRegistration);

            const implRegistration = this.chatAgentService.registerAgentImplementation(agentData.id, agentImpl);
            this._register(implRegistration);

            this.logService.info('[SuperCode Agent] Successfully registered SuperCode AI agent with enhanced features');
        } catch (error) {
            this.logService.error('[SuperCode Agent] Failed to register agent:', error);
        }
    }

    private async handleRequest(
        request: IChatAgentRequest,
        progress: (parts: IChatProgress[]) => void,
        history: IChatAgentHistoryEntry[],
        token: CancellationToken
    ): Promise<IChatAgentResult> {
        const startTime = Date.now();

        try {
            // Get available models
            const modelIds = await this.languageModelsService.selectLanguageModels({ vendor: 'openrouter' });

            if (modelIds.length === 0) {
                progress([{
                    kind: 'markdownContent',
                    content: { value: '⚠️ **No AI models available.**\n\nPlease set your OpenRouter API key:\n1. Open Command Palette (`Ctrl+Shift+P`)\n2. Run `SuperCode: Set OpenRouter API Key`\n3. Get a free key at [openrouter.ai](https://openrouter.ai)\n\n*Tip: OpenRouter provides free access to powerful AI models!*' }
                }]);
                return { errorDetails: { message: 'No models available' } };
            }

            // Select model
            const modelId = request.userSelectedModelId || modelIds[0];

            // Show model info at start
            const modelName = modelId.replace('openrouter:', '').split('/').pop()?.replace(/:free$/, '') || modelId;
            progress([{
                kind: 'markdownContent',
                content: { value: `*Using ${modelName}...*\n\n` }
            }]);

            // Build context-aware messages
            const messages = await this.buildMessages(request, history);

            this.logService.info(`[SuperCode Agent] Request to ${modelId} with ${messages.length} messages`);

            // Send request
            const response = await this.languageModelsService.sendChatRequest(
                modelId,
                new ExtensionIdentifier('supercode.core'),
                messages,
                {},
                token
            );

            // Stream the response
            let fullResponse = '';
            for await (const part of response.stream) {
                if (token.isCancellationRequested) break;

                if (Array.isArray(part)) {
                    for (const p of part) {
                        if (p.type === 'text') {
                            fullResponse += p.value;
                            progress([{ kind: 'markdownContent', content: { value: p.value } }]);
                        }
                    }
                } else if (part.type === 'text') {
                    fullResponse += part.value;
                    progress([{ kind: 'markdownContent', content: { value: part.value } }]);
                }
            }

            // Process file edits from response
            await this.processFileEdits(fullResponse, progress);

            // Generate followups based on command and response
            this._lastFollowups = generateFollowups(request.command, fullResponse);

            const elapsed = Date.now() - startTime;
            this.logService.info(`[SuperCode Agent] Request completed in ${elapsed}ms`);

            return {};
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logService.error('[SuperCode Agent] Request failed:', error);

            progress([{
                kind: 'markdownContent',
                content: { value: `\n\n---\n❌ **Error:** ${errorMessage}\n\n*Tip: Try a different model or check your API key.*` }
            }]);

            return { errorDetails: { message: errorMessage } };
        }
    }

    private async processFileEdits(response: string, progress: (parts: IChatProgress[]) => void): Promise<void> {
        const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
        let match;
        let editsFound = false;

        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
        if (!workspaceRoot) return;

        while ((match = fileRegex.exec(response)) !== null) {
            editsFound = true;
            const relativePath = match[1];
            const content = match[2].trim();
            const fileUri = URI.joinPath(workspaceRoot, relativePath);

            try {
                // Create directory if needed
                const dir = URI.joinPath(fileUri, '..');
                await this.fileService.createFolder(dir);

                // Write file
                await this.fileService.writeFile(fileUri, VSBuffer.fromString(content));

                this.logService.info(`[SuperCode Agent] Created/Updated file: ${relativePath}`);
                progress([{
                    kind: 'markdownContent',
                    content: { value: `\n\n✅ **Applied changes to:** \`${relativePath}\`` }
                }]);
            } catch (error) {
                this.logService.error(`[SuperCode Agent] Failed to write file ${relativePath}:`, error);
                progress([{
                    kind: 'markdownContent',
                    content: { value: `\n\n❌ **Failed to write:** \`${relativePath}\` - ${error}` }
                }]);
            }
        }

        if (editsFound) {
            progress([{
                kind: 'markdownContent',
                content: { value: '\n\n*File changes have been applied to your workspace.*' }
            }]);
        }
    }

    private async buildMessages(
        request: IChatAgentRequest,
        history: IChatAgentHistoryEntry[]
    ): Promise<IChatMessage[]> {
        const messages: IChatMessage[] = [];

        // System prompt
        let systemPrompt = SUPERCODE_SYSTEM_PROMPT;

        // Add command-specific instructions
        if (request.command && COMMAND_PROMPTS[request.command]) {
            systemPrompt += `\n\n## Current Task\n${COMMAND_PROMPTS[request.command]}`;
        }

        // Add FULL codebase context (Cursor-like awareness)
        try {
            const codebaseContext = await this._contextManager.getContextForPrompt(15000);
            if (codebaseContext) {
                systemPrompt += `\n\n${codebaseContext}`;
            }
        } catch (error) {
            this.logService.warn('[SuperCode Agent] Failed to get codebase context:', error);
        }

        // Add context from active editor (focused file)
        const editorContext = await this.getEditorContext();
        if (editorContext) {
            systemPrompt += `\n\n## Currently Active File\n${editorContext}`;
        }

        messages.push({
            role: ChatMessageRole.System,
            content: [{ type: 'text', value: systemPrompt }]
        });

        // Add conversation history (last 10 messages for context window efficiency)
        const recentHistory = history.slice(-10);
        for (const entry of recentHistory) {
            messages.push({
                role: ChatMessageRole.User,
                content: [{ type: 'text', value: entry.request.message }]
            });

            const responseText = entry.response
                .filter((r): r is { kind: 'markdownContent'; content: { value: string } } =>
                    'kind' in r && r.kind === 'markdownContent')
                .map(r => r.content.value)
                .join('');

            if (responseText) {
                messages.push({
                    role: ChatMessageRole.Assistant,
                    content: [{ type: 'text', value: responseText }]
                });
            }
        }

        // Add current request with any attached variables
        let userMessage = request.message;

        // Include variable attachments
        if (request.variables?.variables && request.variables.variables.length > 0) {
            const attachments = request.variables.variables
                .map(v => `[Attached: ${v.name}]`)
                .join(' ');
            userMessage = `${attachments}\n\n${userMessage}`;
        }

        messages.push({
            role: ChatMessageRole.User,
            content: [{ type: 'text', value: userMessage }]
        });

        return messages;
    }

    private async getEditorContext(): Promise<string | null> {
        const editor = this.editorService.activeTextEditorControl;
        if (!editor) return null;

        const model = editor.getModel?.() as ITextModel | undefined;
        if (!model) return null;

        const selection = editor.getSelection?.();
        const fileName = model.uri.path.split('/').pop() || 'unknown';
        const language = model.getLanguageId();

        let context = `File: ${fileName} (${language})`;

        // Include selected text if any, otherwise include visible range or full file (truncated)
        if (selection && !selection.isEmpty()) {
            const selectedText = model.getValueInRange(selection);
            if (selectedText.length <= 8000) {
                context += `\nSelected code (lines ${selection.startLineNumber}-${selection.endLineNumber}):\n\`\`\`${language}\n${selectedText}\n\`\`\``;
            } else {
                // Truncate very long selections
                context += `\nSelected code (lines ${selection.startLineNumber}-${selection.endLineNumber}, truncated):\n\`\`\`${language}\n${selectedText.substring(0, 8000)}\n... [truncated - ${selectedText.length} total characters]\n\`\`\``;
            }
        } else {
            // No selection - include visible code or beginning of file
            const visibleRanges = (editor as any).getVisibleRanges?.();
            if (visibleRanges && visibleRanges.length > 0) {
                const visibleRange = visibleRanges[0];
                const visibleText = model.getValueInRange(visibleRange);
                if (visibleText.trim()) {
                    context += `\nVisible code (lines ${visibleRange.startLineNumber}-${visibleRange.endLineNumber}):\n\`\`\`${language}\n${visibleText.substring(0, 6000)}\n\`\`\``;
                }
            } else {
                // Fallback: include first portion of the file
                const fullText = model.getValue();
                const lineCount = model.getLineCount();
                const previewLength = Math.min(fullText.length, 6000);
                if (fullText.trim()) {
                    context += `\nFile content (${lineCount} lines total):\n\`\`\`${language}\n${fullText.substring(0, previewLength)}${fullText.length > previewLength ? '\n... [file continues]' : ''}\n\`\`\``;
                }
            }
        }

        return context;
    }
}

registerWorkbenchContribution2(SuperCodeChatAgentContribution.ID, SuperCodeChatAgentContribution, WorkbenchPhase.BlockRestore);
