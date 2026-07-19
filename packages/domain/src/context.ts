import type { ContextItem, ContextPacket, ContextPacketEntry, EntityId } from "./types.js";

const categoryWeight: Record<ContextItem["category"], number> = {
  architecture: 12,
  blocker: 30,
  coding_convention: 10,
  command: 8,
  current_state: 25,
  deployment: 10,
  discovery: 12,
  environment: 8,
  important_file: 14,
  known_limitation: 18,
  open_question: 15,
  project_summary: 28,
  risk: 17,
  testing: 12,
  warning: 32,
};

const confidenceWeight: Record<ContextItem["confidence"], number> = {
  high: 8,
  medium: 3,
  low: -4,
};

function estimateTokens(item: ContextItem): number {
  return Math.max(1, Math.ceil((item.title.length + item.content.length) / 4));
}

function rankItem(item: ContextItem, cardId?: EntityId): ContextPacketEntry {
  const related = cardId !== undefined && item.relatedCardIds.includes(cardId);
  const score = categoryWeight[item.category] + confidenceWeight[item.confidence] + (related ? 35 : 0);
  const reason = related
    ? `directly related ${item.category.replaceAll("_", " ")}`
    : `${item.confidence}-confidence ${item.category.replaceAll("_", " ")}`;

  return { item, score, estimatedTokens: estimateTokens(item), reason };
}

export function buildContextPacket(
  items: readonly ContextItem[],
  options: { boardId: EntityId; cardId?: EntityId; tokenBudget?: number },
): ContextPacket {
  const budget = Math.max(128, options.tokenBudget ?? 2_000);
  const ranked = items
    .filter((item) => item.boardId === options.boardId && item.status === "active")
    .map((item) => rankItem(item, options.cardId))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.updatedAt.localeCompare(left.item.updatedAt) ||
        left.item.id.localeCompare(right.item.id),
    );

  const entries: ContextPacketEntry[] = [];
  let estimatedTokens = 0;

  for (const entry of ranked) {
    if (estimatedTokens + entry.estimatedTokens > budget) continue;
    entries.push(entry);
    estimatedTokens += entry.estimatedTokens;
  }

  return {
    boardId: options.boardId,
    ...(options.cardId === undefined ? {} : { cardId: options.cardId }),
    entries,
    estimatedTokens,
    omittedCount: ranked.length - entries.length,
  };
}
