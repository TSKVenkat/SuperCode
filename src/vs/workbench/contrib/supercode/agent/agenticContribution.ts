import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { localize } from '../../../../nls.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';

import { AgenticExecutorService } from './agenticExecutorService.js';
import { registerAgenticConfiguration, getAgenticSettings } from './agenticConfiguration.js';

// ============================================================================
// GLOBAL EXECUTOR INSTANCE
// ============================================================================

let globalExecutor: AgenticExecutorService | undefined;

export function getAgenticExecutor(): AgenticExecutorService | undefined {
    return globalExecutor;
}

// ============================================================================
// AGENTIC CONTRIBUTION
// ============================================================================

class AgenticContribution extends Disposable implements IWorkbenchContribution {
    static readonly ID = 'workbench.contrib.supercodeAgentic';

    constructor(
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configurationService: IConfigurationService,
        @IInstantiationService private readonly instantiationService: IInstantiationService
    ) {
        super();

        // Register configuration settings
        registerAgenticConfiguration();

        // Create executor service
        globalExecutor = this._register(this.instantiationService.createInstance(AgenticExecutorService));

        this.logService.info('[SuperCode] Agentic capabilities initialized');

        // Log current settings
        const settings = getAgenticSettings(this.configurationService);
        this.logService.info(`[SuperCode] Agentic settings: terminal=${settings.terminalExecutionMode}, autoApproveWrites=${settings.autoApproveFileWrites}`);
    }
}

// ============================================================================
// COMMANDS
// ============================================================================

// Execute AI Response Action
class ExecuteAIResponseAction extends Action2 {
    static readonly ID = 'supercode.executeAIResponse';

