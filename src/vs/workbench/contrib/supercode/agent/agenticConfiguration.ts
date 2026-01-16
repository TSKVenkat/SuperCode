/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Agentic Configuration - Settings for agentic behavior
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { localize } from '../../../../nls.js';

// ============================================================================
// SETTING IDS
// ============================================================================

export const SUPERCODE_AGENTIC_SETTINGS = {
    // File write settings
    AUTO_APPROVE_FILE_WRITES: 'supercode.agentic.autoApproveFileWrites',
    AUTO_APPROVE_FILE_CREATES: 'supercode.agentic.autoApproveFileCreates',
    AUTO_APPROVE_FILE_DELETES: 'supercode.agentic.autoApproveFileDeletes',

    // Terminal settings
    TERMINAL_EXECUTION_MODE: 'supercode.agentic.terminalExecutionMode',
    TERMINAL_COMMAND_BLOCKLIST: 'supercode.agentic.terminalCommandBlocklist',

    // Diff settings
    SHOW_DIFF_PREVIEW: 'supercode.agentic.showDiffPreview',
    AUTO_OPEN_EDITED_FILES: 'supercode.agentic.autoOpenEditedFiles',

    // Multi-file settings
    MULTI_FILE_CONFIRMATION: 'supercode.agentic.multiFileConfirmation',
    MAX_FILES_PER_SESSION: 'supercode.agentic.maxFilesPerSession',

    // Safety settings
    ENABLE_ROLLBACK: 'supercode.agentic.enableRollback',
    PROTECTED_PATHS: 'supercode.agentic.protectedPaths'
};

// ============================================================================
// TYPES
// ============================================================================

export type TerminalExecutionMode = 'always' | 'ask' | 'never';
export type MultiFileConfirmation = 'combined' | 'individual' | 'auto';

export interface AgenticSettings {
    autoApproveFileWrites: boolean;
    autoApproveFileCreates: boolean;
    autoApproveFileDeletes: boolean;
    terminalExecutionMode: TerminalExecutionMode;
    terminalCommandBlocklist: string[];
    showDiffPreview: boolean;
    autoOpenEditedFiles: boolean;
    multiFileConfirmation: MultiFileConfirmation;
    maxFilesPerSession: number;
    enableRollback: boolean;
    protectedPaths: string[];
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const DEFAULT_COMMAND_BLOCKLIST = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf *',
    'mkfs',
    'dd if=',
    ':(){:|:&};:',
    '> /dev/sda',
    'chmod -R 777 /',
    'sudo rm',
    'curl | sh',
    'curl | bash',
    'wget | sh',
    'wget | bash'
];

const DEFAULT_PROTECTED_PATHS = [
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/var',
    '/boot',
    '/root',
    '~/.ssh',
    '~/.gnupg',
    '.git/config',
    '.env',
    '.env.local',
    'secrets'
];

// ============================================================================
// SETTINGS READER
// ============================================================================

export function getAgenticSettings(configurationService: IConfigurationService): AgenticSettings {
    return {
        autoApproveFileWrites: configurationService.getValue<boolean>(SUPERCODE_AGENTIC_SETTINGS.AUTO_APPROVE_FILE_WRITES) ?? false,
        autoApproveFileCreates: configurationService.getValue<boolean>(SUPERCODE_AGENTIC_SETTINGS.AUTO_APPROVE_FILE_CREATES) ?? false,
        autoApproveFileDeletes: configurationService.getValue<boolean>(SUPERCODE_AGENTIC_SETTINGS.AUTO_APPROVE_FILE_DELETES) ?? false,
        terminalExecutionMode: configurationService.getValue<TerminalExecutionMode>(SUPERCODE_AGENTIC_SETTINGS.TERMINAL_EXECUTION_MODE) ?? 'ask',
        terminalCommandBlocklist: configurationService.getValue<string[]>(SUPERCODE_AGENTIC_SETTINGS.TERMINAL_COMMAND_BLOCKLIST) ?? DEFAULT_COMMAND_BLOCKLIST,
        showDiffPreview: configurationService.getValue<boolean>(SUPERCODE_AGENTIC_SETTINGS.SHOW_DIFF_PREVIEW) ?? true,
        autoOpenEditedFiles: configurationService.getValue<boolean>(SUPERCODE_AGENTIC_SETTINGS.AUTO_OPEN_EDITED_FILES) ?? true,
        multiFileConfirmation: configurationService.getValue<MultiFileConfirmation>(SUPERCODE_AGENTIC_SETTINGS.MULTI_FILE_CONFIRMATION) ?? 'combined',
        maxFilesPerSession: configurationService.getValue<number>(SUPERCODE_AGENTIC_SETTINGS.MAX_FILES_PER_SESSION) ?? 20,
        enableRollback: configurationService.getValue<boolean>(SUPERCODE_AGENTIC_SETTINGS.ENABLE_ROLLBACK) ?? true,
        protectedPaths: configurationService.getValue<string[]>(SUPERCODE_AGENTIC_SETTINGS.PROTECTED_PATHS) ?? DEFAULT_PROTECTED_PATHS
    };
}

