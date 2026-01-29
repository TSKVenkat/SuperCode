/*---------------------------------------------------------------------------------------------
 *  SuperCode - AI-Powered IDE
 *  Agent Module Index - Exports all agentic capabilities
 *--------------------------------------------------------------------------------------------*/

// Configuration
export {
    SUPERCODE_AGENTIC_SETTINGS,
    AgenticSettings,
    TerminalExecutionMode,
    MultiFileConfirmation,
    getAgenticSettings,
    registerAgenticConfiguration
} from './agenticConfiguration.js';

// Response Parser
export {
    AgenticAction,
    AgenticActionType,
    DiffEdit,
    MultiFileEdit,
    ParseResult,
    AgenticResponseParser,
    StreamParser
} from './agenticResponseParser.js';

// Diff Application
export {
    DiffApplyResult,
    RollbackInfo,
    DiffApplyService
} from './diffApplyService.js';

// Multi-File Editing
export {
    PendingEdit,
    EditSessionState,
    EditSessionResult,
    MultiFileEditSession
} from './multiFileEditSession.js';

// Executor Service
export {
    ExecutionProgress,
    ExecutionResult,
    AgenticExecutorService
} from './agenticExecutorService.js';

// Contribution (auto-registers)
export { getAgenticExecutor } from './agenticContribution.js';

// Legacy Planner (for backward compatibility)
export {
    PlanStep,
    PlanStepStatus,
    ExecutionPlan,
    ToolDefinition,
    AgenticPlannerService
} from './planner.js';
