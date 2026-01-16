/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Agentic Executor Service - Executes AI-parsed actions with user settings
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { AgenticAction, AgenticResponseParser } from './agenticResponseParser.js';
import { DiffApplyService } from './diffApplyService.js';
import { MultiFileEditSession, EditSessionResult } from './multiFileEditSession.js';
import { getAgenticSettings, AgenticSettings } from './agenticConfiguration.js';
import { getClarkeKentPanelService } from '../panel/clarkeKentPanel.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ExecutionProgress {
    currentAction: AgenticAction | null;
    completedCount: number;
    totalCount: number;
    status: 'idle' | 'parsing' | 'confirming' | 'executing' | 'completed' | 'error';
    error?: string;
}

export interface ExecutionResult {
    success: boolean;
    actionsExecuted: number;
    actionsFailed: number;
    filesModified: string[];
    commandsRun: string[];
    errors: string[];
}

// ============================================================================
// AGENTIC EXECUTOR SERVICE
// ============================================================================

export class AgenticExecutorService extends Disposable {
    private _settings: AgenticSettings;
    private _currentSession: MultiFileEditSession | null = null;
    private _parser: AgenticResponseParser;
    private _diffService: DiffApplyService;

    private readonly _onProgressChange = this._register(new Emitter<ExecutionProgress>());
    readonly onProgressChange: Event<ExecutionProgress> = this._onProgressChange.event;

    private readonly _onExecutionComplete = this._register(new Emitter<ExecutionResult>());
    readonly onExecutionComplete: Event<ExecutionResult> = this._onExecutionComplete.event;

    private _progress: ExecutionProgress = {
        currentAction: null,
        completedCount: 0,
        totalCount: 0,
        status: 'idle'
    };

