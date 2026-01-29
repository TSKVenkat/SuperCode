/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Agentic Response Parser - Extracts actionable items from AI responses
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';

// ============================================================================
// TYPES
// ============================================================================

export type AgenticActionType = 'write_file' | 'edit_file' | 'run_command' | 'create_file' | 'delete_file';

export interface AgenticAction {
    type: AgenticActionType;
    /** File path (relative or absolute) */
    filePath?: string;
    /** Full file content for write_file */
    content?: string;
    /** Terminal command for run_command */
    command?: string;
    /** Explanation/description from AI */
    explanation?: string;
    /** Diff content for edit_file */
    diff?: DiffEdit;
    /** Language hint from code block */
    language?: string;
    /** Position in response for ordering */
    position: number;
}

export interface DiffEdit {
    type: 'unified' | 'search_replace' | 'line_range';
    /** For unified diff format */
    patch?: string;
    /** For search/replace */
    search?: string;
    replace?: string;
    /** For line range edits */
    startLine?: number;
    endLine?: number;
    newContent?: string;
}

export interface MultiFileEdit {
    files: AgenticAction[];
    description?: string;
}

export interface ParseResult {
    actions: AgenticAction[];
    hasFileEdits: boolean;
    hasTerminalCommands: boolean;
    hasMultiFileEdits: boolean;
}

// ============================================================================
// AGENTIC RESPONSE PARSER
// ============================================================================

export class AgenticResponseParser {

    constructor(
        @ILogService private readonly logService: ILogService
    ) { }

    /**
     * Parse an AI response and extract all actionable items
     */
    public parseResponse(response: string): ParseResult {
        const actions: AgenticAction[] = [];
        let position = 0;

        // Parse file code blocks with filename annotation
        // Format: ```language:filepath or ```filepath
        const fileCodeBlockRegex = /```(\w+)?(?::([^\n]+)|([^\n:]+\.[a-z]+))\n([\s\S]*?)```/gi;
        let match;

        while ((match = fileCodeBlockRegex.exec(response)) !== null) {
            const language = match[1] || this.inferLanguage(match[2] || match[3]);
            const filePath = (match[2] || match[3])?.trim();
            const content = match[4];

            if (filePath && content) {
                actions.push({
                    type: 'write_file',
                    filePath,
                    content: content.trimEnd(),
                    language,
                    position: position++
                });
            }
        }

        // Parse <file> XML-style blocks
        // Format: <file path="...">content</file>
        const xmlFileRegex = /<file\s+path=["']([^"']+)["'](?:\s+action=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/file>/gi;

        while ((match = xmlFileRegex.exec(response)) !== null) {
            const filePath = match[1];
            const action = match[2] || 'write';
            const content = match[3];

            if (action === 'delete') {
                actions.push({
                    type: 'delete_file',
                    filePath,
                    position: position++
                });
            } else {
                actions.push({
                    type: action === 'edit' ? 'edit_file' : 'write_file',
                    filePath,
                    content: content.trim(),
                    position: position++
                });
            }
        }

        // Parse <git-command> or <command> XML-style blocks
        // Format: <git-command>content</git-command>
        const commandRegex = /<(?:git-)?command>([\s\S]*?)<\/(?:git-)?command>/gi;

        while ((match = commandRegex.exec(response)) !== null) {
            const content = match[1].trim();
            if (content) {
                const commands = content.split('\n')
                    .map(c => c.trim())
                    .filter(c => c && !c.startsWith('#'));

                for (const command of commands) {
                    actions.push({
                        type: 'run_command',
                        command: command,
                        position: position++
                    });
                }
            }
        }

        // Parse terminal commands
        // Format: ```bash or ```shell or ```sh
        const terminalRegex = /```(?:bash|shell|sh|zsh|terminal)\n([\s\S]*?)```/gi;

        while ((match = terminalRegex.exec(response)) !== null) {
            const commands = match[1].trim().split('\n').filter(line =>
                line.trim() && !line.startsWith('#') && !line.startsWith('//')
            );

            for (const command of commands) {
                actions.push({
                    type: 'run_command',
                    command: command.trim(),
                    position: position++
                });
            }
        }

        // Parse diff blocks
        // Format: ```diff
        const diffRegex = /```diff\n([\s\S]*?)```/gi;

        while ((match = diffRegex.exec(response)) !== null) {
            const diffContent = match[1];
            const filePathFromDiff = this.extractFilePathFromDiff(diffContent);

            if (filePathFromDiff) {
                actions.push({
                    type: 'edit_file',
                    filePath: filePathFromDiff,
                    diff: {
                        type: 'unified',
                        patch: diffContent
                    },
                    position: position++
                });
            }
        }

        // Parse search/replace blocks
        // SEARCH/REPLACE format used by many AI tools
        const searchReplaceRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/gi;

        while ((match = searchReplaceRegex.exec(response)) !== null) {
            // Look for file path in nearby context
            const precedingText = response.substring(Math.max(0, match.index - 200), match.index);
            const filePathMatch = precedingText.match(/(?:file|in)\s*[:`]?\s*([^\s`:\n]+\.[a-z]+)/i);

            if (filePathMatch) {
                actions.push({
                    type: 'edit_file',
                    filePath: filePathMatch[1],
                    diff: {
                        type: 'search_replace',
                        search: match[1],
                        replace: match[2]
                    },
                    position: position++
                });
            }
        }

        // Deduplicate actions (same file + same type)
        const uniqueActions = this.deduplicateActions(actions);

        this.logService.info(`[AgenticParser] Parsed ${uniqueActions.length} actions from response`);

        return {
            actions: uniqueActions,
            hasFileEdits: uniqueActions.some(a => a.type === 'write_file' || a.type === 'edit_file' || a.type === 'create_file'),
            hasTerminalCommands: uniqueActions.some(a => a.type === 'run_command'),
            hasMultiFileEdits: new Set(uniqueActions.filter(a => a.filePath).map(a => a.filePath)).size > 1
        };
    }

