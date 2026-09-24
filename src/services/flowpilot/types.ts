import type { DomainLibraryCategory } from '@/services/domainLibrary';

export type AgentResponseMode =
  | 'answer'
  | 'plan'
  | 'asset_suggestions'
  | 'diagram_preview'
  | 'diagram_apply_ready'
  | 'clarification';

export type AgentThinkingState =
  | 'understanding'
  | 'gathering_context'
  | 'searching_assets'
  | 'planning'
  | 'generating'
  | 'ready'
  | 'error';

export type AssistantThreadItemType =
  | 'user_message'
  | 'assistant_thinking'
  | 'assistant_plan'
  | 'assistant_lookup_result'
  | 'assistant_recommendation'
  | 'assistant_canvas_preview'
  | 'assistant_applied_result'
  | 'assistant_agent_turn'
  | 'assistant_error';

export interface AssetGroundingMatch {
  id: string;
  label: string;
  description: string;
  category: DomainLibraryCategory;
  archProvider?: string;
  archResourceType?: string;
  archIconPackId?: string;
  archIconShapeId?: string;
  providerShapeCategory?: string;
  confidence: number;
  reasoning: string;
}

export interface AgentPlan {
  goal: string;
  mode: AgentResponseMode;
  steps: string[];
  requiresApproval: boolean;
  intendedOutput: string;
  confidence: number;
  reasoningSummary: string;
  skillId: FlowpilotSkillId;
}

export type FlowpilotSkillId =
  | 'answer_question'
  | 'plan_diagram'
  | 'create_architecture'
  | 'edit_selected_nodes'
  | 'upgrade_codebase_import'
  | 'suggest_assets'
  | 'explain_existing_diagram';

export interface FlowpilotSkillDefinition {
  id: FlowpilotSkillId;
  label: string;
  outputMode: AgentResponseMode;
  mutatesCanvas: boolean;
  requiredContexts: Array<'canvas' | 'selection' | 'assets' | 'chat_history'>;
  fallbackBehavior: 'ask_clarifying_question' | 'return_plan' | 'return_answer';
}

export interface AssistantThreadItem {
  id: string;
  role: 'user' | 'model';
  type: AssistantThreadItemType;
  content: string;
  createdAt: string;
  responseMode?: AgentResponseMode;
  thinkingState?: AgentThinkingState;
  summary?: string;
  plan?: AgentPlan;
  assetMatches?: AssetGroundingMatch[];
  previewTitle?: string;
  previewDetail?: string;
  previewStats?: string[];
  applied?: boolean;
  previewStatus?: 'pending' | 'applied' | 'discarded' | 'superseded' | 'undone';
  changes?: DiagramChangeSummary;
  /** Set on `assistant_agent_turn` items; the reply is the content and the canvas changes are `changes`. */
  agentTurn?: AgentTurnState;
}

export type AgentTurnStatus = 'running' | 'waiting' | 'done' | 'stopped' | 'failed' | 'interrupted';

export interface AgentTurnStep {
  callId: string;
  /** A canvas tool name, or ask_user. */
  name: string;
  status: 'started' | 'succeeded' | 'failed';
}

/** `expired`: nobody answered for 10 minutes. `closed`: the turn ended first, by Stop, an error, an interruption or a reload. */
type AgentQuestionStatus = 'waiting' | 'answered' | 'expired' | 'closed';

/** A question from Copilot, or a removal the user has to confirm. Answering one that expired or closed starts a new turn. */
export type AgentTurnQuestion =
  | {
    kind: 'question';
    id: string;
    status: AgentQuestionStatus;
    question: string;
    choices?: string[];
    allowFreeform: boolean;
    answer?: string;
  }
  | {
    kind: 'confirm';
    id: string;
    status: AgentQuestionStatus;
    removedLabels: string[];
    removedCount: number;
    clearsCanvas: boolean;
    approved?: boolean;
  };

export interface AgentTurnState {
  status: AgentTurnStatus;
  steps: AgentTurnStep[];
  questions: AgentTurnQuestion[];
  error?: string;
  /** The user reverted the turn with "Undo Copilot's changes". */
  undone?: boolean;
}

export interface DiagramChange {
  kind: 'node' | 'edge';
  status: 'added' | 'removed' | 'updated';
  label: string;
  previousLabel?: string;
}

export interface DiagramChangeSummary {
  addedCount: number;
  removedCount: number;
  updatedCount: number;
  addedEdgeCount: number;
  removedEdgeCount: number;
  updatedEdgeCount: number;
  /** Nodes that only moved; counted for agent turns. */
  movedCount?: number;
  totalChanges: number;
  details: DiagramChange[];
}

export interface FlowpilotPolicyContext {
  prompt: string;
  nodeCount: number;
  selectedNodeCount: number;
  hasImage?: boolean;
  currentDiagram?: string;
  hasPendingPlan?: boolean;
}