    constructor(
        @ILogService private readonly logService: ILogService,
        @IFileService private readonly fileService: IFileService,
        @IConfigurationService configurationService: IConfigurationService,
        @IEditorService private readonly editorService: IEditorService,
        @ITerminalService private readonly terminalService: ITerminalService,
        @INotificationService private readonly notificationService: INotificationService,
        @IQuickInputService private readonly quickInputService: IQuickInputService
    ) {
        super();

        this._settings = getAgenticSettings(configurationService);
        this._parser = new AgenticResponseParser(logService);
        this._diffService = new DiffApplyService(logService, fileService);

        // Listen for settings changes
        this._register(configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('supercode.agentic')) {
                this._settings = getAgenticSettings(configurationService);
                this.logService.info('[AgenticExecutor] Settings updated');
            }
        }));
    }

    /**
     * Execute actions from AI response
     */
    public async executeFromResponse(response: string, workspaceRoot: URI): Promise<ExecutionResult> {
        this.updateProgress({ status: 'parsing', completedCount: 0, totalCount: 0 });

        // Parse the response
        const parseResult = this._parser.parseResponse(response);

        if (parseResult.actions.length === 0) {
            this.logService.info('[AgenticExecutor] No actions found in response');
            this.updateProgress({ status: 'completed' });
            return {
                success: true,
                actionsExecuted: 0,
                actionsFailed: 0,
                filesModified: [],
                commandsRun: [],
                errors: []
            };
        }

        this.logService.info(`[AgenticExecutor] Found ${parseResult.actions.length} actions to execute`);
        this.updateProgress({ totalCount: parseResult.actions.length, status: 'confirming' });

        // Split into file and terminal actions
        const fileActions = parseResult.actions.filter(a => a.type !== 'run_command');
        const terminalActions = parseResult.actions.filter(a => a.type === 'run_command');

        const result: ExecutionResult = {
            success: true,
            actionsExecuted: 0,
            actionsFailed: 0,
            filesModified: [],
            commandsRun: [],
            errors: []
        };

        // Handle file actions
        if (fileActions.length > 0) {
            const fileResult = await this.executeFileActions(fileActions, workspaceRoot);
            result.actionsExecuted += fileResult.appliedCount;
            result.actionsFailed += fileResult.failedCount;
            result.filesModified = fileActions.filter(a => a.filePath).map(a => a.filePath!);
            result.errors.push(...fileResult.errors);
            if (fileResult.failedCount > 0) result.success = false;
        }

        // Handle terminal actions
        if (terminalActions.length > 0) {
            const termResult = await this.executeTerminalActions(terminalActions);
            result.actionsExecuted += termResult.executed;
            result.actionsFailed += termResult.failed;
            result.commandsRun = termResult.commands;
            result.errors.push(...termResult.errors);
            if (termResult.failed > 0) result.success = false;
        }

        this.updateProgress({ status: 'completed' });
        this._onExecutionComplete.fire(result);

        return result;
    }

    /**
     * Execute file-related actions
     */
    private async executeFileActions(actions: AgenticAction[], workspaceRoot: URI): Promise<EditSessionResult> {
        // Create a multi-file edit session
        this._currentSession = new MultiFileEditSession(
            this.logService,
            this.fileService,
            this.editorService,
            this._diffService,
            workspaceRoot
        );

        this._currentSession.addActions(actions);

        // Determine if we need confirmation
        const needsConfirmation = this.needsFileConfirmation(actions);

        if (!needsConfirmation) {
            // Auto-approve all
            this._currentSession.approveAll();
        } else {
            // Show confirmation UI
            const approved = await this.showFileConfirmation(actions);
            if (!approved) {
                this._currentSession.rejectAll();
                return { success: false, appliedCount: 0, failedCount: 0, errors: ['User cancelled'] };
            }
            this._currentSession.approveAll();
        }

        this.updateProgress({ status: 'executing' });
        return this._currentSession.applyApproved();
    }

    /**
     * Check if confirmation is needed for file actions
     */
    private needsFileConfirmation(actions: AgenticAction[]): boolean {
        for (const action of actions) {
            if (action.type === 'write_file' && !this._settings.autoApproveFileWrites) {
                return true;
            }
            if (action.type === 'create_file' && !this._settings.autoApproveFileCreates) {
                return true;
            }
            if (action.type === 'delete_file' && !this._settings.autoApproveFileDeletes) {
                return true;
            }
            if (action.type === 'edit_file' && !this._settings.autoApproveFileWrites) {
                return true;
            }

            // Check protected paths
            if (action.filePath && this.isProtectedPath(action.filePath)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if a path is protected
     */
    private isProtectedPath(filePath: string): boolean {
        const normalizedPath = filePath.toLowerCase();
        return this._settings.protectedPaths.some(p =>
            normalizedPath.includes(p.toLowerCase())
        );
    }

    /**
     * Show file confirmation dialog
     */
    private async showFileConfirmation(actions: AgenticAction[]): Promise<boolean> {
        const fileCount = new Set(actions.filter(a => a.filePath).map(a => a.filePath)).size;

        const writeCount = actions.filter(a => a.type === 'write_file' || a.type === 'create_file').length;
        const editCount = actions.filter(a => a.type === 'edit_file').length;
        const deleteCount = actions.filter(a => a.type === 'delete_file').length;

        let message = `AI wants to modify ${fileCount} file(s):\n`;
        if (writeCount > 0) message += `• Create/Write: ${writeCount}\n`;
        if (editCount > 0) message += `• Edit: ${editCount}\n`;
        if (deleteCount > 0) message += `• Delete: ${deleteCount}\n`;
        message += '\nFiles:\n';

        const files = [...new Set(actions.map(a => a.filePath).filter(Boolean))];
        message += files.slice(0, 10).map(f => `  - ${f}`).join('\n');
        if (files.length > 10) {
            message += `\n  ... and ${files.length - 10} more`;
        }

        const result = await this.quickInputService.pick([
            { id: 'approve', label: '$(check) Apply All Changes', description: 'Allow AI to make these changes' },
            { id: 'review', label: '$(eye) Review Individual Files', description: 'Review each file before applying' },
            { id: 'reject', label: '$(close) Cancel', description: 'Reject all changes' }
        ], {
            title: '🤖 AI File Modifications',
            placeHolder: message.split('\n')[0]
        });

        if (!result || result.id === 'reject') {
            return false;
        }

        if (result.id === 'review') {
            // TODO: Implement individual file review UI
            this.notificationService.info('Individual review coming soon. Applying all for now.');
        }

        return true;
    }

    /**
     * Execute terminal commands with risk classification
     */
    private async executeTerminalActions(actions: AgenticAction[]): Promise<{ executed: number; failed: number; commands: string[]; errors: string[] }> {
        const result = { executed: 0, failed: 0, commands: [] as string[], errors: [] as string[] };

        for (const action of actions) {
            if (!action.command) continue;

            // Update panel UI
            const panelService = getClarkeKentPanelService();
            panelService.showLoader(`Executing: ${action.command.substring(0, 50)}...`);

            // Check blocklist
            if (this.isBlockedCommand(action.command)) {
                this.logService.warn(`[AgenticExecutor] Blocked dangerous command: ${action.command}`);
                this.notificationService.warn(`Blocked potentially dangerous command: ${action.command.substring(0, 50)}...`);
                result.failed++;
                result.errors.push(`Blocked command: ${action.command}`);
                continue;
            }

            // Classify command risk
            const riskLevel = this.classifyCommandRisk(action.command);
            this.logService.info(`[AgenticExecutor] Command risk: ${riskLevel} - ${action.command}`);

            // Determine execution based on risk and settings
            let shouldExecute = false;

            if (this._settings.terminalExecutionMode === 'never') {
                shouldExecute = false;
                this.notificationService.info(`Command not executed (mode=never): ${action.command}`);
            } else if (this._settings.terminalExecutionMode === 'always') {
                // Even in 'always' mode, high-risk commands require confirmation
                if (riskLevel === 'high') {
                    shouldExecute = await this.askTerminalConfirmation(action.command, riskLevel);
                } else {
                    shouldExecute = true;
                }
            } else {
                // 'ask' mode - behavior depends on risk level
                if (riskLevel === 'low') {
                    // Low risk: auto-execute
                    shouldExecute = true;
                    this.notificationService.info(`Executing: ${action.command.substring(0, 60)}...`);
                } else if (riskLevel === 'medium') {
                    // Medium risk: quick confirmation
                    shouldExecute = await this.askTerminalConfirmation(action.command, riskLevel);
                } else {
                    // High risk: explicit confirmation with warning
                    shouldExecute = await this.askTerminalConfirmation(action.command, riskLevel);
                }
            }

            if (shouldExecute) {
                try {
                    await this.runTerminalCommand(action.command);
                    result.executed++;
                    result.commands.push(action.command);
                    this.updateProgress({ completedCount: this._progress.completedCount + 1 });

                    // Update panel with success
                    panelService.addToHistory({ type: 'command', content: action.command, status: 'success' });
                } catch (error) {
                    result.failed++;
                    result.errors.push(`Command failed: ${action.command} - ${error}`);

                    // Update panel with error
                    panelService.addToHistory({ type: 'command', content: action.command, status: 'error', output: String(error) });
                }
            }

            panelService.hideLoader();
        }

        return result;
    }

    /**
     * Classify command risk level
     */
    private classifyCommandRisk(command: string): 'low' | 'medium' | 'high' {
        const cmd = command.toLowerCase().trim();

        // High risk: destructive operations
        const highRiskPatterns = [
            /^rm\s/, /rm\s+-rf/, /rm\s+-r/,
            /^git\s+push/, /^git\s+reset/, /^git\s+force/,
            /^git\s+rebase/, /^git\s+merge/,
            /^chmod\s/, /^chown\s/,
            /^sudo\s/, /^su\s/,
            /^mv\s+\//, /^cp\s+-rf?\s+\//,
            /drop\s+database/, /drop\s+table/,
            /truncate\s+table/
        ];

        for (const pattern of highRiskPatterns) {
            if (pattern.test(cmd)) {
                return 'high';
            }
        }

        // Low risk: read-only operations
        const lowRiskPatterns = [
            /^ls\b/, /^cat\b/, /^head\b/, /^tail\b/,
            /^git\s+status/, /^git\s+log/, /^git\s+diff/, /^git\s+branch/,
            /^npm\s+list/, /^npm\s+ls/, /^npm\s+view/,
            /^node\s+-v/, /^npm\s+-v/, /^yarn\s+-v/,
            /^pwd$/, /^whoami$/, /^echo\b/,
            /^which\b/, /^where\b/, /^type\b/,
            /--version$/, /-v$/
        ];

        for (const pattern of lowRiskPatterns) {
            if (pattern.test(cmd)) {
                return 'low';
            }
        }

        // Medium risk: everything else (installs, builds, tests, etc.)
        return 'medium';
    }

    /**
     * Check if command is in blocklist
     */
    private isBlockedCommand(command: string): boolean {
        const normalizedCommand = command.toLowerCase().trim();
        return this._settings.terminalCommandBlocklist.some(pattern =>
            normalizedCommand.includes(pattern.toLowerCase())
        );
    }

    /**
     * Ask for terminal command confirmation with risk level awareness
     */
    private async askTerminalConfirmation(command: string, riskLevel: 'low' | 'medium' | 'high' = 'medium'): Promise<boolean> {
        const riskEmoji = riskLevel === 'high' ? '⚠️' : riskLevel === 'medium' ? '🔶' : '✅';
        const riskLabel = riskLevel === 'high' ? 'HIGH RISK' : riskLevel === 'medium' ? 'Medium Risk' : 'Low Risk';

        const result = await this.quickInputService.pick([
            { id: 'run', label: '$(terminal) Run Command', description: command },
            { id: 'skip', label: '$(close) Skip', description: 'Do not run this command' }
        ], {
            title: `${riskEmoji} Clarke Kent: ${riskLabel} Command`,
            placeHolder: `Execute: ${command.substring(0, 80)}${command.length > 80 ? '...' : ''}`
        });

        return result?.id === 'run';
    }

    /**
     * Run a terminal command
     */
    private async runTerminalCommand(command: string): Promise<void> {
        // Create or reuse terminal
        const terminal = await this.terminalService.createTerminal({
            config: {
                name: 'Clarke Kent',
                hideFromUser: false
            }
        });

        // Show the terminal
        this.terminalService.setActiveInstance(terminal);
        await this.terminalService.revealActiveTerminal();

        // Send the command
        terminal.sendText(command, true);

        this.logService.info(`[AgenticExecutor] Executed command: ${command}`);
    }

    /**
     * Write a file directly (utility method)
     */
    public async writeFile(uri: URI, content: string): Promise<void> {
        // Ensure parent directory exists
        const parentDir = URI.joinPath(uri, '..');
        try {
            await this.fileService.createFolder(parentDir);
        } catch {
            // May already exist
        }

        await this.fileService.writeFile(uri, VSBuffer.fromString(content));

        if (this._settings.autoOpenEditedFiles) {
            await this.editorService.openEditor({ resource: uri });
        }

        this.logService.info(`[AgenticExecutor] Wrote file: ${uri.path}`);
    }

    /**
     * Read a file directly (utility method)
     */
    public async readFile(uri: URI): Promise<string> {
        const content = await this.fileService.readFile(uri);
        return content.value.toString();
    }

    /**
     * Rollback last edit to a file
     */
    public async rollback(uri: URI): Promise<boolean> {
        if (!this._settings.enableRollback) {
            this.notificationService.warn('Rollback is disabled in settings');
            return false;
        }
        return this._diffService.rollback(uri);
    }

    /**
     * Update and emit progress
     */
    private updateProgress(update: Partial<ExecutionProgress>): void {
        this._progress = { ...this._progress, ...update };
        this._onProgressChange.fire(this._progress);
    }

    /**
     * Get current settings
     */
    public getSettings(): AgenticSettings {
        return this._settings;
    }
}