    constructor() {
        super({
            id: ExecuteAIResponseAction.ID,
            title: { value: localize('supercode.executeAIResponse', 'SuperCode: Execute AI Response'), original: 'SuperCode: Execute AI Response' },
            category: Categories.Developer,
            f1: true,
            keybinding: {
                weight: KeybindingWeight.WorkbenchContrib,
                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyE
            }
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notificationService = accessor.get(INotificationService);
        const editorService = accessor.get(IEditorService);
        const workspaceContextService = accessor.get(IWorkspaceContextService);


        const executor = getAgenticExecutor();
        if (!executor) {
            notificationService.warn('Agentic executor not initialized');
            return;
        }

        const workspace = workspaceContextService.getWorkspace().folders[0];
        if (!workspace) {
            notificationService.warn('No workspace folder open');
            return;
        }

        // Try to get content from clipboard
        let content: string | undefined;
        try {
            const clipboardImport = await import('../../../../platform/clipboard/common/clipboardService.js');
            const clipboard = accessor.get(clipboardImport.IClipboardService);
            content = await clipboard.readText();
        } catch {
            // Fallback to current editor selection
            const editor = editorService.activeTextEditorControl;
            if (editor && 'getSelection' in editor && 'getModel' in editor) {
                const selection = (editor as any).getSelection();
                const model = (editor as any).getModel();
                if (selection && model) {
                    content = model.getValueInRange(selection);
                }
            }
        }

        if (!content) {
            notificationService.warn('No content to execute. Copy AI response to clipboard first.');
            return;
        }

        notificationService.info('Parsing and executing AI response...');

        try {
            const result = await executor.executeFromResponse(content, workspace.uri);

            if (result.success) {
                notificationService.notify({
                    severity: Severity.Info,
                    message: `✅ Executed: ${result.actionsExecuted} action(s), ${result.filesModified.length} file(s) modified`
                });
            } else {
                notificationService.notify({
                    severity: Severity.Warning,
                    message: `⚠️ Completed with errors: ${result.actionsExecuted} succeeded, ${result.actionsFailed} failed`
                });
            }
        } catch (error) {
            notificationService.error(`Failed to execute: ${error}`);
        }
    }
}

// Rollback Last AI Edit
class RollbackLastEditAction extends Action2 {
    static readonly ID = 'supercode.rollbackLastEdit';

    constructor() {
        super({
            id: RollbackLastEditAction.ID,
            title: { value: localize('supercode.rollbackLastEdit', 'SuperCode: Rollback Last AI Edit'), original: 'SuperCode: Rollback Last AI Edit' },
            category: Categories.Developer,
            f1: true,
            keybinding: {
                weight: KeybindingWeight.WorkbenchContrib,
                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyZ
            }
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notificationService = accessor.get(INotificationService);
        const editorService = accessor.get(IEditorService);

        const executor = getAgenticExecutor();
        if (!executor) {
            notificationService.warn('Agentic executor not initialized');
            return;
        }

        // Get current file
        const editor = editorService.activeEditor;
        if (!editor?.resource) {
            notificationService.warn('No active file to rollback');
            return;
        }

        const success = await executor.rollback(editor.resource);

        if (success) {
            notificationService.info('✅ Rolled back last AI edit');
        } else {
            notificationService.warn('No rollback history available for this file');
        }
    }
}

// Configure Agentic Settings
class ConfigureAgenticSettingsAction extends Action2 {
    static readonly ID = 'supercode.configureAgentic';

    constructor() {
        super({
            id: ConfigureAgenticSettingsAction.ID,
            title: { value: localize('supercode.configureAgentic', 'SuperCode: Configure AI Agent Settings'), original: 'SuperCode: Configure AI Agent Settings' },
            category: Categories.Developer,
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const quickInputService = accessor.get(IQuickInputService);
        const configurationService = accessor.get(IConfigurationService);
        const notificationService = accessor.get(INotificationService);

        const settings = getAgenticSettings(configurationService);

        const items = [
            {
                id: 'fileWrites',
                label: `$(file) Auto-approve file writes: ${settings.autoApproveFileWrites ? '✓ ON' : '✗ OFF'}`,
                description: 'Toggle automatic file write approval'
            },
            {
                id: 'terminal',
                label: `$(terminal) Terminal execution: ${settings.terminalExecutionMode.toUpperCase()}`,
                description: 'Change when commands are executed'
            },
            {
                id: 'diffPreview',
                label: `$(diff) Show diff preview: ${settings.showDiffPreview ? '✓ ON' : '✗ OFF'}`,
                description: 'Toggle diff preview before applying'
            },
            {
                id: 'rollback',
                label: `$(history) Enable rollback: ${settings.enableRollback ? '✓ ON' : '✗ OFF'}`,
                description: 'Toggle undo capability for AI changes'
            }
        ];

        const selected = await quickInputService.pick(items, {
            title: '🤖 AI Agent Settings',
            placeHolder: 'Select setting to toggle'
        });

        if (!selected) return;

        switch (selected.id) {
            case 'fileWrites':
                await configurationService.updateValue('supercode.agentic.autoApproveFileWrites', !settings.autoApproveFileWrites);
                notificationService.info(`File auto-approve: ${!settings.autoApproveFileWrites ? 'ON' : 'OFF'}`);
                break;
            case 'terminal':
                const modes = ['always', 'ask', 'never'];
                const currentIdx = modes.indexOf(settings.terminalExecutionMode);
                const newMode = modes[(currentIdx + 1) % modes.length];
                await configurationService.updateValue('supercode.agentic.terminalExecutionMode', newMode);
                notificationService.info(`Terminal execution mode: ${newMode.toUpperCase()}`);
                break;
            case 'diffPreview':
                await configurationService.updateValue('supercode.agentic.showDiffPreview', !settings.showDiffPreview);
                notificationService.info(`Diff preview: ${!settings.showDiffPreview ? 'ON' : 'OFF'}`);
                break;
            case 'rollback':
                await configurationService.updateValue('supercode.agentic.enableRollback', !settings.enableRollback);
                notificationService.info(`Rollback: ${!settings.enableRollback ? 'ON' : 'OFF'}`);
                break;
        }
    }
}



// ============================================================================
// REGISTRATION
// ============================================================================

registerWorkbenchContribution2(AgenticContribution.ID, AgenticContribution, WorkbenchPhase.AfterRestored);

registerAction2(ExecuteAIResponseAction);
registerAction2(RollbackLastEditAction);
registerAction2(ConfigureAgenticSettingsAction);