// ============================================================================
// REGISTER CONFIGURATION
// ============================================================================

export function registerAgenticConfiguration(): void {
    const configRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

    configRegistry.registerConfiguration({
        id: 'supercode.agentic',
        title: localize('supercode.agentic', 'SuperCode Agentic'),
        type: 'object',
        properties: {
            [SUPERCODE_AGENTIC_SETTINGS.AUTO_APPROVE_FILE_WRITES]: {
                type: 'boolean',
                default: false,
                description: localize('autoApproveFileWrites', 'Automatically approve file write operations without confirmation')
            },
            [SUPERCODE_AGENTIC_SETTINGS.AUTO_APPROVE_FILE_CREATES]: {
                type: 'boolean',
                default: false,
                description: localize('autoApproveFileCreates', 'Automatically approve new file creation without confirmation')
            },
            [SUPERCODE_AGENTIC_SETTINGS.AUTO_APPROVE_FILE_DELETES]: {
                type: 'boolean',
                default: false,
                description: localize('autoApproveFileDeletes', 'Automatically approve file deletions without confirmation (use with caution)')
            },
            [SUPERCODE_AGENTIC_SETTINGS.TERMINAL_EXECUTION_MODE]: {
                type: 'string',
                enum: ['always', 'ask', 'never'],
                enumDescriptions: [
                    localize('terminalAlways', 'Always execute terminal commands automatically'),
                    localize('terminalAsk', 'Ask before executing terminal commands'),
                    localize('terminalNever', 'Never execute terminal commands automatically')
                ],
                default: 'ask',
                description: localize('terminalExecutionMode', 'How to handle terminal command execution from AI')
            },
            [SUPERCODE_AGENTIC_SETTINGS.TERMINAL_COMMAND_BLOCKLIST]: {
                type: 'array',
                items: { type: 'string' },
                default: DEFAULT_COMMAND_BLOCKLIST,
                description: localize('terminalBlocklist', 'Commands that should never be auto-executed (patterns)')
            },
            [SUPERCODE_AGENTIC_SETTINGS.SHOW_DIFF_PREVIEW]: {
                type: 'boolean',
                default: true,
                description: localize('showDiffPreview', 'Show diff preview before applying file edits')
            },
            [SUPERCODE_AGENTIC_SETTINGS.AUTO_OPEN_EDITED_FILES]: {
                type: 'boolean',
                default: true,
                description: localize('autoOpenEdited', 'Automatically open files in editor after they are modified')
            },
            [SUPERCODE_AGENTIC_SETTINGS.MULTI_FILE_CONFIRMATION]: {
                type: 'string',
                enum: ['combined', 'individual', 'auto'],
                enumDescriptions: [
                    localize('multiCombined', 'Show single confirmation for all files'),
                    localize('multiIndividual', 'Confirm each file individually'),
                    localize('multiAuto', 'Use auto-approve settings per file')
                ],
                default: 'combined',
                description: localize('multiFileConfirmation', 'How to handle confirmation when AI edits multiple files')
            },
            [SUPERCODE_AGENTIC_SETTINGS.MAX_FILES_PER_SESSION]: {
                type: 'number',
                default: 20,
                minimum: 1,
                maximum: 100,
                description: localize('maxFiles', 'Maximum number of files that can be modified in a single AI action')
            },
            [SUPERCODE_AGENTIC_SETTINGS.ENABLE_ROLLBACK]: {
                type: 'boolean',
                default: true,
                description: localize('enableRollback', 'Enable undo/rollback for AI-made changes')
            },
            [SUPERCODE_AGENTIC_SETTINGS.PROTECTED_PATHS]: {
                type: 'array',
                items: { type: 'string' },
                default: DEFAULT_PROTECTED_PATHS,
                description: localize('protectedPaths', 'File paths that require extra confirmation before modification')
            }
        }
    });
}
