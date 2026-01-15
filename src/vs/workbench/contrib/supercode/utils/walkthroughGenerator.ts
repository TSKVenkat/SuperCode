/*---------------------------------------------------------------------------------------------
 *  SuperCode - Walkthrough Generator
 *  Creates rich, visual documentation for command outputs
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';

// ============================================================================
// WALKTHROUGH TEMPLATES
// ============================================================================

export interface WalkthroughSection {
    title: string;
    content: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'code' | 'table';
}

export class WalkthroughGenerator {
    constructor(
        private readonly logService: ILogService,
        private readonly fileService: IFileService
    ) { }

    /**
     * Generate a test results walkthrough
     */
    public generateTestWalkthrough(params: {
        framework: string;
        testCount: number;
        filePath: string;
        functions: string[];
        timestamp: Date;
    }): string {
        const { framework, testCount, filePath, functions, timestamp } = params;

        let markdown = `# 🧪 Test Generation Report\n\n`;
        markdown += `**Generated:** ${timestamp.toLocaleString()}\n\n`;
        markdown += `---\n\n`;

        // Summary section
        markdown += `## 📊 Summary\n\n`;
        markdown += `| Metric | Value |\n`;
        markdown += `|--------|-------|\n`;
        markdown += `| Framework | \`${framework}\` |\n`;
        markdown += `| Tests Generated | ${testCount} |\n`;
        markdown += `| Source File | \`${filePath}\` |\n`;
        markdown += `| Functions Tested | ${functions.length} |\n\n`;

        // Functions tested
        if (functions.length > 0) {
            markdown += `## ✅ Functions Covered\n\n`;
            for (const fn of functions) {
                markdown += `- \`${fn}\`\n`;
            }
            markdown += '\n';
        }

        // Test structure
        markdown += `## 📁 Test Structure\n\n`;
        markdown += '```\n';
        markdown += `${filePath}\n`;
        markdown += `└── ${filePath.replace(/\.(ts|js|py)$/, '.test.$1')}\n`;
        markdown += `    ├── Imports & Setup\n`;
        markdown += `    ├── Test Suite\n`;
        for (const fn of functions) {
            markdown += `    │   ├── ${fn} - Happy Path\n`;
            markdown += `    │   ├── ${fn} - Edge Cases\n`;
            markdown += `    │   └── ${fn} - Error Cases\n`;
        }
        markdown += `    └── Cleanup\n`;
        markdown += '```\n\n';

        // Next steps
        markdown += `## 🚀 Next Steps\n\n`;
        markdown += `1. Review the generated tests\n`;
        markdown += `2. Run the test suite: \`npm test\`\n`;
        markdown += `3. Check coverage: \`npm run coverage\`\n`;
        markdown += `4. Add mocks for external dependencies\n`;
        markdown += `5. Expand edge cases as needed\n\n`;

        // Best practices
        markdown += `> **💡 Best Practices**\n`;
        markdown += `> - Keep tests isolated and independent\n`;
        markdown += `> - Use descriptive test names\n`;
        markdown += `> - Mock external dependencies\n`;
        markdown += `> - Aim for >80% code coverage\n\n`;

        return markdown;
    }

    /**
     * Generate a security scan walkthrough
     */
    public generateSecurityWalkthrough(params: {
        totalIssues: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        scannedFiles: number;
        vulnerabilities: Array<{ type: string; file: string; line: number; severity: string }>;
        timestamp: Date;
    }): string {
        const { totalIssues, critical, high, medium, low, scannedFiles, vulnerabilities, timestamp } = params;

        let markdown = `# 🔒 Security Scan Report\n\n`;
        markdown += `**Scanned:** ${timestamp.toLocaleString()}\n\n`;
        markdown += `---\n\n`;

        // Executive Summary
        markdown += `## 📋 Executive Summary\n\n`;
        if (totalIssues === 0) {
            markdown += `> ✅ **No security vulnerabilities found!**\n\n`;
        } else {
            markdown += `> ⚠️ **Found ${totalIssues} potential security issue${totalIssues > 1 ? 's' : ''}**\n\n`;
        }

        // Metrics
        markdown += `## 📊 Scan Metrics\n\n`;
        markdown += `| Metric | Value |\n`;
        markdown += `|--------|-------|\n`;
        markdown += `| Files Scanned | ${scannedFiles} |\n`;
        markdown += `| Total Issues | ${totalIssues} |\n`;
        markdown += `| 🔴 Critical | ${critical} |\n`;
        markdown += `| 🟠 High | ${high} |\n`;
        markdown += `| 🟡 Medium | ${medium} |\n`;
        markdown += `| ⚪ Low | ${low} |\n\n`;

        // Severity chart
        if (totalIssues > 0) {
            markdown += `## 📈 Severity Distribution\n\n`;
            markdown += '```\n';
            markdown += `Critical [${'█'.repeat(Math.min(critical, 20))}${' '.repeat(Math.max(0, 20 - critical))}] ${critical}\n`;
            markdown += `High     [${'█'.repeat(Math.min(high, 20))}${' '.repeat(Math.max(0, 20 - high))}] ${high}\n`;
            markdown += `Medium   [${'█'.repeat(Math.min(medium, 20))}${' '.repeat(Math.max(0, 20 - medium))}] ${medium}\n`;
            markdown += `Low      [${'█'.repeat(Math.min(low, 20))}${' '.repeat(Math.max(0, 20 - low))}] ${low}\n`;
            markdown += '```\n\n';

            // Vulnerability details
            markdown += `## 🔍 Vulnerability Details\n\n`;
            const grouped = this.groupBy(vulnerabilities, 'severity');

            for (const severity of ['critical', 'high', 'medium', 'low']) {
                const issues = grouped[severity] || [];
                if (issues.length === 0) continue;

                const icon = severity === 'critical' ? '🔴' : severity === 'high' ? '🟠' : severity === 'medium' ? '🟡' : '⚪';
                markdown += `### ${icon} ${severity.toUpperCase()} Severity\n\n`;

                for (const vuln of issues) {
                    markdown += `#### ${vuln.type}\n`;
                    markdown += `- **File:** \`${vuln.file}:${vuln.line}\`\n`;
                    markdown += `- **Pattern:** ${this.getVulnDescription(vuln.type)}\n`;
                    markdown += `- **Fix:** ${this.getVulnFix(vuln.type)}\n\n`;
                }
            }
        }

        // Recommendations
        markdown += `## 💡 Recommendations\n\n`;
        if (critical > 0 || high > 0) {
            markdown += `> ⚠️ **URGENT:** Address critical and high severity issues immediately.\n\n`;
        }
        markdown += `1. Fix critical and high severity issues first\n`;
        markdown += `2. Implement input validation for all user inputs\n`;
        markdown += `3. Use parameterized queries for database operations\n`;
        markdown += `4. Enable Content Security Policy (CSP) headers\n`;
        markdown += `5. Regularly update dependencies\n`;
        markdown += `6. Consider using a security linter (e.g., Semgrep, Snyk)\n\n`;

        // Resources
        markdown += `## 📚 Resources\n\n`;
        markdown += `- [OWASP Top 10](https://owasp.org/www-project-top-ten/)\n`;
        markdown += `- [CWE Database](https://cwe.mitre.org/)\n`;
        markdown += `- [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit)\n`;
        markdown += `- [Snyk Vulnerability DB](https://security.snyk.io/)\n\n`;

        return markdown;
    }

    /**
     * Generate a project onboarding walkthrough
     */
    public generateOnboardingWalkthrough(params: {
        projectName: string;
        type: string;
        framework: string;
        language: string;
        dependencies: string[];
        setupSteps: Array<{ title: string; command: string }>;
        suggestions: string[];
        timestamp: Date;
    }): string {
        const { projectName, type, framework, language, dependencies, setupSteps, suggestions, timestamp } = params;

        let markdown = `# 🚀 Project Onboarding Guide: ${projectName}\n\n`;
        markdown += `**Generated:** ${timestamp.toLocaleString()}\n\n`;
        markdown += `---\n\n`;

        // Project overview
        markdown += `## 📦 Project Overview\n\n`;
        markdown += `| Property | Value |\n`;
        markdown += `|----------|-------|\n`;
        markdown += `| Type | ${type} |\n`;
        markdown += `| Framework | ${framework} |\n`;
        markdown += `| Language | ${language} |\n`;
        markdown += `| Dependencies | ${dependencies.length} packages |\n\n`;

        // Tech stack
        markdown += `## 🛠️ Tech Stack\n\n`;
        markdown += '```mermaid\n';
        markdown += 'graph LR\n';
        markdown += `    A[${projectName}] --> B[${framework}]\n`;
        markdown += `    A --> C[${language}]\n`;
        for (const dep of dependencies.slice(0, 5)) {
            markdown += `    A --> D${dependencies.indexOf(dep)}[${dep}]\n`;
        }
        markdown += '```\n\n';

        // Quick start
        markdown += `## ⚡ Quick Start\n\n`;
        for (let i = 0; i < setupSteps.length; i++) {
            const step = setupSteps[i];
            markdown += `### ${i + 1}. ${step.title}\n\n`;
            markdown += '```bash\n';
            markdown += `${step.command}\n`;
            markdown += '```\n\n';
        }

        // Key dependencies
        if (dependencies.length > 0) {
            markdown += `## 📚 Key Dependencies\n\n`;
            const highlighted = dependencies.slice(0, 10);
            for (const dep of highlighted) {
                markdown += `- \`${dep}\` - ${this.getPackageDescription(dep)}\n`;
            }
            if (dependencies.length > 10) {
                markdown += `\n*...and ${dependencies.length - 10} more*\n`;
            }
            markdown += '\n';
        }

        // Suggestions
        if (suggestions.length > 0) {
            markdown += `## 💡 Suggested Enhancements\n\n`;
            for (const suggestion of suggestions) {
                markdown += `- [ ] ${suggestion}\n`;
            }
            markdown += '\n';
        }

        // Next steps
        markdown += `## 🎯 Next Steps\n\n`;
        markdown += `1. ✅ Review this onboarding guide\n`;
        markdown += `2. ⚙️ Set up your development environment\n`;
        markdown += `3. 📖 Read the generated README.md\n`;
        markdown += `4. 🧪 Run the test suite\n`;
        markdown += `5. 🚀 Start developing!\n\n`;

        // Helpful tips
        markdown += `> **💡 Pro Tips**\n`;
        markdown += `> - Use \`SuperCode: Generate Tests\` to create unit tests\n`;
        markdown += `> - Run \`SuperCode: Security Scan\` regularly\n`;
        markdown += `> - Leverage AI chat for code explanations\n\n`;

        return markdown;
    }

    /**
     * Write walkthrough to workspace
     */
    public async saveWalkthrough(workspaceRoot: URI, content: string, filename: string): Promise<URI> {
        const walkthroughUri = URI.joinPath(workspaceRoot, '.supercode', filename);
        await this.fileService.createFolder(URI.joinPath(workspaceRoot, '.supercode'));
        await this.fileService.writeFile(walkthroughUri, VSBuffer.fromString(content));
        this.logService.info(`[WalkthroughGenerator] Saved to ${walkthroughUri.path}`);
        return walkthroughUri;
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
        return array.reduce((result, item) => {
            const group = String(item[key]);
            if (!result[group]) result[group] = [];
            result[group].push(item);
            return result;
        }, {} as Record<string, T[]>);
    }

    private getVulnDescription(type: string): string {
        const descriptions: Record<string, string> = {
            'SQL Injection': 'Unsanitized SQL queries',
            'XSS': 'Unsanitized HTML output',
            'Command Injection': 'Unsanitized shell commands',
            'Path Traversal': 'Unsanitized file paths',
            'Hardcoded Secret': 'Credentials in source code'
        };
        return descriptions[type] || type;
    }

    private getVulnFix(type: string): string {
        const fixes: Record<string, string> = {
            'SQL Injection': 'Use parameterized queries or ORM',
            'XSS': 'Use DOMPurify or escape HTML',
            'Command Injection': 'Avoid exec/eval, use child_process safely',
            'Path Traversal': 'Validate paths, use path.resolve()',
            'Hardcoded Secret': 'Use environment variables or secrets manager'
        };
        return fixes[type] || 'Review and sanitize input';
    }

    private getPackageDescription(pkg: string): string {
        const descriptions: Record<string, string> = {
            'react': 'UI library',
            'express': 'Web framework',
            'typescript': 'Type safety',
            'jest': 'Testing framework',
            'eslint': 'Code quality',
            'prettier': 'Code formatting'
        };
        return descriptions[pkg] || 'Package dependency';
    }
}
