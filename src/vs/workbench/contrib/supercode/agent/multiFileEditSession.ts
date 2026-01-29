/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Multi-File Edit Session - Manages edits across multiple files
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { AgenticAction } from './agenticResponseParser.js';
import { DiffApplyService } from './diffApplyService.js';
import { Emitter, Event } from '../../../../base/common/event.js';

// ============================================================================
// TYPES
// ============================================================================

export interface PendingEdit {
    action: AgenticAction;
    uri: URI;
    status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
    error?: string;
    preview?: string;
}

export interface EditSessionState {
    id: string;
    edits: PendingEdit[];
    status: 'collecting' | 'reviewing' | 'applying' | 'completed' | 'cancelled';
    createdAt: number;
    completedAt?: number;
}

export interface EditSessionResult {
    success: boolean;
    appliedCount: number;
    failedCount: number;
    errors: string[];
}

// ============================================================================
// MULTI-FILE EDIT SESSION
// ============================================================================

export class MultiFileEditSession {
    private _state: EditSessionState;

    private readonly _onDidChange = new Emitter<EditSessionState>();
    readonly onDidChange: Event<EditSessionState> = this._onDidChange.event;

    private readonly _onDidComplete = new Emitter<EditSessionResult>();
    readonly onDidComplete: Event<EditSessionResult> = this._onDidComplete.event;

    constructor(
        private readonly logService: ILogService,
        private readonly fileService: IFileService,
        private readonly editorService: IEditorService,
        private readonly diffApplyService: DiffApplyService,
        private readonly workspaceRoot: URI
    ) {
        this._state = {
            id: 'session_' + Math.random().toString(36).substring(2, 9),
            edits: [],
            status: 'collecting',
            createdAt: Date.now()
        };
    }

    public get state(): EditSessionState {
        return this._state;
    }

    public get pendingEdits(): PendingEdit[] {
        return this._state.edits.filter(e => e.status === 'pending');
    }

    /**
     * Add an action to the session
     */
    public addAction(action: AgenticAction): void {
        if (!action.filePath) {
            this.logService.warn('[MultiFileEdit] Action has no file path, skipping');
            return;
        }

        const uri = this.resolveUri(action.filePath);

        this._state.edits.push({
            action,
            uri,
            status: 'pending'
        });

        this.logService.info(`[MultiFileEdit] Added ${action.type} for ${action.filePath}`);
        this._onDidChange.fire(this._state);
    }

    /**
     * Add multiple actions
     */
    public addActions(actions: AgenticAction[]): void {
        for (const action of actions) {
            if (action.filePath || action.type === 'run_command') {
                this.addAction(action);
            }
        }
    }

    /**
     * Generate preview content for an edit
     */
    public async generatePreview(edit: PendingEdit): Promise<string> {
        try {
            if (edit.action.type === 'write_file' || edit.action.type === 'create_file') {
                // Show new content
                return edit.action.content || '';
            }

            if (edit.action.type === 'edit_file' && edit.action.diff) {
                // Read current and generate unified diff preview
                try {
                    await this.fileService.readFile(edit.uri);

                    if (edit.action.diff.type === 'search_replace') {
                        // Show search/replace format
                        return [
                            `File: ${edit.action.filePath}`,
                            ``,
                            `--- SEARCH ---`,
                            edit.action.diff.search,
                            `--- REPLACE ---`,
                            edit.action.diff.replace
                        ].join('\n');
                    }

                    return `Diff to be applied to ${edit.action.filePath}:\n\n${edit.action.diff.patch || ''}`;
                } catch {
                    return `New file: ${edit.action.filePath}\n\n${edit.action.content || ''}`;
                }
            }

            if (edit.action.type === 'delete_file') {
                return `DELETE: ${edit.action.filePath}`;
            }

            return '';
        } catch (error) {
            return `Error generating preview: ${error}`;
        }
    }

    /**
     * Approve specific edits by index
     */
    public approveEdits(indices: number[]): void {
        for (const index of indices) {
            if (index >= 0 && index < this._state.edits.length) {
                this._state.edits[index].status = 'approved';
            }
        }
        this._onDidChange.fire(this._state);
    }

    /**
     * Approve all pending edits
     */
    public approveAll(): void {
        for (const edit of this._state.edits) {
            if (edit.status === 'pending') {
                edit.status = 'approved';
            }
        }
        this._onDidChange.fire(this._state);
    }

