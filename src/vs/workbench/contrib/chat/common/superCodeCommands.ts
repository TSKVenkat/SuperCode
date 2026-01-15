/*---------------------------------------------------------------------------------------------
 *  SuperCode v2 - Command Contributions
 *  Registers all SuperCode commands in the Command Palette
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { getServicesManager } from './superCodeServices.js';
import { WalkthroughGenerator } from '../../supercode/utils/walkthroughGenerator.js';

// ============================================================================
// COMMAND IDS
// ============================================================================

const COMMAND_IDS = {
    GENERATE_TESTS: 'supercode.generateTests',
    SECURITY_SCAN: 'supercode.securityScan',
    PROJECT_ONBOARD: 'supercode.projectOnboard',
    CREATE_PLAN: 'supercode.createPlan',
    WEB_SEARCH: 'supercode.webSearch'
};

// ============================================================================
// GENERATE TESTS COMMAND
// ============================================================================

registerAction2(class extends Action2 {
    constructor() {
        super({
            id: COMMAND_IDS.GENERATE_TESTS,
            title: localize2('supercode.generateTests', 'SuperCode: Generate Tests'),
            category: Categories.Developer,
            f1: true,
            menu: {
                id: MenuId.EditorContext,
                group: 'supercode',
                order: 1,
                when: undefined
            }
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const editorService = accessor.get(IEditorService);
        const notificationService = accessor.get(INotificationService);
        const workspaceContextService = accessor.get(IWorkspaceContextService);
        const fileService = accessor.get(IFileService);
        const storageService = accessor.get(IStorageService);
        const logService = accessor.get(ILogService);

        const editor = editorService.activeTextEditorControl;
        if (!editor) {
            notificationService.notify({
                severity: Severity.Warning,
                message: 'No active editor. Open a file to generate tests.'
            });
            return;
        }

        const model = (editor as any).getModel?.() as ITextModel | undefined;
        if (!model) {
            notificationService.notify({
                severity: Severity.Warning,
                message: 'Cannot read file content.'
            });
            return;
        }

        const workspaceFolder = workspaceContextService.getWorkspace().folders[0];
        if (!workspaceFolder) {
            notificationService.notify({
                severity: Severity.Warning,
                message: 'No workspace folder open.'
            });
            return;
        }

        try {
            const services = getServicesManager(logService, fileService, storageService, workspaceContextService);
            const walkthroughGen = new WalkthroughGenerator(logService, fileService);
            const code = model.getValue();
            const filePath = model.uri.path;

            notificationService.notify({
                severity: Severity.Info,
                message: 'Generating tests...'
            });

            const result = await services.handleTestCommand(code, filePath, workspaceFolder.uri);

            if (result.tests.content) {
                // Write test file
                await services.services?.testGenerator.writeTestFile(workspaceFolder.uri, result.tests);

                // Extract function names from code for walkthrough
                const functionMatches = code.match(/(?:function|const|let|var)\s+(\w+)/g) || [];
                const functions = functionMatches.map((match: string) => match.split(/\s+/)[1]);

                // Generate walkthrough
                const walkthrough = walkthroughGen.generateTestWalkthrough({
                    framework: result.tests.framework,
                    testCount: functions.length,
                    filePath: filePath,
                    functions: functions,
                    timestamp: new Date()
                });

                const walkthroughUri = await walkthroughGen.saveWalkthrough(
                    workspaceFolder.uri,
                    walkthrough,
                    `test-generation-${Date.now()}.md`
                );

                // Open walkthrough
                await editorService.openEditor({ resource: walkthroughUri });

                notificationService.notify({
                    severity: Severity.Info,
                    message: `✅ ${result.message} Created: ${result.tests.filePath}`
                });
            } else {
                notificationService.notify({
                    severity: Severity.Warning,
                    message: result.message
                });
            }
        } catch (error) {
            notificationService.notify({
                severity: Severity.Error,
                message: `Failed to generate tests: ${error}`
            });
        }
    }
});

// ============================================================================
// SECURITY SCAN COMMAND
// ============================================================================

registerAction2(class extends Action2 {
    constructor() {
        super({
            id: COMMAND_IDS.SECURITY_SCAN,
            title: localize2('supercode.securityScan', 'SuperCode: Security Scan'),
            category: Categories.Developer,
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notificationService = accessor.get(INotificationService);
        const workspaceContextService = accessor.get(IWorkspaceContextService);
        const fileService = accessor.get(IFileService);
        const storageService = accessor.get(IStorageService);
        const logService = accessor.get(ILogService);

        const workspaceFolder = workspaceContextService.getWorkspace().folders[0];
        if (!workspaceFolder) {
            notificationService.notify({
                severity: Severity.Warning,
                message: 'No workspace folder open.'
            });
            return;
        }

        try {
            const services = getServicesManager(logService, fileService, storageService, workspaceContextService);
            const walkthroughGen = new WalkthroughGenerator(logService, fileService);
            const editorService = accessor.get(IEditorService);

            notificationService.notify({
                severity: Severity.Info,
                message: '🔍 Scanning for security vulnerabilities...'
            });

            const result = await services.handleSecurityCommand(workspaceFolder.uri);
            const totalIssues = result.report.codeVulnerabilities.length + result.report.dependencyVulnerabilities.length;

            // Count by severity
            const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
            for (const vuln of result.report.codeVulnerabilities) {
                const sev = vuln.severity.toLowerCase() as keyof typeof severityCounts;
                if (sev in severityCounts) severityCounts[sev]++;
            }

            // Generate walkthrough
            const walkthrough = walkthroughGen.generateSecurityWalkthrough({
                totalIssues,
                critical: severityCounts.critical,
                high: severityCounts.high,
                medium: severityCounts.medium,
                low: severityCounts.low,
                scannedFiles: result.report.scannedFiles,
                vulnerabilities: result.report.codeVulnerabilities.map(v => ({
                    type: v.title,
                    file: v.file,
                    line: v.line,
                    severity: v.severity.toLowerCase()
                })),
                timestamp: new Date()
            });

            const walkthroughUri = await walkthroughGen.saveWalkthrough(
                workspaceFolder.uri,
                walkthrough,
                `security-scan-${Date.now()}.md`
            );

            // Open walkthrough
            await editorService.openEditor({ resource: walkthroughUri });

            if (totalIssues === 0) {
                notificationService.notify({
                    severity: Severity.Info,
                    message: '✅ No security vulnerabilities found!'
                });
            } else {
                notificationService.notify({
                    severity: Severity.Warning,
                    message: `⚠️ Found ${totalIssues} security issue(s). Check the report.`
                });
            }
        } catch (error) {
            notificationService.notify({
                severity: Severity.Error,
                message: `Security scan failed: ${error}`
            });
        }
    }
});

// ============================================================================
// PROJECT ONBOARD COMMAND
// ============================================================================

registerAction2(class extends Action2 {
    constructor() {
        super({
            id: COMMAND_IDS.PROJECT_ONBOARD,
            title: localize2('supercode.projectOnboard', 'SuperCode: Project Onboarding'),
            category: Categories.Developer,
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notificationService = accessor.get(INotificationService);
        const quickInputService = accessor.get(IQuickInputService);
        const workspaceContextService = accessor.get(IWorkspaceContextService);
        const fileService = accessor.get(IFileService);
        const storageService = accessor.get(IStorageService);
        const logService = accessor.get(ILogService);

        const workspaceFolder = workspaceContextService.getWorkspace().folders[0];
        if (!workspaceFolder) {
            notificationService.notify({
                severity: Severity.Warning,
                message: 'No workspace folder open.'
            });
            return;
        }

        try {
            const services = getServicesManager(logService, fileService, storageService, workspaceContextService);
            const walkthroughGen = new WalkthroughGenerator(logService, fileService);
            const editorService = accessor.get(IEditorService);

            notificationService.notify({
                severity: Severity.Info,
                message: '📋 Analyzing project...'
            });

            const result = await services.handleOnboardCommand(workspaceFolder.uri);

            // Generate walkthrough
            const walkthrough = walkthroughGen.generateOnboardingWalkthrough({
                projectName: result.result.project.name,
                type: result.result.project.type,
                framework: result.result.project.framework,
                language: result.result.project.language,
                dependencies: result.result.project.dependencies,
                setupSteps: result.result.setupSteps,
                suggestions: result.result.suggestedAdditions,
                timestamp: new Date()
            });

            const walkthroughUri = await walkthroughGen.saveWalkthrough(
                workspaceFolder.uri,
                walkthrough,
                `onboarding-${Date.now()}.md`
            );

            // Open walkthrough
            await editorService.openEditor({ resource: walkthroughUri });

            // Ask user if they want to generate README
            const action = await quickInputService.pick([
                { id: 'readme', label: '📝 Generate README.md' },
                { id: 'show', label: '👁️ Show project summary' }
            ], {
                title: `Project: ${result.result.project.name}`,
                placeHolder: 'Choose an action'
            });

            if (action?.id === 'readme') {
                await services.services?.onboarding.writeReadme(workspaceFolder.uri, result.result.generatedReadme);
                notificationService.notify({
                    severity: Severity.Info,
                    message: '✅ README.md generated!'
                });
            }

        } catch (error) {
            notificationService.notify({
                severity: Severity.Error,
                message: `Project scan failed: ${error}`
            });
        }
    }
});

// ============================================================================
// CREATE PLAN COMMAND (Agentic)
// ============================================================================

registerAction2(class extends Action2 {
    constructor() {
        super({
            id: COMMAND_IDS.CREATE_PLAN,
            title: localize2('supercode.createPlan', 'SuperCode: Create Execution Plan'),
            category: Categories.Developer,
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notificationService = accessor.get(INotificationService);
        const quickInputService = accessor.get(IQuickInputService);
        const workspaceContextService = accessor.get(IWorkspaceContextService);
        const fileService = accessor.get(IFileService);
        const storageService = accessor.get(IStorageService);
        const logService = accessor.get(ILogService);

        const goal = await quickInputService.input({
            title: 'What do you want to accomplish?',
            placeHolder: 'e.g., "Create a REST API for user management"'
        });

        if (!goal) return;

        try {
            const services = getServicesManager(logService, fileService, storageService, workspaceContextService);
            const result = await services.handlePlanCommand(goal, '');

            notificationService.notify({
                severity: Severity.Info,
                message: `📋 Plan created with ${result.plan.steps.length} steps. Open Chat to execute.`
            });
        } catch (error) {
            notificationService.notify({
                severity: Severity.Error,
                message: `Failed to create plan: ${error}`
            });
        }
    }
});

// ============================================================================
// WEB SEARCH COMMAND
// ============================================================================

registerAction2(class extends Action2 {
    constructor() {
        super({
            id: COMMAND_IDS.WEB_SEARCH,
            title: localize2('supercode.webSearch', 'SuperCode: Search Web/Docs'),
            category: Categories.Developer,
            f1: true
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notificationService = accessor.get(INotificationService);
        const quickInputService = accessor.get(IQuickInputService);
        const workspaceContextService = accessor.get(IWorkspaceContextService);
        const fileService = accessor.get(IFileService);
        const storageService = accessor.get(IStorageService);
        const logService = accessor.get(ILogService);

        const query = await quickInputService.input({
            title: 'Search',
            placeHolder: 'e.g., "react hooks best practices" or "express middleware"'
        });

        if (!query) return;

        try {
            const services = getServicesManager(logService, fileService, storageService, workspaceContextService);

            notificationService.notify({
                severity: Severity.Info,
                message: '🔍 Searching...'
            });

            const context = await services.enrichWithWebSearch(query);

            if (context) {
                notificationService.notify({
                    severity: Severity.Info,
                    message: '✅ Search results available. Open Chat to see details.'
                });
            } else {
                notificationService.notify({
                    severity: Severity.Info,
                    message: 'No results found.'
                });
            }
        } catch (error) {
            notificationService.notify({
                severity: Severity.Error,
                message: `Search failed: ${error}`
            });
        }
    }
});
