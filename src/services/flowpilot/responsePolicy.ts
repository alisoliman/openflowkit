import { inferPlanSteps } from './skills';
import type { AgentPlan, AgentResponseMode, FlowpilotPolicyContext, FlowpilotSkillId } from './types';

const EXPLANATION_PATTERNS = [
  /\bexplain\b/i,
  /\bwhat('?s| is) wrong\b/i,
  /\bwhy\b/i,
  /\breview\b/i,
  /\banalyze\b/i,
  /\bcompare\b/i,
  /^(?:please\s+)?(?:what|why|how|is|are|does|can you explain|could you explain)\b/i,
];

const PLANNING_PATTERNS = [
  /^(?:please\s+)?(?:plan|outline|propose|brainstorm|suggest)\b/i,
  /\b(?:give|show|discuss)\s+(?:me\s+)?(?:a\s+)?(?:plan|strategy|options)\b/i,
  /\bbefore drawing\b/i,
];

const ASSET_PATTERNS = [
  /\bicon\b/i,
  /\basset\b/i,
  /\bcomponent\b/i,
  /\bwhich service\b/i,
  /\bwhat should i use\b/i,
];

const DIAGRAM_PATTERNS = [
  /\bdiagram\b/i,
  /\bdraw\b/i,
  /\bgenerate\b/i,
  /\bcreate\b/i,
  /\bshow\b/i,
  /\bmap\b/i,
];

const EDIT_PATTERNS = [
  /\b(?:change|update|edit|refine|replace|rename|add|remove|delete|insert|connect|disconnect|move|reorder|simplify|recolor|resize|convert|switch)\b/i,
  /^(?:please\s+)?(?:make|turn|use|keep|put|set)\b/i,
];

const ARCHITECTURE_PATTERNS = [
  /\barchitecture\b/i,
  /\baws\b/i,
  /\bazure\b/i,
  /\bgcp\b/i,
  /\bkubernetes\b/i,
  /\bcncf\b/i,
  /\binfra\b/i,
  /\bservice\b/i,
];

function matchesAny(prompt: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(prompt));
}

function clampConfidence(value: number): number {
  return Math.max(0.1, Math.min(0.98, Math.round(value * 100) / 100));
}

export function isFlowpilotConfirmation(prompt: string): boolean {
  const normalized = prompt.trim().replace(/[,.!]/g, '').replace(/\s+/g, ' ');
  return /^(?:(?:yes|sure|ok(?:ay)?)(?: please)?|(?:(?:yes|sure|ok(?:ay)?) )?(?:please )?(?:do (?:it|that)|go ahead|apply (?:it|that|the changes|the plan)|proceed|continue|sounds good)(?: please)?)$/i.test(normalized);
}

export function chooseFlowpilotResponseMode(
  context: FlowpilotPolicyContext
): {
  mode: AgentResponseMode;
  confidence: number;
  requiresApproval: boolean;
  reasoningSummary: string;
  skillId: FlowpilotSkillId;
} {
  const normalizedPrompt = context.prompt.trim();
  const hasExplanationIntent = matchesAny(normalizedPrompt, EXPLANATION_PATTERNS);
  const hasPlanningIntent = matchesAny(normalizedPrompt, PLANNING_PATTERNS);
  const hasAssetIntent = matchesAny(normalizedPrompt, ASSET_PATTERNS);
  const hasDiagramIntent = matchesAny(normalizedPrompt, DIAGRAM_PATTERNS);
  const hasEditIntent = matchesAny(normalizedPrompt, EDIT_PATTERNS);
  const hasArchitectureIntent = matchesAny(normalizedPrompt, ARCHITECTURE_PATTERNS);

  if (isFlowpilotConfirmation(normalizedPrompt)) {
    return context.hasPendingPlan ? {
      mode: 'diagram_preview', confidence: 0.95, requiresApproval: true,
      reasoningSummary: 'The user confirmed the previous plan; prepare its changes on the current canvas.',
      skillId: 'create_architecture',
    } : {
      mode: 'clarification', confidence: 0.8, requiresApproval: false,
      reasoningSummary: 'There is no pending plan to apply; ask which change the user wants.',
      skillId: 'answer_question',
    };
  }

  if (hasAssetIntent && !hasDiagramIntent && !hasEditIntent) {
    return {
      mode: 'asset_suggestions',
      confidence: 0.9,
      requiresApproval: false,
      reasoningSummary: 'The request is asking for asset or component guidance before changing the canvas.',
      skillId: 'suggest_assets',
    };
  }

  if (hasExplanationIntent) {
    return {
      mode: 'answer',
      confidence: 0.87,
      requiresApproval: false,
      reasoningSummary: 'The request is asking for analysis of the current diagram rather than a new draft.',
      skillId: 'explain_existing_diagram',
    };
  }

  if (hasPlanningIntent) {
    return {
      mode: 'plan',
      confidence: clampConfidence(hasPlanningIntent ? 0.88 : 0.66),
      requiresApproval: false,
      reasoningSummary: 'The request is underspecified or explicitly asks for a plan before drafting.',
      skillId: 'plan_diagram',
    };
  }

  if (hasEditIntent && context.nodeCount > 0) {
    return {
      mode: 'diagram_preview',
      confidence: 0.9,
      requiresApproval: true,
      reasoningSummary: 'The request modifies the current diagram; preserve everything outside the requested change.',
      skillId: context.selectedNodeCount > 0 ? 'edit_selected_nodes' : 'create_architecture',
    };
  }

  if (hasArchitectureIntent || hasDiagramIntent || hasEditIntent || context.hasImage) {
    return {
      mode: 'diagram_preview',
      confidence: clampConfidence(hasArchitectureIntent ? 0.92 : 0.84),
      requiresApproval: true,
      reasoningSummary: hasArchitectureIntent
        ? 'The request is architecture-oriented and should ground itself in provider assets before drafting.'
        : 'The request clearly asks for a diagram draft, so a preview is the right next step.',
      skillId: hasArchitectureIntent ? 'create_architecture' : 'plan_diagram',
    };
  }

  return {
    mode: 'answer',
    confidence: 0.62,
    requiresApproval: false,
    reasoningSummary: 'The safest next step is to answer in chat first instead of changing the canvas.',
    skillId: 'answer_question',
  };
}

export function buildFlowpilotPlan(context: FlowpilotPolicyContext): AgentPlan {
  const policy = chooseFlowpilotResponseMode(context);
  const intendedOutput =
    policy.mode === 'diagram_preview'
      ? 'Canvas preview with review/apply controls'
      : policy.mode === 'asset_suggestions'
        ? 'Recommended local asset matches'
        : policy.mode === 'plan'
          ? 'Structured plan and next-step options'
          : 'Chat response';

  return {
    goal: context.prompt.trim(),
    mode: policy.mode,
    steps: inferPlanSteps(policy.skillId, context),
    requiresApproval: policy.requiresApproval,
    intendedOutput,
    confidence: policy.confidence,
    reasoningSummary: policy.reasoningSummary,
    skillId: policy.skillId,
  };
}
