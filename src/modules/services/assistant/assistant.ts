import { MealType, MenuGeneratedBy, MessageRole } from '../../../common/constants';
import {
  MacroValues,
  MenuDayDraft,
  MenuIssue,
  NutritionGoalSnapshot,
  PreferenceRules,
} from '../../../common/types';

/** A recipe the planner may put into a menu; already filtered by the profile rules. */
export interface RecipeCandidate {
  id: string;
  name: string;
  mealType: MealType;
  dietType: string[];
  perServing: MacroValues;
  complete: boolean;
}

export interface MenuPlanRequest {
  /** Days to fill, with their dates when the menu is dated. */
  days: Array<{ dayIndex: number; date: Date | null }>;
  /** Meals of every day, in order. */
  mealTypes: MealType[];
  goal: NutritionGoalSnapshot;
  rules: PreferenceRules;
  candidates: RecipeCandidate[];
  /** Errors of the previous proposal; the next one must fix them. Empty on the first attempt. */
  feedback: MenuIssue[];
  /** Free text from the user ("more fish", "quick breakfasts"). */
  instructions: string | null;
}

export interface MenuPlanProposal {
  title: string;
  notes: string | null;
  days: MenuDayDraft[];
}

export interface MealReplacementRequest {
  day: MenuDayDraft;
  /** Position of the meal to replace within `day.meals`. */
  position: number;
  goal: NutritionGoalSnapshot | null;
  rules: PreferenceRules;
  /** Candidates of the meal type of the replaced meal. */
  candidates: RecipeCandidate[];
  feedback: MenuIssue[];
  instructions: string | null;
}

export interface MealReplacementProposal {
  recipeId: string;
  servings: number;
  notes: string | null;
}

export interface ChatMessageInput {
  role: MessageRole;
  content: string;
}

export interface ChatRequest {
  /** Oldest first; the last one is the user message to answer. */
  messages: ChatMessageInput[];
  goal: NutritionGoalSnapshot | null;
  rules: PreferenceRules;
  /** The menu the conversation is about. */
  menu: { id: string; title: string } | null;
}

/**
 * What the assistant asks the backend to do. The assistant never writes to the database: the
 * backend validates the action and runs it through the same services as the API.
 */
export type AssistantAction = {
  type: 'plan_menu';
  days: number;
  mealTypes: MealType[] | null;
  instructions: string | null;
};

export interface ChatReply {
  content: string;
  action: AssistantAction | null;
}

/**
 * The boundary to the language model. `StubAssistant` implements it deterministically until the
 * LLM stage; an LLM implementation replaces it in `AssistantModule` without touching the callers.
 * Proposals are untrusted: callers resolve the recipes, recalculate nutrition and validate them.
 */
export abstract class Assistant {
  /** Stored as `menu_versions.generated_by` for the menus it plans. */
  public abstract readonly generatedBy: MenuGeneratedBy;

  public abstract planMenu(request: MenuPlanRequest): Promise<MenuPlanProposal>;

  public abstract replaceMeal(request: MealReplacementRequest): Promise<MealReplacementProposal>;

  public abstract reply(request: ChatRequest): Promise<ChatReply>;
}
