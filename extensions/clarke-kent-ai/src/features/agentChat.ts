/*---------------------------------------------------------------------------------------------
 *  Clarke Kent AI - Agent Chat Panel
 *  WebviewPanel-based chat interface with slash commands and follow-up suggestions
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ContextProvider, EditorContext } from './contextProvider';
import {
    SLASH_COMMANDS,
    parseCommand,
    getModelForCommand,
    extractSuggestions,
    getCommandList,
    CommandResult
} from './slashCommands';
import { EditorIntegration } from './editorIntegration';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    suggestions?: string[];
}

export class AgentChatPanel {
    public static currentPanel: AgentChatPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionContext: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private _messages: ChatMessage[] = [];
    private _isProcessing: boolean = false;

    // CRITICAL: Store the last known editor context BEFORE panel gets focus
    private _cachedContext: EditorContext | null = null;
    private _lastActiveEditor: vscode.TextEditor | undefined;

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionContext = context;

        // Capture context immediately when panel is created
        this._captureContext();

        // Set initial HTML
        this._updateWebview();

        // Handle panel disposal
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from webview
        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );

        // CRITICAL: Capture context when editor selection changes (before focus is lost)
        vscode.window.onDidChangeTextEditorSelection(
            (e) => {
                // Only update if it's a real text editor (not the webview)
                if (e.textEditor.document.uri.scheme !== 'output') {
                    this._lastActiveEditor = e.textEditor;
                    this._captureContextFromEditor(e.textEditor);
                }
            },
            null,
            this._disposables
        );

        // CRITICAL: Track active editor changes
        vscode.window.onDidChangeActiveTextEditor(
            (editor) => {
                if (editor && editor.document.uri.scheme !== 'output') {
                    this._lastActiveEditor = editor;
                    this._captureContextFromEditor(editor);
                }
            },
            null,
            this._disposables
        );

        // Capture context when panel visibility changes
        this._panel.onDidChangeViewState(
            (e) => {
                if (e.webviewPanel.visible) {
                    // Panel is becoming visible, capture context from last editor
                    if (this._lastActiveEditor) {
                        this._captureContextFromEditor(this._lastActiveEditor);
                    }
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Capture context from the currently active editor
     */
    private async _captureContext(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.scheme !== 'output') {
            this._lastActiveEditor = editor;
            await this._captureContextFromEditor(editor);
        }
    }

    /**
     * Capture context from a specific editor
     */
    private async _captureContextFromEditor(editor: vscode.TextEditor): Promise<void> {
        try {
            const document = editor.document;
            const selection = editor.selection;

            const code = selection.isEmpty
                ? document.getText()
                : document.getText(selection);

            const diagnostics = vscode.languages.getDiagnostics(document.uri);

            this._cachedContext = {
                code,
                language: document.languageId,
                fileName: document.fileName.split('/').pop() || document.fileName,
                filePath: document.fileName,
                workspaceName: vscode.workspace.name || 'Unknown',
                selection: {
                    startLine: selection.start.line + 1,
                    endLine: selection.end.line + 1,
                    isEmpty: selection.isEmpty
                },
                diagnostics,
                relatedFiles: []
            };

            // Update webview with context indicator
            this._sendContextUpdate();
        } catch (error) {
            console.error('Error capturing context:', error);
        }
    }

    /**
     * Send context update to webview
     */
    private _sendContextUpdate(): void {
        if (this._cachedContext) {
            const preview = this._cachedContext.code.substring(0, 100);
            const hasSelection = !this._cachedContext.selection.isEmpty;

            try {
                this._panel.webview.postMessage({
                    type: 'contextUpdate',
                    fileName: this._cachedContext.fileName,
                    language: this._cachedContext.language,
                    hasSelection,
                    codePreview: preview,
                    lines: hasSelection
                        ? `Lines ${this._cachedContext.selection.startLine}-${this._cachedContext.selection.endLine}`
                        : 'Entire file'
                });
            } catch {
                // Panel might not be ready
            }
        }
    }

    public static createOrShow(context: vscode.ExtensionContext): void {
        // CRITICAL: Capture context BEFORE creating the panel
        const currentEditor = vscode.window.activeTextEditor;

        const column = vscode.ViewColumn.Beside;

        if (AgentChatPanel.currentPanel) {
            // Update cached context before revealing
            if (currentEditor) {
                AgentChatPanel.currentPanel._captureContextFromEditor(currentEditor);
            }
            AgentChatPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'clarkeKentAgent',
            '🦸 Clarke Kent',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        AgentChatPanel.currentPanel = new AgentChatPanel(panel, context);

        // Capture context from current editor
        if (currentEditor) {
            AgentChatPanel.currentPanel._captureContextFromEditor(currentEditor);
        }
    }

    public dispose(): void {
        AgentChatPanel.currentPanel = undefined;
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private async _handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'userMessage':
                await this._processUserMessage(message.text);
                break;
            case 'suggestionClick':
                await this._processUserMessage(message.command);
                break;
            case 'applyCode':
                await EditorIntegration.replaceCode(message.code);
                break;
            case 'copyCode':
                await vscode.env.clipboard.writeText(message.code);
                vscode.window.showInformationMessage('📋 Copied to clipboard!');
                break;
            case 'clearChat':
                this._messages = [];
                this._updateWebview();
                break;
            case 'refreshContext':
                await this._captureContext();
                break;
        }
    }

    private async _processUserMessage(input: string): Promise<void> {
        if (this._isProcessing || !input.trim()) return;

        this._isProcessing = true;

        // Add user message
        this._messages.push({
            role: 'user',
            content: input,
            timestamp: Date.now()
        });
        this._updateWebview();

        try {
            // Use CACHED context (captured before webview got focus)
            const context = this._cachedContext;

            // Parse command
            const parsed = parseCommand(input);

            let response: string;
            let suggestions: string[] = ['/explain', '/fix', '/test'];
            let action: 'replace' | 'insert' | 'newFile' | 'terminal' | 'display' = 'display';

            if (parsed && SLASH_COMMANDS[parsed.command]) {
                // Handle slash command
                const commandHandler = SLASH_COMMANDS[parsed.command];

                if (!context || !context.code.trim()) {
                    response = `⚠️ **No code context captured!**

Please:
1. Click on your code file in the editor
2. Select the code you want to analyze (or leave unselected for entire file)
3. Then come back here and try the command again

**Tip:** The agent captures code when you switch to your editor. Make sure you have code selected before using slash commands.`;
                } else {
                    // Show what context we're using
                    const contextInfo = `📄 **Using:** ${context.fileName} (${context.language})${!context.selection.isEmpty ? ` | Lines ${context.selection.startLine}-${context.selection.endLine}` : ' | Entire file'}`;

                    this._messages.push({
                        role: 'system',
                        content: contextInfo,
                        timestamp: Date.now()
                    });

                    const result = await commandHandler.handler(parsed.args, context);
                    const prompt = result.content;
                    action = result.action || 'display';
                    suggestions = result.suggestions;

                    // Call AI
                    response = await this._callAI(prompt, parsed.command);

                    // Extract AI suggestions if present
                    const aiSuggestions = extractSuggestions(response);
                    if (aiSuggestions.length > 0) {
                        suggestions = aiSuggestions;
                    }
                }
            } else if (parsed) {
                // Unknown command
                response = `Unknown command: ${parsed.command}\n\nAvailable commands:\n${getCommandList().map(c => `${c.icon} **${c.command}** - ${c.description}`).join('\n')}`;
            } else {
                // Regular chat message - include context if available
                if (!context || !context.code.trim()) {
                    response = await this._callAI(input);
                } else {
                    const contextPrefix = ContextProvider.buildContextPrefix(context);
                    const prompt = `${contextPrefix}\nUser question: ${input}\n\nContext code:\n\`\`\`${context.language}\n${context.code}\n\`\`\``;
                    response = await this._callAI(prompt);
                }
            }

            // Add assistant message
            this._messages.push({
                role: 'assistant',
                content: response,
                timestamp: Date.now(),
                suggestions
            });

            // Apply action if it's a command that modifies code
            if (parsed && SLASH_COMMANDS[parsed.command] && action !== 'display' && context) {
                // Ask user if they want to apply the changes
                const apply = await vscode.window.showInformationMessage(
                    'Apply changes to editor?',
                    'Apply',
                    'View Only'
                );

                if (apply === 'Apply') {
                    await EditorIntegration.applyAction(action, response, {
                        language: context?.language,
                        command: parsed.command
                    });
                }
            }

        } catch (error: any) {
            this._messages.push({
                role: 'assistant',
                content: `❌ Error: ${error.message}`,
                timestamp: Date.now()
            });
        }

        this._isProcessing = false;
        this._updateWebview();
    }

    private async _callAI(prompt: string, command?: string): Promise<string> {
        const apiKey = await this._extensionContext.secrets.get('openrouter.apiKey');

        if (!apiKey) {
            throw new Error('OpenRouter API key not set. Use "Clarke Kent: Set OpenRouter API Key" first.');
        }

        const model = command
            ? getModelForCommand(command)
            : this._extensionContext.globalState.get('selectedModel', 'qwen/qwen-2.5-coder-32b-instruct:free');

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
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as any;
        return data.choices?.[0]?.message?.content || 'No response received';
    }

    private _updateWebview(): void {
        this._panel.webview.html = this._getHtmlContent();
    }

    private _getHtmlContent(): string {
        const messagesHtml = this._messages.map(msg => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system';
            const time = new Date(msg.timestamp).toLocaleTimeString();

            let content = this._escapeHtml(msg.content);
            // Parse markdown code blocks
            content = content.replace(/```(\w*)\n([\s\S]*?)```/g,
                '<pre class="code-block" data-lang="$1"><code>$2</code><div class="code-actions"><button onclick="copyCode(this)">📋 Copy</button><button onclick="applyCode(this)">✅ Apply</button></div></pre>');
            content = content.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
            content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            content = content.replace(/\n/g, '<br>');

            const suggestionsHtml = msg.suggestions?.length
                ? `<div class="suggestions">${msg.suggestions.map(s =>
                    `<button class="suggestion-btn" onclick="sendSuggestion('${s}')">${s}</button>`
                ).join('')}</div>`
                : '';

            if (isSystem) {
                return `<div class="message system"><div class="message-content">${content}</div></div>`;
            }

            return `
                <div class="message ${isUser ? 'user' : 'assistant'}">
                    <div class="message-header">
                        <span class="role">${isUser ? '👤 You' : '🦸 Clarke Kent'}</span>
                        <span class="time">${time}</span>
                    </div>
                    <div class="message-content">${content}</div>
                    ${suggestionsHtml}
                </div>
            `;
        }).join('');

        const commandsHtml = getCommandList().map(c =>
            `<div class="command-item" onclick="insertCommand('${c.command}')">${c.icon} <strong>${c.command}</strong> - ${c.description}</div>`
        ).join('');

        // Context indicator
        const contextIndicator = this._cachedContext
            ? `<div class="context-indicator">
                 <span class="context-file">📄 ${this._cachedContext.fileName}</span>
                 <span class="context-lang">${this._cachedContext.language}</span>
                 <span class="context-lines">${!this._cachedContext.selection.isEmpty
                ? `Lines ${this._cachedContext.selection.startLine}-${this._cachedContext.selection.endLine}`
                : 'Entire file'}</span>
                 <button class="refresh-btn" onclick="refreshContext()">🔄</button>
               </div>`
            : `<div class="context-indicator no-context">
                 <span>⚠️ No code context - click on your editor first</span>
                 <button class="refresh-btn" onclick="refreshContext()">🔄 Refresh</button>
               </div>`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Clarke Kent AI</title>
    <style>
        :root {
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --bg-tertiary: #2d2d2d;
            --text-primary: #d4d4d4;
            --text-secondary: #858585;
            --accent-blue: #4fc3f7;
            --accent-green: #4ec9b0;
            --accent-red: #f48771;
            --accent-yellow: #dcdcaa;
            --border-color: #3c3c3c;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            background: linear-gradient(135deg, #1a237e 0%, #0d47a1 50%, #b71c1c 100%);
            padding: 16px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border-color);
        }

        .header h1 {
            font-size: 18px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .header-actions {
            display: flex;
            gap: 8px;
        }

        .header-btn {
            background: rgba(255,255,255,0.1);
            border: none;
            color: white;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }

        .header-btn:hover {
            background: rgba(255,255,255,0.2);
        }

        .context-indicator {
            background: var(--bg-tertiary);
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 12px;
            border-bottom: 1px solid var(--border-color);
        }

        .context-indicator.no-context {
            background: rgba(244, 135, 113, 0.1);
            color: var(--accent-red);
        }

        .context-file {
            color: var(--accent-blue);
            font-weight: 500;
        }

        .context-lang {
            background: var(--bg-secondary);
            padding: 2px 8px;
            border-radius: 4px;
            color: var(--accent-green);
        }

        .context-lines {
            color: var(--text-secondary);
        }

        .refresh-btn {
            margin-left: auto;
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }

        .refresh-btn:hover {
            background: var(--bg-secondary);
            color: var(--text-primary);
        }

        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }

        .message {
            margin-bottom: 16px;
            padding: 12px 16px;
            border-radius: 8px;
            max-width: 90%;
        }

        .message.user {
            background: var(--bg-tertiary);
            margin-left: auto;
            border: 1px solid var(--border-color);
        }

        .message.assistant {
            background: var(--bg-secondary);
            border-left: 3px solid var(--accent-blue);
        }

        .message.system {
            background: rgba(79, 195, 247, 0.1);
            border-left: 3px solid var(--accent-blue);
            font-size: 12px;
            padding: 8px 12px;
            color: var(--text-secondary);
        }

        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
        }

        .role {
            font-weight: 600;
            color: var(--accent-blue);
        }

        .time {
            color: var(--text-secondary);
        }

        .message-content {
            line-height: 1.6;
            word-wrap: break-word;
        }

        .code-block {
            background: #1a1a1a;
            border-radius: 6px;
            padding: 12px;
            margin: 10px 0;
            overflow-x: auto;
            position: relative;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
        }

        .code-block code {
            color: var(--accent-green);
        }

        .code-actions {
            position: absolute;
            top: 8px;
            right: 8px;
            display: flex;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.2s;
        }

        .code-block:hover .code-actions {
            opacity: 1;
        }

        .code-actions button {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }

        .code-actions button:hover {
            background: var(--accent-blue);
            color: #1a1a1a;
        }

        .inline-code {
            background: var(--bg-tertiary);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Consolas', monospace;
            font-size: 0.9em;
            color: var(--accent-yellow);
        }

        .suggestions {
            margin-top: 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .suggestion-btn {
            background: linear-gradient(135deg, #0d47a1 0%, #1565c0 100%);
            border: none;
            color: white;
            padding: 6px 12px;
            border-radius: 16px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: transform 0.1s, box-shadow 0.1s;
        }

        .suggestion-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(13, 71, 161, 0.4);
        }

        .input-container {
            padding: 16px;
            background: var(--bg-secondary);
            border-top: 1px solid var(--border-color);
        }

        .input-wrapper {
            display: flex;
            gap: 8px;
            background: var(--bg-tertiary);
            border-radius: 8px;
            padding: 8px 12px;
            border: 1px solid var(--border-color);
        }

        .input-wrapper:focus-within {
            border-color: var(--accent-blue);
        }

        #userInput {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--text-primary);
            font-size: 14px;
            outline: none;
            font-family: inherit;
        }

        #userInput::placeholder {
            color: var(--text-secondary);
        }

        .send-btn {
            background: linear-gradient(135deg, #b71c1c 0%, #d32f2f 100%);
            border: none;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            transition: transform 0.1s;
        }

        .send-btn:hover {
            transform: scale(1.02);
        }

        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .commands-panel {
            padding: 12px 16px;
            background: var(--bg-tertiary);
            border-top: 1px solid var(--border-color);
            max-height: 200px;
            overflow-y: auto;
            display: none;
        }

        .commands-panel.visible {
            display: block;
        }

        .command-item {
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }

        .command-item:hover {
            background: var(--bg-secondary);
        }

        .welcome {
            text-align: center;
            padding: 40px 20px;
            color: var(--text-secondary);
        }

        .welcome h2 {
            color: var(--accent-blue);
            margin-bottom: 8px;
        }

        .welcome p {
            margin-bottom: 20px;
        }

        .processing {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--accent-blue);
            padding: 12px 16px;
        }

        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--border-color);
            border-top-color: var(--accent-blue);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🦸 Clarke Kent AI</h1>
        <div class="header-actions">
            <button class="header-btn" onclick="toggleCommands()">📋 Commands</button>
            <button class="header-btn" onclick="clearChat()">🗑️ Clear</button>
        </div>
    </div>

    ${contextIndicator}

    <div class="commands-panel" id="commandsPanel">
        <div style="margin-bottom: 8px; font-weight: 600; color: var(--accent-yellow);">Available Commands:</div>
        ${commandsHtml}
    </div>

    <div class="messages-container" id="messages">
        ${messagesHtml || `
            <div class="welcome">
                <h2>Welcome to Clarke Kent AI</h2>
                <p>Your super-powered coding assistant</p>
                <div style="text-align: left; max-width: 400px; margin: 0 auto;">
                    <p style="margin-bottom: 12px;"><strong>Quick start:</strong></p>
                    <p style="margin-bottom: 8px;">1️⃣ Click on your code file in the editor</p>
                    <p style="margin-bottom: 8px;">2️⃣ Select the code you want to work with</p>
                    <p style="margin-bottom: 8px;">3️⃣ Come back here and type a command like <code class="inline-code">/explain</code></p>
                    <p style="margin-top: 16px; color: var(--accent-yellow);"><strong>💡 Tip:</strong> The context bar above shows what code is captured!</p>
                </div>
            </div>
        `}
        ${this._isProcessing ? '<div class="processing"><div class="spinner"></div>Clarke Kent is thinking...</div>' : ''}
    </div>

    <div class="input-container">
        <div class="input-wrapper">
            <input type="text" id="userInput" placeholder="Type /command or ask a question..." autocomplete="off" />
            <button class="send-btn" onclick="sendMessage()" ${this._isProcessing ? 'disabled' : ''}>Send</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const input = document.getElementById('userInput');
        const messages = document.getElementById('messages');
        const commandsPanel = document.getElementById('commandsPanel');

        // Scroll to bottom on load
        messages.scrollTop = messages.scrollHeight;

        // Enter key to send
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
            // Show commands panel when typing /
            if (e.key === '/' && input.value === '') {
                commandsPanel.classList.add('visible');
            }
        });

        // Hide commands panel when clicking elsewhere
        input.addEventListener('blur', () => {
            setTimeout(() => commandsPanel.classList.remove('visible'), 200);
        });

        function sendMessage() {
            const text = input.value.trim();
            if (!text) return;

            vscode.postMessage({ type: 'userMessage', text });
            input.value = '';
            commandsPanel.classList.remove('visible');
        }

        function sendSuggestion(command) {
            vscode.postMessage({ type: 'suggestionClick', command });
        }

        function insertCommand(command) {
            input.value = command + ' ';
            input.focus();
            commandsPanel.classList.remove('visible');
        }

        function toggleCommands() {
            commandsPanel.classList.toggle('visible');
        }

        function clearChat() {
            vscode.postMessage({ type: 'clearChat' });
        }

        function refreshContext() {
            vscode.postMessage({ type: 'refreshContext' });
        }

        function copyCode(btn) {
            const codeBlock = btn.closest('.code-block');
            const code = codeBlock.querySelector('code').textContent;
            vscode.postMessage({ type: 'copyCode', code });
        }

        function applyCode(btn) {
            const codeBlock = btn.closest('.code-block');
            const code = codeBlock.querySelector('code').textContent;
            vscode.postMessage({ type: 'applyCode', code });
        }

        // Listen for context updates
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'contextUpdate') {
                // Context was updated
                console.log('Context updated:', message);
            }
        });
    </script>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
