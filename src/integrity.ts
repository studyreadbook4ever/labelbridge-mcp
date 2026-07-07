import { sha256Json } from "./canonical.js";
import type { JsonValue, LabelField, NormalizedItem } from "./types.js";

export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function labelSchemaHash(labelFields: LabelField[]): string {
  return sha256Json(toJsonValue(labelFields));
}

export function itemSourceHash(item: Pick<NormalizedItem, "id" | "index" | "source">): string {
  return sha256Json(toJsonValue({ id: item.id, index: item.index, source: item.source }));
}

export function batchHashForSession(params: {
  taskTitle: string;
  taskDescription: string;
  labelFields: LabelField[];
  items: Pick<NormalizedItem, "id" | "index" | "source">[];
}): string {
  return sha256Json(
    toJsonValue({
      task_title: params.taskTitle,
      task_description: params.taskDescription,
      schema_hash: labelSchemaHash(params.labelFields),
      items: params.items.map((item) => ({
        id: item.id,
        index: item.index,
        source_hash: itemSourceHash(item),
      })),
    }),
  );
}
