/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Diff Apply Service - Applies diffs and edits to files
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { DiffEdit } from './agenticResponseParser.js';

// ============================================================================
// TYPES
// ============================================================================

export interface DiffApplyResult {
    success: boolean;
    originalContent?: string;
    newContent?: string;
    error?: string;
    linesChanged?: number;
}

export interface RollbackInfo {
    uri: URI;
    originalContent: string;
    timestamp: number;
}

// ============================================================================
// DIFF APPLY SERVICE
// ============================================================================

export class DiffApplyService {
    private _rollbackHistory: Map<string, RollbackInfo[]> = new Map();
    private readonly MAX_ROLLBACK_HISTORY = 20;

    constructor(
        @ILogService private readonly logService: ILogService,
        @IFileService private readonly fileService: IFileService
    ) { }

    /**
     * Apply a diff/edit to a file
     */
    public async applyDiff(uri: URI, diff: DiffEdit): Promise<DiffApplyResult> {
        try {
            // Read current file content
            let originalContent = '';
            try {
                const content = await this.fileService.readFile(uri);
                originalContent = content.value.toString();
            } catch {
                // File doesn't exist, will be created
            }

            // Store for rollback
            this.storeRollback(uri, originalContent);

            let newContent: string;
            let linesChanged = 0;

            switch (diff.type) {
                case 'unified':
                    const unifiedResult = this.applyUnifiedDiff(originalContent, diff.patch || '');
                    newContent = unifiedResult.content;
                    linesChanged = unifiedResult.linesChanged;
                    break;

                case 'search_replace':
                    const srResult = this.applySearchReplace(originalContent, diff.search || '', diff.replace || '');
                    newContent = srResult.content;
                    linesChanged = srResult.linesChanged;
                    break;

                case 'line_range':
                    const lrResult = this.applyLineRange(originalContent, diff.startLine || 0, diff.endLine || 0, diff.newContent || '');
                    newContent = lrResult.content;
                    linesChanged = lrResult.linesChanged;
                    break;

                default:
                    return { success: false, error: `Unknown diff type: ${diff.type}` };
            }

            // Write the new content
            await this.fileService.writeFile(uri, VSBuffer.fromString(newContent));

            this.logService.info(`[DiffApply] Applied ${diff.type} diff to ${uri.path}, ${linesChanged} lines changed`);

            return {
                success: true,
                originalContent,
                newContent,
                linesChanged
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logService.error(`[DiffApply] Failed to apply diff: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }
    }

    /**
     * Apply search/replace edit
     */
    private applySearchReplace(content: string, search: string, replace: string): { content: string; linesChanged: number } {
        if (!content.includes(search)) {
            // Try fuzzy matching (ignore leading/trailing whitespace per line)
            const searchLines = search.split('\n').map(l => l.trim());
            const contentLines = content.split('\n');

            let matchStart = -1;
            for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
                let matches = true;
                for (let j = 0; j < searchLines.length; j++) {
                    if (contentLines[i + j].trim() !== searchLines[j]) {
                        matches = false;
                        break;
                    }
                }
                if (matches) {
                    matchStart = i;
                    break;
                }
            }

            if (matchStart >= 0) {
                // Found fuzzy match, replace preserving original indentation
                const replaceLines = replace.split('\n');
                const originalIndent = contentLines[matchStart].match(/^(\s*)/)?.[1] || '';

                const newContentLines = [
                    ...contentLines.slice(0, matchStart),
                    ...replaceLines.map((line, idx) => {
                        if (idx === 0 || !line.trim()) return line;
                        return originalIndent + line.trimStart();
                    }),
                    ...contentLines.slice(matchStart + searchLines.length)
                ];

                return {
                    content: newContentLines.join('\n'),
                    linesChanged: replaceLines.length
                };
            }

            this.logService.warn('[DiffApply] Search pattern not found, returning original content');
            return { content, linesChanged: 0 };
        }

        const newContent = content.replace(search, replace);
        const linesChanged = replace.split('\n').length;

        return { content: newContent, linesChanged };
    }

    /**
     * Apply unified diff format
     */
    private applyUnifiedDiff(content: string, patch: string): { content: string; linesChanged: number } {
        const lines = content.split('\n');
        const patchLines = patch.split('\n');
        let linesChanged = 0;

        // Parse hunks from unified diff
        const hunks: Array<{ startLine: number; removeLines: string[]; addLines: string[] }> = [];
        let currentHunk: { startLine: number; removeLines: string[]; addLines: string[] } | null = null;

        for (const line of patchLines) {
            if (line.startsWith('@@')) {
                // Parse hunk header: @@ -start,count +start,count @@
                const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
                if (match) {
                    if (currentHunk) hunks.push(currentHunk);
                    currentHunk = {
                        startLine: parseInt(match[1], 10) - 1, // 0-indexed
                        removeLines: [],
                        addLines: []
                    };
                }
            } else if (currentHunk) {
                if (line.startsWith('-') && !line.startsWith('---')) {
                    currentHunk.removeLines.push(line.substring(1));
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentHunk.addLines.push(line.substring(1));
                    linesChanged++;
                }
                // Lines starting with ' ' are context, kept as-is
            }
        }
        if (currentHunk) hunks.push(currentHunk);

        // Apply hunks in reverse order to preserve line numbers
        hunks.sort((a, b) => b.startLine - a.startLine);

        for (const hunk of hunks) {
            lines.splice(hunk.startLine, hunk.removeLines.length, ...hunk.addLines);
        }

        return { content: lines.join('\n'), linesChanged };
    }

    /**
     * Apply line range replacement
     */
    private applyLineRange(content: string, startLine: number, endLine: number, newContent: string): { content: string; linesChanged: number } {
        const lines = content.split('\n');
        const newLines = newContent.split('\n');

        // Convert to 0-indexed
        const start = Math.max(0, startLine - 1);
        const end = Math.min(lines.length, endLine);

        lines.splice(start, end - start, ...newLines);

        return {
            content: lines.join('\n'),
            linesChanged: newLines.length
        };
    }

    /**
     * Rollback a file to its previous state
     */
    public async rollback(uri: URI): Promise<boolean> {
        const key = uri.toString();
        const history = this._rollbackHistory.get(key);

        if (!history || history.length === 0) {
            this.logService.warn(`[DiffApply] No rollback history for ${uri.path}`);
            return false;
        }

        const previous = history.pop()!;

        try {
            await this.fileService.writeFile(uri, VSBuffer.fromString(previous.originalContent));
            this.logService.info(`[DiffApply] Rolled back ${uri.path} to ${new Date(previous.timestamp).toISOString()}`);
            return true;
        } catch (error) {
            this.logService.error(`[DiffApply] Rollback failed: ${error}`);
            return false;
        }
    }

    /**
     * Get rollback history for a file
     */
    public getRollbackHistory(uri: URI): RollbackInfo[] {
        return this._rollbackHistory.get(uri.toString()) || [];
    }

    private storeRollback(uri: URI, content: string): void {
        const key = uri.toString();
        let history = this._rollbackHistory.get(key);

        if (!history) {
            history = [];
            this._rollbackHistory.set(key, history);
        }

        history.push({
            uri,
            originalContent: content,
            timestamp: Date.now()
        });

        // Limit history size
        while (history.length > this.MAX_ROLLBACK_HISTORY) {
            history.shift();
        }
    }
}
