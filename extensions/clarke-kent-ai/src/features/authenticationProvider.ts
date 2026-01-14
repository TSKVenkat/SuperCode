import * as vscode from 'vscode';

export class OpenRouterAuthenticationProvider implements vscode.AuthenticationProvider {
    private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    get onDidChangeSessions() { return this._onDidChangeSessions.event; }

    private _session: vscode.AuthenticationSession | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async initialize(): Promise<void> {
        const apiKey = await this.context.secrets.get('clarkeKent.openRouterApiKey');
        if (apiKey) {
            this._session = {
                id: 'openrouter-session',
                accessToken: apiKey,
                account: {
                    label: 'OpenRouter User',
                    id: 'openrouter-user'
                },
                scopes: []
            };
        }
    }

    async getSessions(scopes?: string[]): Promise<vscode.AuthenticationSession[]> {
        return this._session ? [this._session] : [];
    }

    async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your OpenRouter API key',
            password: true,
            placeHolder: 'sk-or-...'
        });

        if (!apiKey) {
            throw new Error('API key is required');
        }

        await this.context.secrets.store('clarkeKent.openRouterApiKey', apiKey);

        this._session = {
            id: 'openrouter-session',
            accessToken: apiKey,
            account: {
                label: 'OpenRouter User',
                id: 'openrouter-user'
            },
            scopes: []
        };

        this._onDidChangeSessions.fire({ added: [this._session], removed: [], changed: [] });
        return this._session;
    }

    async removeSession(sessionId: string): Promise<void> {
        if (this._session && this._session.id === sessionId) {
            this._session = undefined;
            await this.context.secrets.delete('clarkeKent.openRouterApiKey');
            this._onDidChangeSessions.fire({ added: [], removed: [{ id: sessionId, accessToken: '', account: { label: '', id: '' }, scopes: [] }], changed: [] });
        }
    }
}
