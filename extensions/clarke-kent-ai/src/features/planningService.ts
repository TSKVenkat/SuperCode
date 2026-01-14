import * as vscode from 'vscode';
import axios from 'axios';

export interface PlanStep {
    id: string;
    description: string;
    command?: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
}

export interface Plan {
    id: string;
    goal: string;
    steps: PlanStep[];
}

export class PlanningService {
    private context: vscode.ExtensionContext;
    private currentPlan: Plan | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async createPlan(goal: string): Promise<Plan> {
        const apiKey = await this.context.secrets.get('clarkeKent.openRouterApiKey');
        if (!apiKey) {
            throw new Error('OpenRouter API key not found. Please set it using the "Clarke Kent: Set OpenRouter API Key" command.');
        }

        const model = vscode.workspace.getConfiguration('clarkeKent').get('model', 'anthropic/claude-3.5-sonnet');

        const systemPrompt = `You are an expert software architect and project manager. Your goal is to break down a complex coding task into a series of clear, actionable steps.
        
        Output the plan as a JSON object with the following structure:
        {
            "goal": "The overall goal",
            "steps": [
                {
                    "id": "step-1",
                    "description": "Description of the step",
                    "command": "Optional terminal command to execute (e.g., 'npm install', 'mkdir src')",
                    "status": "pending"
                }
            ]
        }
        
        Keep steps granular and logical. If a step involves writing code, describe what needs to be created or modified.`;

        try {
            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Create a plan for: ${goal}` }
                ],
                response_format: { type: 'json_object' }
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/supercode-ide/supercode',
                    'X-Title': 'SuperCode IDE'
                }
            });

            const content = response.data.choices[0].message.content;
            const planData = JSON.parse(content);

            this.currentPlan = {
                id: Date.now().toString(),
                goal: planData.goal,
                steps: planData.steps.map((s: any) => ({ ...s, status: 'pending' }))
            };

            return this.currentPlan!;

        } catch (error) {
            console.error('Error creating plan:', error);
            throw new Error('Failed to generate plan. Please try again.');
        }
    }

    getCurrentPlan(): Plan | undefined {
        return this.currentPlan;
    }

    updateStepStatus(stepId: string, status: 'pending' | 'in-progress' | 'completed' | 'failed') {
        if (this.currentPlan) {
            const step = this.currentPlan.steps.find(s => s.id === stepId);
            if (step) {
                step.status = status;
            }
        }
    }
}
