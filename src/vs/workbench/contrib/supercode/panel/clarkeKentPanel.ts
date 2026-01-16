/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Clarke Kent Panel - Enhanced UI for AI interactions
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewsRegistry, IViewDescriptor, Extensions as ViewExtensions, IViewContainersRegistry, ViewContainerLocation, ViewContainer, IViewsService } from '../../../common/views.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

// ============================================================================
// ICONS
// ============================================================================

const clarkeKentIcon = registerIcon('clarke-kent-panel', Codicon.sparkle, localize('clarkeKentIcon', 'Clarke Kent panel icon'));

// ============================================================================
// VIEW CONTAINER
// ============================================================================

const CLARKE_KENT_VIEW_CONTAINER_ID = 'workbench.view.clarkeKent';

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);

const clarkeKentViewContainer = viewContainersRegistry.registerViewContainer({
    id: CLARKE_KENT_VIEW_CONTAINER_ID,
    title: { value: localize('clarkeKent', 'Clarke Kent'), original: 'Clarke Kent' },
    icon: clarkeKentIcon,
    order: 10,
    ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [CLARKE_KENT_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
    storageId: 'clarkeKent.viewContainer',
    hideIfEmpty: false,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: false, isDefault: false });

// ============================================================================
// PANEL STATE TYPES
// ============================================================================

export interface ClarkeKentPanelState {
    isLoading: boolean;
    loadingMessage: string;
    currentAction: 'idle' | 'executing' | 'awaiting-approval' | 'preview';
    previewContent: string | null;
    previewType: 'code' | 'diff' | 'terminal' | null;
    pendingCommands: PendingCommand[];
    executionHistory: ExecutionHistoryItem[];
}

export interface PendingCommand {
    id: string;
    command: string;
    riskLevel: 'low' | 'medium' | 'high';
    status: 'pending' | 'approved' | 'rejected' | 'executed';
}

export interface ExecutionHistoryItem {
    id: string;
    type: 'command' | 'file';
    content: string;
    status: 'success' | 'error';
    timestamp: Date;
    output?: string;
}

// ============================================================================
// CLARKE KENT PANEL SERVICE
// ============================================================================

export class ClarkeKentPanelService extends Disposable {
    private readonly _onStateChange = this._register(new Emitter<ClarkeKentPanelState>());
    readonly onStateChange: Event<ClarkeKentPanelState> = this._onStateChange.event;

    private _state: ClarkeKentPanelState = {
        isLoading: false,
        loadingMessage: '',
        currentAction: 'idle',
        previewContent: null,
        previewType: null,
        pendingCommands: [],
        executionHistory: []
    };

    get state(): ClarkeKentPanelState {
        return { ...this._state };
    }

    showLoader(message: string): void {
        this._state = {
            ...this._state,
            isLoading: true,
            loadingMessage: message,
            currentAction: 'executing'
        };
        this._onStateChange.fire(this._state);
    }

    hideLoader(): void {
        this._state = {
            ...this._state,
            isLoading: false,
            loadingMessage: '',
            currentAction: 'idle'
        };
        this._onStateChange.fire(this._state);
    }

    showPreview(content: string, type: 'code' | 'diff' | 'terminal'): void {
        this._state = {
            ...this._state,
            currentAction: 'preview',
            previewContent: content,
            previewType: type
        };
        this._onStateChange.fire(this._state);
    }

    clearPreview(): void {
        this._state = {
            ...this._state,
            previewContent: null,
            previewType: null,
            currentAction: 'idle'
        };
        this._onStateChange.fire(this._state);
    }

    addPendingCommand(command: string, riskLevel: 'low' | 'medium' | 'high'): string {
        const id = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this._state = {
            ...this._state,
            currentAction: 'awaiting-approval',
            pendingCommands: [
                ...this._state.pendingCommands,
                { id, command, riskLevel, status: 'pending' }
            ]
        };
        this._onStateChange.fire(this._state);
        return id;
    }

    updateCommandStatus(id: string, status: 'approved' | 'rejected' | 'executed'): void {
        this._state = {
            ...this._state,
            pendingCommands: this._state.pendingCommands.map(cmd =>
                cmd.id === id ? { ...cmd, status } : cmd
            )
        };
        this._onStateChange.fire(this._state);
    }

    addToHistory(item: Omit<ExecutionHistoryItem, 'id' | 'timestamp'>): void {
        const historyItem: ExecutionHistoryItem = {
            ...item,
            id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date()
        };
        this._state = {
            ...this._state,
            executionHistory: [historyItem, ...this._state.executionHistory].slice(0, 50) // Keep last 50
        };
        this._onStateChange.fire(this._state);
    }

    clearHistory(): void {
        this._state = {
            ...this._state,
            executionHistory: []
        };
        this._onStateChange.fire(this._state);
    }
}

// Singleton instance
let globalPanelService: ClarkeKentPanelService | undefined;

export function getClarkeKentPanelService(): ClarkeKentPanelService {
    if (!globalPanelService) {
        globalPanelService = new ClarkeKentPanelService();
    }
    return globalPanelService;
}

// ============================================================================
// CLARKE KENT VIEW PANE
// ============================================================================

class ClarkeKentViewPane extends ViewPane {
    static readonly ID = 'workbench.view.clarkeKent.panel';

    private _container: HTMLElement | undefined;
    private _disposables = this._register(new DisposableStore());
    private _panelService: ClarkeKentPanelService;

    constructor(
        options: IViewPaneOptions,
        @IKeybindingService keybindingService: IKeybindingService,
        @IContextMenuService contextMenuService: IContextMenuService,
        @IConfigurationService configurationService: IConfigurationService,
        @IContextKeyService contextKeyService: IContextKeyService,
        @IViewsService viewsService: IViewsService,
        @IInstantiationService instantiationService: IInstantiationService,
        @IOpenerService openerService: IOpenerService,
        @IThemeService themeService: IThemeService,
        @ITelemetryService telemetryService: ITelemetryService,
        @IHoverService hoverService: IHoverService,
        @ILogService private readonly logService: ILogService
    ) {
        super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewsService, instantiationService, openerService, themeService, telemetryService, hoverService);
        
        this._panelService = getClarkeKentPanelService();
        
        // Listen to state changes
        this._disposables.add(this._panelService.onStateChange(state => {
            this.updateUI(state);
        }));
    }

    protected override renderBody(container: HTMLElement): void {
        super.renderBody(container);
        this._container = container;
        container.classList.add('clarke-kent-panel');
        
        // Initial render
        this.renderContent(this._panelService.state);
    }

    protected override layoutBody(height: number, width: number): void {
        super.layoutBody(height, width);
        // Adjust layout if needed
    }

    private updateUI(state: ClarkeKentPanelState): void {
        if (this._container) {
            this.renderContent(state);
        }
    }

    private renderContent(state: ClarkeKentPanelState): void {
        if (!this._container) return;

        // Clear existing content
        this._container.innerHTML = '';

        // Create main wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'clarke-kent-wrapper';
        wrapper.style.cssText = 'padding: 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground);';

        // Header
        const header = document.createElement('div');
        header.className = 'clarke-kent-header';
        header.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 16px;';
        header.innerHTML = `
            <span class="codicon codicon-sparkle" style="font-size: 20px; color: var(--vscode-textLink-foreground);"></span>
            <span style="font-size: 16px; font-weight: 600;">Clarke Kent</span>
            <span style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-left: auto;">AI Agent</span>
        `;
        wrapper.appendChild(header);

        // Loader
        if (state.isLoading) {
            const loader = this.createLoader(state.loadingMessage);
            wrapper.appendChild(loader);
        }

        // Preview
        if (state.previewContent && state.previewType) {
            const preview = this.createPreview(state.previewContent, state.previewType);
            wrapper.appendChild(preview);
        }

        // Pending Commands
        if (state.pendingCommands.filter(c => c.status === 'pending').length > 0) {
            const commandsSection = this.createPendingCommandsSection(state.pendingCommands);
            wrapper.appendChild(commandsSection);
        }

        // Execution History
        if (state.executionHistory.length > 0) {
            const historySection = this.createHistorySection(state.executionHistory);
            wrapper.appendChild(historySection);
        }

        // Idle state message
        if (!state.isLoading && !state.previewContent && state.pendingCommands.length === 0 && state.executionHistory.length === 0) {
            const idleMessage = document.createElement('div');
            idleMessage.style.cssText = 'text-align: center; padding: 40px 20px; color: var(--vscode-descriptionForeground);';
            idleMessage.innerHTML = `
                <div class="codicon codicon-sparkle" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></div>
                <div style="font-size: 14px;">Ready to assist</div>
                <div style="font-size: 12px; margin-top: 8px;">Ask Clarke Kent to write code or run commands</div>
            `;
            wrapper.appendChild(idleMessage);
        }

        this._container.appendChild(wrapper);
    }

    private createLoader(message: string): HTMLElement {
        const loader = document.createElement('div');
        loader.className = 'clarke-kent-loader';
        loader.style.cssText = `
            display: flex; 
            align-items: center; 
            gap: 12px; 
            padding: 16px; 
            background: var(--vscode-editor-background); 
            border: 1px solid var(--vscode-widget-border); 
            border-radius: 8px;
            margin-bottom: 16px;
        `;
        loader.innerHTML = `
            <div class="spinner" style="
                width: 20px; 
                height: 20px; 
                border: 2px solid var(--vscode-progressBar-background); 
                border-top-color: var(--vscode-textLink-foreground); 
                border-radius: 50%; 
                animation: spin 1s linear infinite;
            "></div>
            <span style="color: var(--vscode-foreground);">${this.escapeHtml(message)}</span>
        `;

        // Add keyframes for spinner
        if (!document.getElementById('clarke-kent-styles')) {
            const style = document.createElement('style');
            style.id = 'clarke-kent-styles';
            style.textContent = `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        return loader;
    }

    private createPreview(content: string, type: 'code' | 'diff' | 'terminal'): HTMLElement {
        const preview = document.createElement('div');
        preview.className = 'clarke-kent-preview';
        preview.style.cssText = `
            margin-bottom: 16px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            overflow: hidden;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 8px 12px;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-widget-border);
            font-size: 12px;
            font-weight: 600;
        `;
        header.textContent = type === 'code' ? '📄 Code Preview' : type === 'diff' ? '📝 Diff Preview' : '💻 Terminal Output';
        preview.appendChild(header);

        const body = document.createElement('pre');
        body.style.cssText = `
            margin: 0;
            padding: 12px;
            background: ${type === 'terminal' ? 'var(--vscode-terminal-background, #1e1e1e)' : 'var(--vscode-editor-background)'};
            color: ${type === 'terminal' ? 'var(--vscode-terminal-foreground, #d4d4d4)' : 'var(--vscode-editor-foreground)'};
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            overflow-x: auto;
            max-height: 300px;
            overflow-y: auto;
        `;
        body.textContent = content;
        preview.appendChild(body);

        // Action buttons
        const actions = document.createElement('div');
        actions.style.cssText = `
            display: flex;
            gap: 8px;
            padding: 8px 12px;
            background: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-widget-border);
        `;

        const applyBtn = document.createElement('button');
        applyBtn.textContent = '✅ Apply';
        applyBtn.style.cssText = this.getButtonStyle('primary');
        applyBtn.onclick = () => this._panelService.clearPreview();
        actions.appendChild(applyBtn);

        const discardBtn = document.createElement('button');
        discardBtn.textContent = '❌ Discard';
        discardBtn.style.cssText = this.getButtonStyle('secondary');
        discardBtn.onclick = () => this._panelService.clearPreview();
        actions.appendChild(discardBtn);

        preview.appendChild(actions);

        return preview;
    }

    private createPendingCommandsSection(commands: PendingCommand[]): HTMLElement {
        const section = document.createElement('div');
        section.className = 'clarke-kent-pending-commands';
        section.style.cssText = 'margin-bottom: 16px;';

        const title = document.createElement('div');
        title.style.cssText = 'font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--vscode-foreground);';
        title.textContent = '⏳ Pending Commands';
        section.appendChild(title);

        commands.filter(c => c.status === 'pending').forEach(cmd => {
            const cmdEl = document.createElement('div');
            cmdEl.style.cssText = `
                padding: 12px;
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-widget-border);
                border-radius: 6px;
                margin-bottom: 8px;
            `;

            const riskBadge = cmd.riskLevel === 'high' ? '⚠️ HIGH RISK' : cmd.riskLevel === 'medium' ? '🔶 Medium' : '✅ Low';
            const riskColor = cmd.riskLevel === 'high' ? 'var(--vscode-errorForeground)' : cmd.riskLevel === 'medium' ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-testing-iconPassed)';

            cmdEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-size: 11px; color: ${riskColor}; font-weight: 600;">${riskBadge}</span>
                </div>
                <code style="font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 4px 8px; border-radius: 4px; display: block; margin-bottom: 8px;">${this.escapeHtml(cmd.command)}</code>
                <div style="display: flex; gap: 8px;">
                    <button style="${this.getButtonStyle('primary')}" onclick="window.clarkeKentApproveCommand('${cmd.id}')">Run</button>
                    <button style="${this.getButtonStyle('secondary')}" onclick="window.clarkeKentRejectCommand('${cmd.id}')">Skip</button>
                </div>
            `;

            section.appendChild(cmdEl);
        });

        return section;
    }

    private createHistorySection(history: ExecutionHistoryItem[]): HTMLElement {
        const section = document.createElement('div');
        section.className = 'clarke-kent-history';

        const title = document.createElement('div');
        title.style.cssText = 'font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--vscode-foreground); display: flex; justify-content: space-between; align-items: center;';
        title.innerHTML = `
            <span>📋 Recent Activity</span>
            <button style="background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px;" onclick="window.clarkeKentClearHistory()">Clear</button>
        `;
        section.appendChild(title);

        history.slice(0, 5).forEach(item => {
            const histEl = document.createElement('div');
            histEl.style.cssText = `
                padding: 8px 12px;
                background: var(--vscode-editor-background);
                border-left: 3px solid ${item.status === 'success' ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-errorForeground)'};
                margin-bottom: 4px;
                font-size: 12px;
            `;

            const icon = item.type === 'command' ? '💻' : '📄';
            const statusIcon = item.status === 'success' ? '✓' : '✗';

            histEl.innerHTML = `
                <div style="display: flex; justify-content: space-between;">
                    <span>${icon} ${this.escapeHtml(item.content.substring(0, 40))}${item.content.length > 40 ? '...' : ''}</span>
                    <span style="color: ${item.status === 'success' ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-errorForeground)'};">${statusIcon}</span>
                </div>
            `;

            section.appendChild(histEl);
        });

        return section;
    }

    private getButtonStyle(type: 'primary' | 'secondary'): string {
        if (type === 'primary') {
            return `
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            `;
        }
        return `
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ============================================================================
// VIEW REGISTRATION
// ============================================================================

const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

const clarkeKentViewDescriptor: IViewDescriptor = {
    id: ClarkeKentViewPane.ID,
    name: { value: localize('clarkeKentPanel', 'Clarke Kent Panel'), original: 'Clarke Kent Panel' },
    ctorDescriptor: new SyncDescriptor(ClarkeKentViewPane),
    containerIcon: clarkeKentIcon,
    canToggleVisibility: true,
    canMoveView: true,
    order: 0,
    when: undefined
};

viewsRegistry.registerViews([clarkeKentViewDescriptor], clarkeKentViewContainer);

// ============================================================================
// WORKBENCH CONTRIBUTION
// ============================================================================

class ClarkeKentPanelContribution extends Disposable implements IWorkbenchContribution {
    static readonly ID = 'workbench.contrib.clarkeKentPanel';

    constructor(
        @ILogService private readonly logService: ILogService
    ) {
        super();
        this.logService.info('[Clarke Kent Panel] Initialized');

        // Setup global functions for button handlers
        (window as any).clarkeKentApproveCommand = (id: string) => {
            getClarkeKentPanelService().updateCommandStatus(id, 'approved');
        };
        (window as any).clarkeKentRejectCommand = (id: string) => {
            getClarkeKentPanelService().updateCommandStatus(id, 'rejected');
        };
        (window as any).clarkeKentClearHistory = () => {
            getClarkeKentPanelService().clearHistory();
        };
    }
}

registerWorkbenchContribution2(ClarkeKentPanelContribution.ID, ClarkeKentPanelContribution, WorkbenchPhase.AfterRestored);
