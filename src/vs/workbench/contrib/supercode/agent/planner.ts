/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Agentic Planner for Multi-Step Tasks
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';

// ============================================================================
// TYPES
// ============================================================================

export type PlanStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PlanStep {
    id: string;
    description: string;
    tool: string;
    params: Record<string, unknown>;
    status: PlanStepStatus;
    result?: string;
    error?: string;
    dependsOn?: string[];
}

export interface ExecutionPlan {
    id: string;
    goal: string;
    steps: PlanStep[];
    currentStepIndex: number;
    status: 'planning' | 'executing' | 'completed' | 'failed' | 'awaiting_approval';
    createdAt: number;
    completedAt?: number;
}

export interface ToolDefinition {
    name: string;
    description: string;
    requiresApproval: boolean;
    execute: (params: Record<string, unknown>) => Promise<string>;
}

// ============================================================================
// AGENTIC PLANNER SERVICE
// ============================================================================

export class AgenticPlannerService {
    private _plans: Map<string, ExecutionPlan> = new Map();
    private _tools: Map<string, ToolDefinition> = new Map();
    private _pendingApproval: PlanStep | null = null;

    constructor(
        @ILogService private readonly logService: ILogService
    ) {
        this.registerDefaultTools();
        this.logService.info('[AgenticPlanner] Service initialized');
    }

    // ========================================================================
    // TOOL REGISTRATION
    // ========================================================================

    private registerDefaultTools(): void {
        this.registerTool({
            name: 'read_file',
            description: 'Read contents of a file',
            requiresApproval: false,
            execute: async (params) => `[File content of ${params.path}]`
        });

        this.registerTool({
            name: 'write_file',
            description: 'Write content to a file',
            requiresApproval: true, // Destructive action
            execute: async (params) => `Wrote to ${params.path}`
        });

        this.registerTool({
            name: 'run_command',
            description: 'Run a terminal command',
            requiresApproval: true, // Potentially dangerous
            execute: async (params) => `Executed: ${params.command}`
        });

        this.registerTool({
            name: 'search_web',
            description: 'Search the web for information',
            requiresApproval: false,
            execute: async (params) => `[Web search results for: ${params.query}]`
        });

        this.registerTool({
            name: 'analyze_code',
            description: 'Analyze code structure',
            requiresApproval: false,
            execute: async (params) => `[Analysis of ${params.file}]`
        });
    }

    public registerTool(tool: ToolDefinition): void {
        this._tools.set(tool.name, tool);
    }

    // ========================================================================
    // PLAN GENERATION
    // ========================================================================

    /**
     * Generate a plan from a goal description
     */
    public generatePlan(goal: string, context: string): ExecutionPlan {
        const planId = this.generateId();
        const steps = this.decomposeToPlan(goal, context);

        const plan: ExecutionPlan = {
            id: planId,
            goal,
            steps,
            currentStepIndex: 0,
            status: 'planning',
            createdAt: Date.now()
        };

        this._plans.set(planId, plan);
        this.logService.info(`[AgenticPlanner] Generated plan with ${steps.length} steps`);

        return plan;
    }

    private decomposeToPlan(goal: string, context: string): PlanStep[] {
        const steps: PlanStep[] = [];
        const lowerGoal = goal.toLowerCase();

        // Pattern-based plan generation
        if (lowerGoal.includes('create') || lowerGoal.includes('generate')) {
            steps.push({
                id: this.generateId(),
                description: 'Analyze requirements',
                tool: 'analyze_code',
                params: { query: goal },
                status: 'pending'
            });
            steps.push({
                id: this.generateId(),
                description: 'Generate code',
                tool: 'write_file',
                params: { content: 'generated' },
                status: 'pending',
                dependsOn: [steps[0].id]
            });
        }

        if (lowerGoal.includes('debug') || lowerGoal.includes('fix')) {
            steps.push({
                id: this.generateId(),
                description: 'Read file to analyze',
                tool: 'read_file',
                params: {},
                status: 'pending'
            });
            steps.push({
                id: this.generateId(),
                description: 'Identify issue',
                tool: 'analyze_code',
                params: {},
                status: 'pending',
                dependsOn: [steps[0].id]
            });
            steps.push({
                id: this.generateId(),
                description: 'Apply fix',
                tool: 'write_file',
                params: {},
                status: 'pending',
                dependsOn: [steps[1].id]
            });
        }

        if (lowerGoal.includes('test')) {
            steps.push({
                id: this.generateId(),
                description: 'Generate test cases',
                tool: 'analyze_code',
                params: { type: 'test_generation' },
                status: 'pending'
            });
            steps.push({
                id: this.generateId(),
                description: 'Write test file',
                tool: 'write_file',
                params: {},
                status: 'pending',
                dependsOn: [steps[0].id]
            });
            steps.push({
                id: this.generateId(),
                description: 'Run tests',
                tool: 'run_command',
                params: { command: 'npm test' },
                status: 'pending',
                dependsOn: [steps[1].id]
            });
        }

        if (lowerGoal.includes('search') || lowerGoal.includes('find')) {
            steps.push({
                id: this.generateId(),
                description: 'Search for information',
                tool: 'search_web',
                params: { query: goal },
                status: 'pending'
            });
        }

        // Default: single analysis step
        if (steps.length === 0) {
            steps.push({
                id: this.generateId(),
                description: 'Analyze and respond',
                tool: 'analyze_code',
                params: { query: goal },
                status: 'pending'
            });
        }

        return steps;
    }

