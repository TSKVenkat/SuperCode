import * as vscode from 'vscode';
import { OpenRouterClient, ChatMessage } from '../openrouter/client';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'clarkeKent.chatView';
    private _view?: vscode.WebviewView;
    private _conversationHistory: ChatMessage[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _client: OpenRouterClient
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'sendMessage':
                    await this._handleChatMessage(data.message);
                    break;
                case 'clearChat':
                    this._conversationHistory = [];
                    this._postMessage({ type: 'clearChat' });
                    break;
                case 'insertCode':
                    await this._insertCode(data.code);
                    break;
                case 'copyCode':
                    await vscode.env.clipboard.writeText(data.code);
                    vscode.window.showInformationMessage('Code copied to clipboard!');
                    break;
            }
        });
    }

    public async explainCode(code: string): Promise<void> {
        if (!this._view) {
            return;
        }

        this._postMessage({ type: 'userMessage', message: `Explain this code:\n\`\`\`\n${code}\n\`\`\`` });

        try {
            const explanation = await this._client.explainCode(code);
            this._postMessage({ type: 'assistantMessage', message: explanation });
        } catch (error: any) {
            this._postMessage({ type: 'error', message: error.message });
        }
    }

    private async _handleChatMessage(message: string): Promise<void> {
        // Add user message to history
        this._conversationHistory.push({ role: 'user', content: message });

        // Show user message in UI
        this._postMessage({ type: 'userMessage', message });

        // Show typing indicator
        this._postMessage({ type: 'typing', isTyping: true });

        try {
            const config = vscode.workspace.getConfiguration('clarkeKent');
            const streamEnabled = config.get<boolean>('streamResponses', true);

            if (streamEnabled) {
                // Stream the response
                let fullResponse = '';
                const response = await this._client.chat(
                    this._conversationHistory,
                    undefined,
                    (chunk) => {
                        fullResponse += chunk;
                        this._postMessage({ type: 'streamChunk', chunk });
                    }
                );

                this._postMessage({ type: 'streamEnd' });
                this._conversationHistory.push({ role: 'assistant', content: fullResponse });
            } else {
                // Non-streaming response
                const response = await this._client.chat(this._conversationHistory);
                this._postMessage({ type: 'assistantMessage', message: response });
                this._conversationHistory.push({ role: 'assistant', content: response });
            }
        } catch (error: any) {
            this._postMessage({ type: 'error', message: error.message });
        } finally {
            this._postMessage({ type: 'typing', isTyping: false });
        }
    }

    private async _insertCode(code: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Code inserted!');
        } else {
            const doc = await vscode.workspace.openTextDocument({ content: code });
            await vscode.window.showTextDocument(doc);
        }
    }

    private _postMessage(message: any): void {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Clarke Kent AI</title>
    <style>
        :root {
            --bg-primary: #0A1929;
            --bg-secondary: #0D2240;
            --bg-tertiary: #1A3050;
            --text-primary: #E8F0FF;
            --text-secondary: #8EACFF;
            --accent-blue: #0033AA;
            --accent-red: #CC0000;
            --accent-gold: #FFD700;
            --border-color: #1A3050;
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: var(--vscode-font-family);
            background: var(--bg-primary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            background: linear-gradient(135deg, var(--accent-blue), var(--bg-secondary));
            padding: 12px 16px;
            border-bottom: 2px solid var(--accent-red);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .header-icon {
            width: 32px;
            height: 32px;
            background: var(--accent-red);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: var(--accent-gold);
            font-size: 18px;
            border: 2px solid var(--accent-gold);
        }
        
        .header-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--accent-gold);
        }
        
        .header-subtitle {
            font-size: 11px;
            color: var(--text-secondary);
        }
        
        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        .message {
            max-width: 90%;
            padding: 12px 16px;
            border-radius: 12px;
            line-height: 1.5;
            word-wrap: break-word;
        }
        
        .message.user {
            background: var(--accent-blue);
            color: white;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
        }
        
        .message.assistant {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            align-self: flex-start;
            border-bottom-left-radius: 4px;
        }
        
        .message.error {
            background: rgba(204, 0, 0, 0.2);
            border: 1px solid var(--accent-red);
            color: #FF8888;
        }
        
        .message pre {
            background: var(--bg-primary);
            padding: 12px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 8px 0;
            border: 1px solid var(--border-color);
        }
        
        .message code {
            font-family: 'Fira Code', 'Consolas', monospace;
            font-size: 13px;
        }
        
        .code-block {
            position: relative;
        }
        
        .code-actions {
            position: absolute;
            top: 8px;
            right: 8px;
            display: flex;
            gap: 4px;
        }
        
        .code-action-btn {
            background: var(--accent-blue);
            color: white;
            border: none;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }
        
        .code-action-btn:hover {
            background: var(--accent-red);
        }
        
        .typing-indicator {
            display: none;
            padding: 12px 16px;
            color: var(--text-secondary);
            font-style: italic;
        }
        
        .typing-indicator.visible {
            display: block;
        }
        
        .typing-dots {
            display: inline-flex;
            gap: 4px;
        }
        
        .typing-dots span {
            width: 6px;
            height: 6px;
            background: var(--accent-gold);
            border-radius: 50%;
            animation: typing 1.4s infinite;
        }
        
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes typing {
            0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
            30% { opacity: 1; transform: translateY(-4px); }
        }
        
        .input-container {
            padding: 12px 16px;
            background: var(--bg-secondary);
            border-top: 1px solid var(--border-color);
        }
        
        .input-wrapper {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }
        
        textarea {
            flex: 1;
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 10px 12px;
            color: var(--text-primary);
            font-family: inherit;
            font-size: 14px;
            resize: none;
            min-height: 40px;
            max-height: 120px;
        }
        
        textarea:focus {
            outline: none;
            border-color: var(--accent-blue);
        }
        
        textarea::placeholder {
            color: var(--text-secondary);
        }
        
        .send-btn {
            background: var(--accent-red);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 10px 16px;
            cursor: pointer;
            font-weight: 600;
            transition: background 0.2s;
        }
        
        .send-btn:hover {
            background: #DD2222;
        }
        
        .send-btn:disabled {
            background: var(--bg-tertiary);
            cursor: not-allowed;
        }
        
        .welcome-message {
            text-align: center;
            padding: 24px;
            color: var(--text-secondary);
        }
        
        .welcome-message h2 {
            color: var(--accent-gold);
            margin-bottom: 8px;
        }
        
        .clear-btn {
            background: none;
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            margin-left: auto;
        }
        
        .clear-btn:hover {
            border-color: var(--accent-red);
            color: var(--accent-red);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-icon">S</div>
        <div>
            <div class="header-title">Clarke Kent</div>
            <div class="header-subtitle">Your AI Coding Assistant</div>
        </div>
        <button class="clear-btn" onclick="clearChat()">Clear</button>
    </div>
    
    <div class="chat-container" id="chatContainer">
        <div class="welcome-message">
            <h2>👋 Hello, I'm Clarke Kent!</h2>
            <p>Your Superman-powered AI assistant. Ask me anything about code!</p>
        </div>
    </div>
    
    <div class="typing-indicator" id="typingIndicator">
        Clarke Kent is thinking
        <div class="typing-dots">
            <span></span>
            <span></span>
            <span></span>
        </div>
    </div>
    
    <div class="input-container">
        <div class="input-wrapper">
            <textarea 
                id="messageInput" 
                placeholder="Ask Clarke Kent anything..."
                rows="1"
                onkeydown="handleKeyDown(event)"
                oninput="autoResize(this)"
            ></textarea>
            <button class="send-btn" id="sendBtn" onclick="sendMessage()">Send</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const chatContainer = document.getElementById('chatContainer');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const typingIndicator = document.getElementById('typingIndicator');
        
        let currentStreamMessage = null;
        let isFirstMessage = true;

        function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;
            
            if (isFirstMessage) {
                chatContainer.innerHTML = '';
                isFirstMessage = false;
            }
            
            messageInput.value = '';
            autoResize(messageInput);
            
            vscode.postMessage({ type: 'sendMessage', message });
        }

        function handleKeyDown(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        }

        function autoResize(textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
        }

        function clearChat() {
            vscode.postMessage({ type: 'clearChat' });
        }

        function addMessage(content, type) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + type;
            messageDiv.innerHTML = formatMessage(content);
            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            
            // Add code action buttons
            messageDiv.querySelectorAll('pre code').forEach(codeBlock => {
                const wrapper = document.createElement('div');
                wrapper.className = 'code-block';
                codeBlock.parentNode.parentNode.insertBefore(wrapper, codeBlock.parentNode);
                wrapper.appendChild(codeBlock.parentNode);
                
                const actions = document.createElement('div');
                actions.className = 'code-actions';
                actions.innerHTML = \`
                    <button class="code-action-btn" onclick="copyCode(this)">Copy</button>
                    <button class="code-action-btn" onclick="insertCode(this)">Insert</button>
                \`;
                wrapper.appendChild(actions);
            });
        }

        function formatMessage(content) {
            // Simple markdown-like formatting
            return content
                .replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
                .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\\n/g, '<br>');
        }

        function copyCode(btn) {
            const code = btn.closest('.code-block').querySelector('code').textContent;
            vscode.postMessage({ type: 'copyCode', code });
        }

        function insertCode(btn) {
            const code = btn.closest('.code-block').querySelector('code').textContent;
            vscode.postMessage({ type: 'insertCode', code });
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'userMessage':
                    addMessage(message.message, 'user');
                    break;
                    
                case 'assistantMessage':
                    addMessage(message.message, 'assistant');
                    break;
                    
                case 'streamChunk':
                    if (!currentStreamMessage) {
                        currentStreamMessage = document.createElement('div');
                        currentStreamMessage.className = 'message assistant';
                        chatContainer.appendChild(currentStreamMessage);
                    }
                    currentStreamMessage.innerHTML = formatMessage(
                        currentStreamMessage.textContent + message.chunk
                    );
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    break;
                    
                case 'streamEnd':
                    currentStreamMessage = null;
                    break;
                    
                case 'typing':
                    typingIndicator.classList.toggle('visible', message.isTyping);
                    sendBtn.disabled = message.isTyping;
                    break;
                    
                case 'error':
                    addMessage('Error: ' + message.message, 'error');
                    break;
                    
                case 'clearChat':
                    chatContainer.innerHTML = \`
                        <div class="welcome-message">
                            <h2>👋 Hello, I'm Clarke Kent!</h2>
                            <p>Your Superman-powered AI assistant. Ask me anything about code!</p>
                        </div>
                    \`;
                    isFirstMessage = true;
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
