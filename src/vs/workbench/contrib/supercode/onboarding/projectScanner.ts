/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Project Onboarding Wizard
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

// ============================================================================
// TYPES
// ============================================================================

export type ProjectType = 'nodejs' | 'python' | 'java' | 'go' | 'rust' | 'unknown';
export type FrameworkType = 'react' | 'nextjs' | 'vue' | 'angular' | 'express' | 'fastapi' | 'django' | 'flask' | 'spring' | 'none';

export interface ProjectInfo {
    name: string;
    type: ProjectType;
    framework: FrameworkType;
    language: string;
    version: string;
    description: string;
    dependencies: string[];
    devDependencies: string[];
    scripts: Record<string, string>;
    hasDocker: boolean;
    hasCI: boolean;
    hasTests: boolean;
    hasLinting: boolean;
}

export interface SetupStep {
    id: string;
    title: string;
    command: string;
    description: string;
    required: boolean;
}

export interface OnboardingResult {
    project: ProjectInfo;
    setupSteps: SetupStep[];
    suggestedAdditions: string[];
    generatedReadme: string;
}

// ============================================================================
// PROJECT SCANNER SERVICE
// ============================================================================

export class ProjectOnboardingService {
    constructor(
        @ILogService private readonly logService: ILogService,
        @IFileService private readonly fileService: IFileService
    ) {
        this.logService.info('[ProjectOnboarding] Service initialized');
    }

    /**
     * Scan and analyze a project
     */
    public async scanProject(workspaceRoot: URI): Promise<OnboardingResult> {
        this.logService.info('[ProjectOnboarding] Scanning project');

        const project = await this.analyzeProject(workspaceRoot);
        const setupSteps = this.generateSetupSteps(project);
        const suggestedAdditions = this.suggestAdditions(project);
        const generatedReadme = this.generateReadme(project);

        return {
            project,
            setupSteps,
            suggestedAdditions,
            generatedReadme
        };
    }

    private async analyzeProject(workspaceRoot: URI): Promise<ProjectInfo> {
        const info: ProjectInfo = {
            name: workspaceRoot.path.split('/').pop() || 'project',
            type: 'unknown',
            framework: 'none',
            language: 'unknown',
            version: '0.0.0',
            description: '',
            dependencies: [],
            devDependencies: [],
            scripts: {},
            hasDocker: false,
            hasCI: false,
            hasTests: false,
            hasLinting: false
        };

        // Check for package.json (Node.js)
        try {
            const packageJsonUri = URI.joinPath(workspaceRoot, 'package.json');
            const content = (await this.fileService.readFile(packageJsonUri)).value.toString();
            const pkg = JSON.parse(content);

            info.type = 'nodejs';
            info.name = pkg.name || info.name;
            info.version = pkg.version || '1.0.0';
            info.description = pkg.description || '';
            info.dependencies = Object.keys(pkg.dependencies || {});
            info.devDependencies = Object.keys(pkg.devDependencies || {});
            info.scripts = pkg.scripts || {};

            // Detect framework
            const allDeps = [...info.dependencies, ...info.devDependencies];
            if (allDeps.includes('next')) info.framework = 'nextjs';
            else if (allDeps.includes('react')) info.framework = 'react';
            else if (allDeps.includes('vue')) info.framework = 'vue';
            else if (allDeps.includes('@angular/core')) info.framework = 'angular';
            else if (allDeps.includes('express')) info.framework = 'express';

            // Detect features
            info.hasTests = !!info.scripts.test || allDeps.some(d => ['jest', 'vitest', 'mocha'].includes(d));
            info.hasLinting = allDeps.some(d => ['eslint', 'prettier'].includes(d));
            info.language = allDeps.includes('typescript') ? 'TypeScript' : 'JavaScript';
        } catch {
            // Not a Node.js project
        }

        // Check for Python
        try {
            const requirementsUri = URI.joinPath(workspaceRoot, 'requirements.txt');
            const content = (await this.fileService.readFile(requirementsUri)).value.toString();

            info.type = 'python';
            info.language = 'Python';
            info.dependencies = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));

            if (info.dependencies.some(d => d.includes('fastapi'))) info.framework = 'fastapi';
            else if (info.dependencies.some(d => d.includes('django'))) info.framework = 'django';
            else if (info.dependencies.some(d => d.includes('flask'))) info.framework = 'flask';

