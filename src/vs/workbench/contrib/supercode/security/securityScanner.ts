/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Security Vulnerability Scanner
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';

// ============================================================================
// TYPES
// ============================================================================

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Vulnerability {
    id: string;
    title: string;
    description: string;
    severity: VulnerabilitySeverity;
    file: string;
    line: number;
    code: string;
    fix: string;
    cweId?: string;
}

export interface DependencyVulnerability {
    package: string;
    version: string;
    vulnerableVersions: string;
    title: string;
    severity: VulnerabilitySeverity;
    cveId?: string;
    patchedVersion?: string;
}

export interface SecurityReport {
    codeVulnerabilities: Vulnerability[];
    dependencyVulnerabilities: DependencyVulnerability[];
    scannedFiles: number;
    scannedPackages: number;
    timestamp: number;
}

// ============================================================================
// VULNERABILITY PATTERNS (Static Analysis)
// ============================================================================

const VULN_PATTERNS: { id: string; pattern: RegExp; title: string; severity: VulnerabilitySeverity; description: string; fix: string; cweId: string }[] = [
    // SQL Injection
    {
        id: 'sql-injection',
        pattern: /(?:query|execute|exec)\s*\(\s*[`'"].*\$\{.*\}.*[`'"]/gi,
        title: 'Potential SQL Injection',
        severity: 'critical',
        description: 'User input is directly interpolated into SQL query string, allowing attackers to execute arbitrary SQL.',
        fix: 'Use parameterized queries or prepared statements instead of string interpolation.',
        cweId: 'CWE-89'
    },
    // Command Injection
    {
        id: 'command-injection',
        pattern: /(?:exec|spawn|execSync|spawnSync)\s*\(\s*[`'"].*\$\{.*\}.*[`'"]/gi,
        title: 'Potential Command Injection',
        severity: 'critical',
        description: 'User input is directly used in shell command, allowing attackers to execute arbitrary commands.',
        fix: 'Sanitize input or use dedicated libraries that escape shell arguments.',
        cweId: 'CWE-78'
    },
    // Hardcoded Secrets
    {
        id: 'hardcoded-secret',
        pattern: /(?:password|secret|api[_-]?key|token|auth)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
        title: 'Hardcoded Secret',
        severity: 'high',
        description: 'Sensitive credential appears to be hardcoded in source code.',
        fix: 'Use environment variables or a secrets manager instead.',
        cweId: 'CWE-798'
    },
    // Insecure Random
    {
        id: 'insecure-random',
        pattern: /Math\.random\s*\(\s*\)/gi,
        title: 'Insecure Random Number Generator',
        severity: 'medium',
        description: 'Math.random() is not cryptographically secure.',
        fix: 'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive operations.',
        cweId: 'CWE-330'
    },
    // eval() usage
    {
        id: 'eval-usage',
        pattern: /\beval\s*\(/gi,
        title: 'Use of eval()',
        severity: 'high',
        description: 'eval() executes arbitrary code and is a major security risk.',
        fix: 'Avoid eval(). Use JSON.parse() for JSON, or safer alternatives.',
        cweId: 'CWE-95'
    },
    // Prototype Pollution
    {
        id: 'prototype-pollution',
        pattern: /\[['"]__proto__['"]\]|\.__proto__/gi,
        title: 'Potential Prototype Pollution',
        severity: 'high',
        description: 'Accessing __proto__ can lead to prototype pollution attacks.',
        fix: 'Use Object.create(null) or validate object keys.',
        cweId: 'CWE-1321'
    },
    // Path Traversal
    {
        id: 'path-traversal',
        pattern: /(?:readFile|writeFile|existsSync)\s*\(\s*[`'"].*\$\{.*\}.*[`'"]/gi,
        title: 'Potential Path Traversal',
        severity: 'high',
        description: 'User input in file path can allow attackers to access files outside intended directory.',
        fix: 'Validate and sanitize file paths. Use path.resolve() and check against allowed directories.',
        cweId: 'CWE-22'
    },
    // Open Redirect
    {
        id: 'open-redirect',
        pattern: /res\.redirect\s*\(\s*(?:req\.query|req\.body|req\.params)/gi,
        title: 'Open Redirect',
        severity: 'medium',
        description: 'Redirecting to user-controlled URL can lead to phishing attacks.',
        fix: 'Validate redirect URLs against a whitelist of allowed domains.',
        cweId: 'CWE-601'
    },
    // XSS via innerHTML
    {
        id: 'xss-innerhtml',
        pattern: /\.innerHTML\s*=\s*(?!['"`])/gi,
        title: 'Potential XSS via innerHTML',
        severity: 'high',
        description: 'Setting innerHTML with untrusted data can lead to XSS attacks.',
        fix: 'Use textContent for text, or sanitize HTML with DOMPurify.',
        cweId: 'CWE-79'
    },
    // Insecure Cookie
    {
        id: 'insecure-cookie',
        pattern: /res\.cookie\s*\([^)]*(?!httpOnly|secure)/gi,
        title: 'Insecure Cookie Settings',
        severity: 'medium',
        description: 'Cookie may be missing httpOnly or secure flags.',
        fix: 'Set httpOnly: true and secure: true for sensitive cookies.',
        cweId: 'CWE-614'
    }
];

// ============================================================================
// SECURITY SCANNER SERVICE
// ============================================================================

export class SecurityScannerService {
    constructor(
        @ILogService private readonly logService: ILogService,
        @IFileService private readonly fileService: IFileService
    ) {
        this.logService.info('[SecurityScanner] Service initialized');
    }

    /**
     * Scan workspace for vulnerabilities
     */
    public async scanWorkspace(workspaceRoot: URI): Promise<SecurityReport> {
        this.logService.info('[SecurityScanner] Starting scan');

        const codeVulnerabilities: Vulnerability[] = [];
        const files = await this.discoverCodeFiles(workspaceRoot);

        for (const fileUri of files) {
            const vulns = await this.scanFile(fileUri, workspaceRoot);
            codeVulnerabilities.push(...vulns);
        }

        const dependencyVulnerabilities = await this.scanDependencies(workspaceRoot);

        const report: SecurityReport = {
            codeVulnerabilities,
            dependencyVulnerabilities,
            scannedFiles: files.length,
            scannedPackages: dependencyVulnerabilities.length > 0 ? 1 : 0,
            timestamp: Date.now()
        };

        this.logService.info(`[SecurityScanner] Found ${codeVulnerabilities.length} code issues, ${dependencyVulnerabilities.length} dependency issues`);
        return report;
    }

    private async discoverCodeFiles(root: URI): Promise<URI[]> {
        const files: URI[] = [];
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java'];

        try {
            const stat = await this.fileService.resolve(root);
            if (!stat.children) return files;

            for (const child of stat.children) {
                if (child.isDirectory) {
                    if (!['node_modules', '.git', 'dist', 'build'].includes(child.name)) {
                        const subFiles = await this.discoverCodeFiles(child.resource);
                        files.push(...subFiles);
                    }
                } else {
                    const ext = child.name.substring(child.name.lastIndexOf('.'));
                    if (extensions.includes(ext)) {
                        files.push(child.resource);
                    }
                }
            }
        } catch {
            // Ignore errors
        }

        return files.slice(0, 200); // Limit scan scope
    }

    /**
     * Scan a single file for vulnerabilities
     */
    public async scanFile(fileUri: URI, root: URI): Promise<Vulnerability[]> {
        const vulnerabilities: Vulnerability[] = [];

        try {
            const content = (await this.fileService.readFile(fileUri)).value.toString();
            const lines = content.split('\n');
            const relativePath = fileUri.path.replace(root.path + '/', '');

            for (const pattern of VULN_PATTERNS) {
                let match;
                pattern.pattern.lastIndex = 0; // Reset regex

                while ((match = pattern.pattern.exec(content)) !== null) {
                    // Find line number
                    const beforeMatch = content.substring(0, match.index);
                    const lineNumber = beforeMatch.split('\n').length;

                    vulnerabilities.push({
                        id: pattern.id,
                        title: pattern.title,
                        description: pattern.description,
                        severity: pattern.severity,
                        file: relativePath,
                        line: lineNumber,
                        code: lines[lineNumber - 1]?.trim() || match[0],
                        fix: pattern.fix,
                        cweId: pattern.cweId
                    });
                }
            }
        } catch {
            // Skip files that can't be read
        }

        return vulnerabilities;
    }

    /**
     * Scan dependencies for known vulnerabilities
     */
    public async scanDependencies(workspaceRoot: URI): Promise<DependencyVulnerability[]> {
        const vulnerabilities: DependencyVulnerability[] = [];

        try {
            const packageJsonUri = URI.joinPath(workspaceRoot, 'package.json');
            const content = (await this.fileService.readFile(packageJsonUri)).value.toString();
            const pkg = JSON.parse(content);

            const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies
            };

            // Check against known vulnerable packages (cached list)
            for (const [name, version] of Object.entries(allDeps)) {
                const vuln = this.checkKnownVulnerability(name, String(version));
                if (vuln) {
                    vulnerabilities.push(vuln);
                }
            }
        } catch {
            // No package.json or parse error
        }

        return vulnerabilities;
    }

    private checkKnownVulnerability(packageName: string, version: string): DependencyVulnerability | null {
        // Known vulnerable packages (this would normally be fetched from a vulnerability database)
        const knownVulnerable: Record<string, { title: string; severity: VulnerabilitySeverity; patch: string }> = {
            'lodash': { title: 'Prototype Pollution in lodash < 4.17.21', severity: 'high', patch: '4.17.21' },
            'minimist': { title: 'Prototype Pollution in minimist < 1.2.6', severity: 'high', patch: '1.2.6' },
            'axios': { title: 'SSRF in axios < 0.21.1', severity: 'high', patch: '0.21.1' },
            'serialize-javascript': { title: 'XSS in serialize-javascript < 3.1.0', severity: 'high', patch: '3.1.0' }
        };

        if (knownVulnerable[packageName]) {
            const vuln = knownVulnerable[packageName];
            return {
                package: packageName,
                version: version,
                vulnerableVersions: `< ${vuln.patch}`,
                title: vuln.title,
                severity: vuln.severity,
                patchedVersion: vuln.patch
            };
        }

        return null;
    }

    /**
     * Generate AI-friendly report
     */
    public formatReportForAI(report: SecurityReport): string {
        if (report.codeVulnerabilities.length === 0 && report.dependencyVulnerabilities.length === 0) {
            return '\n## Security Scan: No issues found ✅\n';
        }

        let output = '\n## Security Scan Results\n\n';

        if (report.codeVulnerabilities.length > 0) {
            output += '### Code Vulnerabilities\n';
            const bySeverity = this.groupBySeverity(report.codeVulnerabilities);

            for (const [severity, vulns] of Object.entries(bySeverity)) {
                output += `\n**${severity.toUpperCase()}** (${vulns.length}):\n`;
                for (const v of vulns.slice(0, 5)) {
                    output += `- ${v.title} in \`${v.file}:${v.line}\`\n`;
                    output += `  Fix: ${v.fix}\n`;
                }
            }
        }

        if (report.dependencyVulnerabilities.length > 0) {
            output += '\n### Dependency Vulnerabilities\n';
            for (const v of report.dependencyVulnerabilities) {
                output += `- **${v.package}@${v.version}**: ${v.title}\n`;
                output += `  Update to: ${v.patchedVersion || 'latest'}\n`;
            }
        }

        return output;
    }

    private groupBySeverity(vulns: Vulnerability[]): Record<string, Vulnerability[]> {
        const groups: Record<string, Vulnerability[]> = {};
        for (const v of vulns) {
            if (!groups[v.severity]) groups[v.severity] = [];
            groups[v.severity].push(v);
        }
        return groups;
    }
}
