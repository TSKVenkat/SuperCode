/*---------------------------------------------------------------------------------------------
 *  Clarke Kent AI - Slash Commands
 *  All 9 slash commands with context-aware prompts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ContextProvider, EditorContext } from './contextProvider';

// Model selection for different command types
const MODEL_ROUTING: Record<string, string> = {
    '/explain': 'qwen/qwen-2.5-72b-instruct:free',
    '/fix': 'qwen/qwen-2.5-coder-32b-instruct:free',
    '/test': 'qwen/qwen-2.5-coder-32b-instruct:free',
    '/refactor': 'deepseek/deepseek-r1:free',
    '/docs': 'qwen/qwen-2.5-72b-instruct:free',
    '/review': 'deepseek/deepseek-r1:free',
    '/security': 'deepseek/deepseek-r1:free',
    '/optimize': 'qwen/qwen-2.5-coder-32b-instruct:free',
    '/convert': 'qwen/qwen-2.5-coder-32b-instruct:free'
};

export interface CommandResult {
    content: string;
    suggestions: string[];
    codeBlock?: string;
    action?: 'replace' | 'insert' | 'newFile' | 'terminal' | 'display';
}

export interface SlashCommand {
    name: string;
    description: string;
    icon: string;
    handler: (args: string, context: EditorContext) => Promise<CommandResult>;
}

/**
 * System prompt for Clarke Kent
 */
const SYSTEM_PROMPT = `You are Clarke Kent, a brilliant AI coding assistant for SuperCode IDE. You are:
- Helpful, knowledgeable, and super-powered (like a certain Kryptonian)
- Concise but thorough in explanations
- Always ready to save developers from bugs and bad code

CRITICAL: After your response, ALWAYS include a line:
**Suggestions:** /cmd1, /cmd2, /cmd3

where cmd1, cmd2, cmd3 are relevant follow-up slash commands from: explain, fix, test, refactor, docs, review, security, optimize, convert`;

/**
 * All available slash commands
 */