    /**
     * Parse streaming response chunks, accumulating until complete
     */
    public createStreamParser(): StreamParser {
        return new StreamParser(this.logService);
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    private inferLanguage(filePath: string): string {
        if (!filePath) return 'text';

        const ext = filePath.substring(filePath.lastIndexOf('.') + 1).toLowerCase();
        const langMap: Record<string, string> = {
            'ts': 'typescript', 'tsx': 'typescript',
            'js': 'javascript', 'jsx': 'javascript',
            'py': 'python', 'rb': 'ruby',
            'go': 'go', 'rs': 'rust',
            'java': 'java', 'kt': 'kotlin',
            'cs': 'csharp', 'cpp': 'cpp', 'c': 'c',
            'html': 'html', 'css': 'css', 'scss': 'scss',
            'json': 'json', 'yaml': 'yaml', 'yml': 'yaml',
            'md': 'markdown', 'sql': 'sql',
            'sh': 'bash', 'bash': 'bash', 'zsh': 'bash'
        };
        return langMap[ext] || 'text';
    }

    private extractFilePathFromDiff(diff: string): string | undefined {
        // Try to extract from --- a/path or +++ b/path
        const match = diff.match(/(?:---|\+\+\+)\s+[ab]\/(.+)/);
        return match ? match[1] : undefined;
    }

    private deduplicateActions(actions: AgenticAction[]): AgenticAction[] {
        const seen = new Map<string, AgenticAction>();

        for (const action of actions) {
            const key = `${action.type}:${action.filePath || action.command || ''}`;

            // Keep the later action (more complete)
            if (!seen.has(key) || action.position > seen.get(key)!.position) {
                seen.set(key, action);
            }
        }

        return Array.from(seen.values()).sort((a, b) => a.position - b.position);
    }
}

// ============================================================================
// STREAM PARSER (for incremental parsing)
// ============================================================================

export class StreamParser {
    private buffer: string = '';
    private parsedActions: AgenticAction[] = [];
    private lastParsedIndex: number = 0;

    constructor(private readonly logService: ILogService) { }

    /**
     * Add a chunk to the buffer and try to parse complete blocks
     */
    public addChunk(chunk: string): AgenticAction[] {
        this.buffer += chunk;

        // Try to find complete code blocks
        const newActions: AgenticAction[] = [];

        // Look for completed code blocks after last parsed index
        const searchArea = this.buffer.substring(this.lastParsedIndex);
        const codeBlockEndRegex = /```\n/g;

        let match;
        while ((match = codeBlockEndRegex.exec(searchArea)) !== null) {
            // Find the start of this code block
            const endPos = this.lastParsedIndex + match.index + match[0].length;
            const blockContent = this.buffer.substring(this.lastParsedIndex, endPos);

            // Parse just this block
            const parser = new AgenticResponseParser(this.logService);
            const result = parser.parseResponse(blockContent);

            for (const action of result.actions) {
                // Avoid duplicates
                const isDuplicate = this.parsedActions.some(
                    a => a.type === action.type &&
                        a.filePath === action.filePath &&
                        a.command === action.command
                );

                if (!isDuplicate) {
                    action.position = this.parsedActions.length;
                    this.parsedActions.push(action);
                    newActions.push(action);
                }
            }

            this.lastParsedIndex = endPos;
        }

        return newActions;
    }

    /**
     * Get all parsed actions so far
     */
    public getActions(): AgenticAction[] {
        return this.parsedActions;
    }

    /**
     * Finalize parsing and return any remaining actions
     */
    public finalize(): AgenticAction[] {
        // Parse any remaining content
        if (this.lastParsedIndex < this.buffer.length) {
            const remaining = this.buffer.substring(this.lastParsedIndex);
            const parser = new AgenticResponseParser(this.logService);
            const result = parser.parseResponse(remaining);

            for (const action of result.actions) {
                const isDuplicate = this.parsedActions.some(
                    a => a.type === action.type &&
                        a.filePath === action.filePath &&
                        a.command === action.command
                );

                if (!isDuplicate) {
                    action.position = this.parsedActions.length;
                    this.parsedActions.push(action);
                }
            }
        }

        return this.parsedActions;
    }

    /**
     * Reset the parser state
     */
    public reset(): void {
        this.buffer = '';
        this.parsedActions = [];
        this.lastParsedIndex = 0;
    }
}