    // ========================================================================
    // PLAN EXECUTION
    // ========================================================================

    /**
     * Execute the next step in the plan
     */
    public async executeNextStep(planId: string): Promise<{ completed: boolean; needsApproval: boolean; step?: PlanStep }> {
        const plan = this._plans.get(planId);
        if (!plan) {
            throw new Error('Plan not found');
        }

        if (plan.currentStepIndex >= plan.steps.length) {
            plan.status = 'completed';
            plan.completedAt = Date.now();
            return { completed: true, needsApproval: false };
        }

        const step = plan.steps[plan.currentStepIndex];
        const tool = this._tools.get(step.tool);

        if (!tool) {
            step.status = 'failed';
            step.error = `Unknown tool: ${step.tool}`;
            return { completed: false, needsApproval: false, step };
        }

        // Check if approval is needed
        if (tool.requiresApproval && step.status === 'pending') {
            this._pendingApproval = step;
            plan.status = 'awaiting_approval';
            return { completed: false, needsApproval: true, step };
        }

        // Execute the step
        step.status = 'running';
        plan.status = 'executing';

        try {
            step.result = await tool.execute(step.params);
            step.status = 'completed';
            plan.currentStepIndex++;
            this.logService.info(`[AgenticPlanner] Completed step: ${step.description}`);
        } catch (error) {
            step.status = 'failed';
            step.error = error instanceof Error ? error.message : String(error);
            plan.status = 'failed';
            this.logService.error(`[AgenticPlanner] Step failed: ${step.error}`);
        }

        return { completed: false, needsApproval: false, step };
    }

    /**
     * Approve pending step
     */
    public approvePendingStep(): void {
        if (this._pendingApproval) {
            this._pendingApproval.status = 'pending'; // Reset to pending so it can execute
            this._pendingApproval = null;
        }
    }

    /**
     * Reject pending step
     */
    public rejectPendingStep(): void {
        if (this._pendingApproval) {
            this._pendingApproval.status = 'skipped';
            this._pendingApproval = null;
        }
    }

    /**
     * Execute entire plan
     */
    public async executePlan(planId: string, approvalCallback?: (step: PlanStep) => Promise<boolean>): Promise<ExecutionPlan> {
        const plan = this._plans.get(planId);
        if (!plan) throw new Error('Plan not found');

        while (plan.currentStepIndex < plan.steps.length) {
            const result = await this.executeNextStep(planId);

            if (result.completed) break;

            if (result.needsApproval && result.step) {
                if (approvalCallback) {
                    const approved = await approvalCallback(result.step);
                    if (approved) {
                        this.approvePendingStep();
                    } else {
                        this.rejectPendingStep();
                        plan.currentStepIndex++;
                    }
                } else {
                    // No callback, skip approval-required steps
                    plan.currentStepIndex++;
                }
            }

            if (plan.status === 'failed') break;
        }

        return plan;
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    public getPlan(planId: string): ExecutionPlan | undefined {
        return this._plans.get(planId);
    }

    public formatPlanForDisplay(plan: ExecutionPlan): string {
        let output = `## Plan: ${plan.goal}\n\n`;
        output += `Status: ${plan.status}\n\n`;
        output += `### Steps:\n`;

        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];
            const icon = step.status === 'completed' ? '✅' :
                step.status === 'running' ? '🔄' :
                    step.status === 'failed' ? '❌' :
                        step.status === 'skipped' ? '⏭️' : '⏳';

            output += `${i + 1}. ${icon} ${step.description}\n`;
            if (step.error) output += `   Error: ${step.error}\n`;
        }

        return output;
    }

    private generateId(): string {
        return 'step_' + Math.random().toString(36).substring(2, 9);
    }
}