            info.hasTests = info.dependencies.some(d => d.includes('pytest'));
        } catch {
            // Check pyproject.toml
            try {
                const pyprojectUri = URI.joinPath(workspaceRoot, 'pyproject.toml');
                await this.fileService.readFile(pyprojectUri);
                info.type = 'python';
                info.language = 'Python';
            } catch {
                // Not Python
            }
        }

        // Check for Docker
        try {
            await this.fileService.stat(URI.joinPath(workspaceRoot, 'Dockerfile'));
            info.hasDocker = true;
        } catch {
            try {
                await this.fileService.stat(URI.joinPath(workspaceRoot, 'docker-compose.yml'));
                info.hasDocker = true;
            } catch {
                // No Docker
            }
        }

        // Check for CI
        try {
            await this.fileService.stat(URI.joinPath(workspaceRoot, '.github/workflows'));
            info.hasCI = true;
        } catch {
            try {
                await this.fileService.stat(URI.joinPath(workspaceRoot, '.gitlab-ci.yml'));
                info.hasCI = true;
            } catch {
                // No CI
            }
        }

        return info;
    }

    /**
     * Generate setup steps for the project
     */
    private generateSetupSteps(project: ProjectInfo): SetupStep[] {
        const steps: SetupStep[] = [];

        if (project.type === 'nodejs') {
            steps.push({
                id: 'install',
                title: 'Install dependencies',
                command: 'npm install',
                description: 'Install all project dependencies from package.json',
                required: true
            });

            if (project.scripts.dev) {
                steps.push({
                    id: 'dev',
                    title: 'Start development server',
                    command: 'npm run dev',
                    description: 'Start the development server with hot reload',
                    required: false
                });
            }

            if (project.scripts.build) {
                steps.push({
                    id: 'build',
                    title: 'Build for production',
                    command: 'npm run build',
                    description: 'Build the project for production deployment',
                    required: false
                });
            }

            if (project.scripts.test) {
                steps.push({
                    id: 'test',
                    title: 'Run tests',
                    command: 'npm test',
                    description: 'Run the test suite',
                    required: false
                });
            }
        }

        if (project.type === 'python') {
            steps.push({
                id: 'venv',
                title: 'Create virtual environment',
                command: 'python -m venv venv && source venv/bin/activate',
                description: 'Create and activate a Python virtual environment',
                required: true
            });

            steps.push({
                id: 'install',
                title: 'Install dependencies',
                command: 'pip install -r requirements.txt',
                description: 'Install Python dependencies',
                required: true
            });

            if (project.framework === 'fastapi') {
                steps.push({
                    id: 'run',
                    title: 'Run FastAPI server',
                    command: 'uvicorn main:app --reload',
                    description: 'Start the FastAPI development server',
                    required: false
                });
            }
        }

        return steps;
    }

    /**
     * Suggest additions to the project
     */
    private suggestAdditions(project: ProjectInfo): string[] {
        const suggestions: string[] = [];

        if (!project.hasDocker) {
            suggestions.push('Add Dockerfile for containerized deployment');
        }

        if (!project.hasCI) {
            suggestions.push('Add GitHub Actions workflow for CI/CD');
        }

        if (!project.hasTests) {
            suggestions.push(`Add ${project.type === 'python' ? 'pytest' : 'Jest/Vitest'} for testing`);
        }

        if (!project.hasLinting && project.type === 'nodejs') {
            suggestions.push('Add ESLint and Prettier for code quality');
        }

        if (project.type === 'nodejs' && !project.devDependencies.includes('typescript')) {
            suggestions.push('Consider adding TypeScript for type safety');
        }

        return suggestions;
    }

    /**
     * Generate a README for the project
     */
    private generateReadme(project: ProjectInfo): string {
        let readme = `# ${project.name}\n\n`;

        if (project.description) {
            readme += `${project.description}\n\n`;
        }

        readme += `## Tech Stack\n\n`;
        readme += `- **Language**: ${project.language}\n`;
        if (project.framework !== 'none') {
            readme += `- **Framework**: ${project.framework}\n`;
        }
        readme += '\n';

        readme += `## Getting Started\n\n`;
        readme += `### Prerequisites\n\n`;
        if (project.type === 'nodejs') {
            readme += `- Node.js (v18 or higher)\n`;
            readme += `- npm or yarn\n\n`;
        } else if (project.type === 'python') {
            readme += `- Python 3.9+\n`;
            readme += `- pip\n\n`;
        }

        readme += `### Installation\n\n`;
        readme += '```bash\n';
        if (project.type === 'nodejs') {
            readme += `# Clone the repository\ngit clone <repo-url>\ncd ${project.name}\n\n`;
            readme += `# Install dependencies\nnpm install\n\n`;
            readme += `# Start development server\nnpm run dev\n`;
        } else if (project.type === 'python') {
            readme += `# Clone the repository\ngit clone <repo-url>\ncd ${project.name}\n\n`;
            readme += `# Create virtual environment\npython -m venv venv\nsource venv/bin/activate\n\n`;
            readme += `# Install dependencies\npip install -r requirements.txt\n`;
        }
        readme += '\n```\n\n';

        if (project.scripts && Object.keys(project.scripts).length > 0) {
            readme += `## Available Scripts\n\n`;
            for (const [name, cmd] of Object.entries(project.scripts)) {
                readme += `- \`npm run ${name}\`: ${cmd}\n`;
            }
            readme += '\n';
        }

        readme += `## License\n\nMIT\n`;

        return readme;
    }

    /**
     * Write generated README to project
     */
    public async writeReadme(workspaceRoot: URI, content: string): Promise<void> {
        const readmeUri = URI.joinPath(workspaceRoot, 'README.md');
        await this.fileService.writeFile(readmeUri, VSBuffer.fromString(content));
        this.logService.info('[ProjectOnboarding] Wrote README.md');
    }
}