    /**
     * Reject specific edits
     */
    public rejectEdits(indices: number[]): void {
        for (const index of indices) {
            if (index >= 0 && index < this._state.edits.length) {
                this._state.edits[index].status = 'rejected';
            }
        }
        this._onDidChange.fire(this._state);
    }

    /**
     * Reject all pending edits
     */
    public rejectAll(): void {
        for (const edit of this._state.edits) {
            if (edit.status === 'pending') {
                edit.status = 'rejected';
            }
        }
        this._state.status = 'cancelled';
        this._onDidChange.fire(this._state);
    }

    /**
     * Apply all approved edits
     */
    public async applyApproved(): Promise<EditSessionResult> {
        this._state.status = 'applying';
        this._onDidChange.fire(this._state);

        const approvedEdits = this._state.edits.filter(e => e.status === 'approved');
        let appliedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        for (const edit of approvedEdits) {
            try {
                await this.applyEdit(edit);
                edit.status = 'applied';
                appliedCount++;
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                edit.status = 'failed';
                edit.error = errorMsg;
                errors.push(`${edit.action.filePath}: ${errorMsg}`);
                failedCount++;
            }
            this._onDidChange.fire(this._state);
        }

        this._state.status = 'completed';
        this._state.completedAt = Date.now();
        this._onDidChange.fire(this._state);

        const result: EditSessionResult = {
            success: failedCount === 0,
            appliedCount,
            failedCount,
            errors
        };

        this._onDidComplete.fire(result);
        this.logService.info(`[MultiFileEdit] Session complete: ${appliedCount} applied, ${failedCount} failed`);

        return result;
    }

    /**
     * Apply a single edit
     */
    private async applyEdit(edit: PendingEdit): Promise<void> {
        const { action, uri } = edit;

        switch (action.type) {
            case 'write_file':
            case 'create_file': {
                // Ensure parent directories exist
                const parentDir = URI.joinPath(uri, '..');
                try {
                    await this.fileService.createFolder(parentDir);
                } catch {
                    // Folder may already exist
                }

                // Write content
                await this.fileService.writeFile(uri, VSBuffer.fromString(action.content || ''));

                // Open in editor
                await this.editorService.openEditor({ resource: uri });

                this.logService.info(`[MultiFileEdit] Created/wrote file: ${uri.path}`);
                break;
            }

            case 'edit_file': {
                if (action.diff) {
                    const result = await this.diffApplyService.applyDiff(uri, action.diff);
                    if (!result.success) {
                        throw new Error(result.error || 'Diff apply failed');
                    }

                    // Open in editor
                    await this.editorService.openEditor({ resource: uri });
                } else if (action.content) {
                    // Full content replacement
                    await this.fileService.writeFile(uri, VSBuffer.fromString(action.content));
                    await this.editorService.openEditor({ resource: uri });
                }

                this.logService.info(`[MultiFileEdit] Edited file: ${uri.path}`);
                break;
            }

            case 'delete_file': {
                await this.fileService.del(uri);
                this.logService.info(`[MultiFileEdit] Deleted file: ${uri.path}`);
                break;
            }
        }
    }

    /**
     * Resolve a file path to a URI
     */
    private resolveUri(filePath: string): URI {
        // If it's already an absolute path
        if (filePath.startsWith('/') || filePath.match(/^[A-Z]:\\/i)) {
            return URI.file(filePath);
        }

        // Otherwise, resolve relative to workspace root
        return URI.joinPath(this.workspaceRoot, filePath);
    }

    /**
     * Get summary of the session
     */
    public getSummary(): string {
        const pending = this._state.edits.filter(e => e.status === 'pending').length;
        const approved = this._state.edits.filter(e => e.status === 'approved').length;
        const applied = this._state.edits.filter(e => e.status === 'applied').length;
        const failed = this._state.edits.filter(e => e.status === 'failed').length;

        const files = [...new Set(this._state.edits.map(e => e.action.filePath))];

        return [
            `Session ${this._state.id}`,
            `Files: ${files.length}`,
            `Edits: ${this._state.edits.length} (${pending} pending, ${approved} approved, ${applied} applied, ${failed} failed)`
        ].join('\n');
    }
}