export const SLASH_COMMANDS: Record<string, SlashCommand> = {
    '/explain': {
        name: 'explain',
        description: 'Explain the selected code in simple terms',
        icon: '📖',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            const prompt = `Explain this ${context.language} code clearly and concisely. 
${args ? `Focus on: ${args}` : 'Cover what it does, how it works, and any important patterns.'}

\`\`\`${context.language}
${context.code}
\`\`\``;

            return {
                content: prompt,
                suggestions: ['/refactor', '/docs', '/test'],
                action: 'display'
            };
        }
    },

    '/fix': {
        name: 'fix',
        description: 'Identify and fix bugs in the code',
        icon: '🔧',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            let errorContext = '';
            if (context.diagnostics.length > 0) {
                const errors = context.diagnostics
                    .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
                    .map(d => `Line ${d.range.start.line + 1}: ${d.message}`)
                    .join('\n');
                if (errors) {
                    errorContext = `\nKnown errors:\n${errors}\n`;
                }
            }

            const prompt = `Fix any bugs or issues in this ${context.language} code.${errorContext}
${args ? `Specific issue: ${args}` : ''}

Provide the corrected code with a brief explanation of what was fixed.

\`\`\`${context.language}
${context.code}
\`\`\``;

            return {
                content: prompt,
                suggestions: ['/test', '/review', '/explain'],
                action: 'replace'
            };
        }
    },

    '/test': {
        name: 'test',
        description: 'Generate unit tests for the code',
        icon: '🧪',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            const framework = await ContextProvider.detectTestFramework();

            const prompt = `Generate comprehensive unit tests for this ${context.language} code using ${framework}.
${args ? `Focus on: ${args}` : ''}

Include:
- Happy path tests
- Edge cases
- Error handling tests
- Descriptive test names

\`\`\`${context.language}
${context.code}
\`\`\`

Output ONLY the test code, ready to save to a test file.`;

            return {
                content: prompt,
                suggestions: ['/fix', '/docs', '/review'],
                action: 'newFile'
            };
        }
    },

    '/refactor': {
        name: 'refactor',
        description: 'Refactor code for better quality',
        icon: '✨',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            const prompt = `Refactor this ${context.language} code for better:
${args ? args : '- Readability\n- Performance\n- Modularity\n- Maintainability'}

Explain each change you make and why.

\`\`\`${context.language}
${context.code}
\`\`\``;

            return {
                content: prompt,
                suggestions: ['/test', '/docs', '/review'],
                action: 'replace'
            };
        }
    },

    '/docs': {
        name: 'docs',
        description: 'Generate documentation for the code',
        icon: '📝',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            const docStyle = (() => {
                switch (context.language) {
                    case 'javascript':
                    case 'typescript':
                    case 'javascriptreact':
                    case 'typescriptreact':
                        return 'JSDoc';
                    case 'python':
                        return 'Google-style docstrings';
                    case 'java':
                        return 'Javadoc';
                    case 'rust':
                        return 'Rustdoc';
                    case 'go':
                        return 'Go doc comments';
                    default:
                        return 'inline comments';
                }
            })();

            const prompt = `Generate ${docStyle} documentation for this ${context.language} code.
${args ? `Include: ${args}` : ''}

Document:
- All public functions/methods/classes
- Parameters and return values
- Examples where helpful
- Any important notes or warnings

\`\`\`${context.language}
${context.code}
\`\`\`

Output the documented code with all documentation inline.`;

            return {
                content: prompt,
                suggestions: ['/explain', '/test', '/refactor'],
                action: 'replace'
            };
        }
    },

    '/review': {
        name: 'review',
        description: 'Perform a code review',
        icon: '👁️',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            const prompt = `Perform a thorough code review of this ${context.language} code.
${args ? `Focus on: ${args}` : ''}

Review for:
1. **Correctness**: Logic errors, edge cases, potential bugs
2. **Security**: Vulnerabilities, unsafe patterns
3. **Performance**: Inefficiencies, bottlenecks
4. **Style**: Readability, naming, formatting
5. **Best Practices**: Design patterns, ${context.language} idioms

For each issue, provide:
- Location (approximate line/section)
- Severity (Critical/High/Medium/Low)
- Recommendation

\`\`\`${context.language}
${context.code}
\`\`\``;

            return {
                content: prompt,
                suggestions: ['/fix', '/refactor', '/security'],
                action: 'display'
            };
        }
    },

    '/security': {
        name: 'security',
        description: 'Scan for security vulnerabilities',
        icon: '🛡️',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            const prompt = `Perform a security audit of this ${context.language} code.
${args ? `Focus on: ${args}` : ''}

Scan for:
- **Injection vulnerabilities** (SQL, XSS, command injection)
- **Authentication/Authorization issues**
- **Sensitive data exposure**
- **Insecure dependencies**
- **Cryptographic weaknesses**
- **Input validation gaps**
- **OWASP Top 10 violations**

For each vulnerability:
- Severity: Critical/High/Medium/Low
- Description of the risk
- Remediation code or recommendation

\`\`\`${context.language}
${context.code}
\`\`\``;

            return {
                content: prompt,
                suggestions: ['/fix', '/review', '/refactor'],
                action: 'display'
            };
        }
    },

    '/optimize': {
        name: 'optimize',
        description: 'Optimize code for performance',
        icon: '⚡',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            const prompt = `Optimize this ${context.language} code for better performance.
${args ? `Focus on: ${args}` : ''}

Analyze and improve:
- **Time complexity**: Algorithm efficiency
- **Space complexity**: Memory usage
- **I/O operations**: Database, network, file
- **Concurrency**: Parallelization opportunities
- **Caching**: Memoization, data caching
- **Language-specific** optimizations for ${context.language}

Provide:
1. Performance analysis of current code
2. Optimized code
3. Explanation of improvements
4. Estimated performance gains

\`\`\`${context.language}
${context.code}
\`\`\``;

            return {
                content: prompt,
                suggestions: ['/test', '/review', '/docs'],
                action: 'replace'
            };
        }
    },

    '/convert': {
        name: 'convert',
        description: 'Convert code to another language/framework',
        icon: '🔄',
        handler: async (args: string, context: EditorContext): Promise<CommandResult> => {
            const targetLang = args.trim() || 'Python';

            const prompt = `Convert this ${context.language} code to ${targetLang}.

Maintain:
- Same functionality and behavior
- Idiomatic ${targetLang} patterns and conventions
- Appropriate error handling for ${targetLang}
- Type safety (if applicable)

Original ${context.language} code:
\`\`\`${context.language}
${context.code}
\`\`\`

Provide the converted ${targetLang} code with comments explaining any significant differences.`;

            return {
                content: prompt,
                suggestions: ['/docs', '/test', '/review'],
                action: 'newFile'
            };
        }
    }
};

/**
 * Parse user input to extract command and arguments
 */
export function parseCommand(input: string): { command: string; args: string } | null {
    const trimmed = input.trim();

    if (!trimmed.startsWith('/')) {
        return null;
    }

    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) {
        return { command: trimmed.toLowerCase(), args: '' };
    }

    return {
        command: trimmed.substring(0, spaceIndex).toLowerCase(),
        args: trimmed.substring(spaceIndex + 1).trim()
    };
}

/**
 * Get the optimal model for a given command
 */
export function getModelForCommand(command: string): string {
    return MODEL_ROUTING[command] || 'qwen/qwen-2.5-coder-32b-instruct:free';
}

/**
 * Extract suggestions from AI response
 */
export function extractSuggestions(response: string): string[] {
    const match = response.match(/\*\*Suggestions:\*\*\s*([^\n]+)/i)
        || response.match(/Suggestions:\s*([^\n]+)/i);

    if (match) {
        return match[1]
            .split(/[,\s]+/)
            .filter(s => s.startsWith('/'))
            .slice(0, 3);
    }

    return ['/explain', '/fix', '/test'];
}

/**
 * Extract code block from AI response
 */
export function extractCodeBlock(response: string): string | null {
    const match = response.match(/```[\w]*\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
}

/**
 * Get command list for help/autocomplete
 */
export function getCommandList(): { command: string; description: string; icon: string }[] {
    return Object.entries(SLASH_COMMANDS).map(([cmd, data]) => ({
        command: cmd,
        description: data.description,
        icon: data.icon
    }));
}
