import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PreviewPanel {
    private static currentPanel: PreviewPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public static show(extensionUri: vscode.Uri, document: vscode.TextDocument): void {
        const column = vscode.ViewColumn.Beside;

        if (PreviewPanel.currentPanel) {
            PreviewPanel.currentPanel.panel.reveal(column);
            PreviewPanel.currentPanel.update(document);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'clarkeKentPreview',
            'Preview: ' + path.basename(document.fileName),
            column,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.dirname(document.fileName)),
                    extensionUri
                ]
            }
        );

        PreviewPanel.currentPanel = new PreviewPanel(panel, extensionUri);
        PreviewPanel.currentPanel.update(document);
    }

    private update(document: vscode.TextDocument): void {
        const fileName = document.fileName;
        const ext = path.extname(fileName).toLowerCase();
        const content = document.getText();

        this.panel.title = 'Preview: ' + path.basename(fileName);

        switch (ext) {
            case '.html':
            case '.htm':
                this.showHtmlPreview(content, document);
                break;
            case '.md':
            case '.markdown':
                this.showMarkdownPreview(content);
                break;
            case '.svg':
                this.showSvgPreview(content);
                break;
            case '.json':
                this.showJsonPreview(content);
                break;
            case '.css':
                this.showCssPreview(content);
                break;
            default:
                this.showCodePreview(content, ext);
        }
    }

    private showHtmlPreview(content: string, document: vscode.TextDocument): void {
        // Convert local file references to webview URIs
        const baseUri = this.panel.webview.asWebviewUri(
            vscode.Uri.file(path.dirname(document.fileName))
        );

        // Inject base tag for relative paths
        const htmlWithBase = content.replace(
            /<head>/i,
            `<head><base href="${baseUri}/">`
        );

        this.panel.webview.html = htmlWithBase;
    }

    private showMarkdownPreview(content: string): void {
        // Simple markdown to HTML conversion
        const html = this.markdownToHtml(content);
        this.panel.webview.html = this.wrapInHtml(html, 'Markdown Preview');
    }

    private showSvgPreview(content: string): void {
        this.panel.webview.html = this.wrapInHtml(
            `<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#1e1e1e;">${content}</div>`,
            'SVG Preview'
        );
    }

    private showJsonPreview(content: string): void {
        try {
            const formatted = JSON.stringify(JSON.parse(content), null, 2);
            this.panel.webview.html = this.wrapInHtml(
                `<pre style="color:#d4d4d4;background:#1e1e1e;padding:20px;margin:0;font-family:Consolas,monospace;">${this.escapeHtml(formatted)}</pre>`,
                'JSON Preview'
            );
        } catch {
            this.panel.webview.html = this.wrapInHtml(
                `<pre style="color:#f48771;background:#1e1e1e;padding:20px;">Invalid JSON</pre>`,
                'JSON Preview'
            );
        }
    }

    private showCssPreview(content: string): void {
        const html = `
            <div style="display:grid;grid-template-columns:1fr 1fr;height:100vh;">
                <div style="padding:20px;background:#1e1e1e;overflow:auto;">
                    <h3 style="color:#569cd6;">CSS Code</h3>
                    <pre style="color:#d4d4d4;font-family:Consolas,monospace;">${this.escapeHtml(content)}</pre>
                </div>
                <div style="padding:20px;background:#fff;">
                    <style>${content}</style>
                    <h3>Preview Area</h3>
                    <div class="preview-box">
                        <p>This is a paragraph.</p>
                        <button>Button</button>
                        <a href="#">Link</a>
                        <div class="box">Box Element</div>
                    </div>
                </div>
            </div>
        `;
        this.panel.webview.html = this.wrapInHtml(html, 'CSS Preview');
    }

    private showCodePreview(content: string, ext: string): void {
        this.panel.webview.html = this.wrapInHtml(
            `<pre style="color:#d4d4d4;background:#1e1e1e;padding:20px;margin:0;font-family:Consolas,monospace;white-space:pre-wrap;">${this.escapeHtml(content)}</pre>`,
            `${ext.slice(1).toUpperCase()} Preview`
        );
    }

    private markdownToHtml(md: string): string {
        return md
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*)\*/gim, '<em>$1</em>')
            .replace(/!\[(.*?)\]\((.*?)\)/gim, '<img alt="$1" src="$2" />')
            .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2">$1</a>')
            .replace(/`([^`]+)`/gim, '<code>$1</code>')
            .replace(/```(\w*)\n([\s\S]*?)```/gim, '<pre><code class="language-$1">$2</code></pre>')
            .replace(/\n/gim, '<br>');
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private wrapInHtml(body: string, title: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        h1, h2, h3 { color: #569cd6; }
        code { background: #2d2d2d; padding: 2px 6px; border-radius: 3px; }
        pre { background: #1e1e1e; padding: 16px; border-radius: 6px; overflow-x: auto; }
        a { color: #4fc1ff; }
    </style>
</head>
<body>
    ${body}
</body>
</html>`;
    }

    public dispose(): void {
        PreviewPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }
}
