import type {
  Card,
  CardPriority,
  TaskRecommendation,
  TaskScoreFactor,
} from "./types.js";

const priorityWeights: Record<CardPriority, number> = {
  low: 4,
  normal: 8,
  high: 14,
  urgent: 20,
  critical: 26,
};

function normalized(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function factor(
  key: TaskScoreFactor["key"],
  score: number,
  explanation: string,
): TaskScoreFactor {
  return { key, score, explanation };
}

export function isActionable(card: Card): boolean {
  return !card.blocked && card.dependencies.every((dependency) => dependency.satisfied);
}

export function scoreCard(card: Card, actorId?: string): TaskRecommendation | null {
  if (!isActionable(card)) return null;

  const factors: TaskScoreFactor[] = [
    factor("priority", priorityWeights[card.priority], `${card.priority} priority`),
    factor("urgency", normalized(card.urgency, 10) * 1.5, `urgency ${card.urgency}/10`),
    factor("phase_fit", normalized(card.phaseFit, 10), `phase fit ${card.phaseFit}/10`),
    factor(
      "release_impact",
      normalized(card.releaseImpact, 10) * 1.2,
      `release impact ${card.releaseImpact}/10`,
    ),
    factor(
      "critical_path",
      card.criticalPath ? 12 : 0,
      card.criticalPath ? "unblocks the critical path" : "not on the critical path",
    ),
    factor(
      "existing_progress",
      normalized(card.progress, 100) * 0.08,
      `${card.progress}% already complete`,
    ),
    factor(
      "context_readiness",
      normalized(card.contextReadiness, 10),
      `context readiness ${card.contextReadiness}/10`,
    ),
    factor(
      "ownership",
      actorId !== undefined && card.assignedActorId === actorId ? 8 : 0,
      actorId !== undefined && card.assignedActorId === actorId
        ? "assigned to the current actor"
        : "not assigned to the current actor",
    ),
    factor(
      "complexity",
      -normalized(card.complexity, 10) * 0.6,
      `complexity ${card.complexity}/10 reduces short-term fit`,
    ),
  ];

  const score = factors.reduce((total, item) => total + item.score, 0);
  const strongest = [...factors]
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => item.explanation);

  return {
    cardId: card.id,
    title: card.title,
    score: Number(score.toFixed(2)),
    factors,
    reason: strongest.join(", "),
  };
}

export function recommendNextCards(
  cards: readonly Card[],
  actorId?: string,
  limit = 3,
): TaskRecommendation[] {
  if (!Number.isInteger(limit) || limit < 1) return [];

  return cards
    .map((card) => scoreCard(card, actorId))
    .filter((recommendation): recommendation is TaskRecommendation => recommendation !== null)
    .sort((left, right) => right.score - left.score || left.cardId.localeCompare(right.cardId))
    .slice(0, limit);
}
