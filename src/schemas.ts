import * as z from "zod/v4";
import type { JsonObject, JsonValue, LabelField, LabelFieldOption, NormalizedItem } from "./types.js";

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const labelFieldOptionSchema = z.union([
  z.string().min(1).max(80),
  z.object({
    value: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
  }),
]);

export const labelFieldSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)
      .describe("Machine-readable field id, e.g. label, reason, confidence"),
    label: z.string().min(1).max(60),
    type: z.enum(["text", "textarea", "select", "multi_select", "boolean", "number"]).default("text"),
    required: z.boolean().default(true),
    description: z.string().max(200).optional(),
    placeholder: z.string().max(120).optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(labelFieldOptionSchema).min(1).max(20).optional(),
    defaultValue: jsonValueSchema.optional(),
  })
  .superRefine((field, ctx) => {
    if ((field.type === "select" || field.type === "multi_select") && !field.options?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "select and multi_select fields require options.",
      });
    }
  });

export const createLabelingSessionInputSchema = {
  task_title: z
    .string()
    .min(1)
    .max(80)
    .default("Semantic Labeling")
    .describe("Short title shown at the top of the generated labeling form."),
  task_description: z
    .string()
    .max(500)
    .default("각 항목을 보고 빈칸을 채워 주세요.")
    .describe("Plain-language task description shown in the form."),
  items: z
    .array(jsonValueSchema)
    .min(1)
    .max(500)
    .describe("Array-like data to label. Objects are preserved; primitive values become { value }."),
  item_id_field: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
    .optional()
    .describe("Optional object key to use as a stable item id."),
  display_fields: z
    .array(z.string().min(1).max(80))
    .max(20)
    .optional()
    .describe("Optional object keys to display first in the form."),
  label_fields: z
    .array(labelFieldSchema)
    .min(1)
    .max(8)
    .optional()
    .describe("Fields the human should fill for each item. Defaults to label + confidence + note."),
  expires_in_minutes: z
    .number()
    .int()
    .min(5)
    .max(10080)
    .default(1440)
    .describe("How long the one-time labeling capability remains valid."),
  include_html: z
    .boolean()
    .default(false)
    .describe("Also include the full self-contained HTML in the MCP response. Usually false; use form_url instead."),
};

export const ingestResultInputSchema = {
  result_json: z
    .union([z.string().min(1), z.record(z.string(), jsonValueSchema)])
    .describe("The full JSON content downloaded from the labeling form."),
};

export const inspectSessionInputSchema = {
  session_id: z.string().uuid(),
};

export function normalizeLabelFields(fields: z.infer<typeof labelFieldSchema>[] | undefined): LabelField[] {
  const parsed = (fields?.length ? fields : defaultLabelFields()).map((field) => labelFieldSchema.parse(field));
  const seen = new Set<string>();
  for (const field of parsed) {
    if (seen.has(field.id)) {
      throw new Error(`Duplicate label field id: ${field.id}`);
    }
    seen.add(field.id);
  }

  return parsed.map((field) => ({
    ...field,
    options: field.options?.map(normalizeOption),
    maxLength: field.maxLength ?? (field.type === "textarea" ? 1000 : field.type === "text" ? 160 : undefined),
  }));
}

export function normalizeItems(params: {
  items: JsonValue[];
  itemIdField?: string;
  displayFields?: string[];
}): NormalizedItem[] {
  const ids = new Set<string>();

  return params.items.map((value, index) => {
    const source = toObject(value);
    const id = makeItemId(source, index, params.itemIdField);
    if (ids.has(id)) {
      throw new Error(`Duplicate item id after normalization: ${id}`);
    }
    ids.add(id);
    return {
      id,
      index,
      source,
      display: selectDisplayFields(source, params.displayFields),
    };
  });
}

function defaultLabelFields(): z.infer<typeof labelFieldSchema>[] {
  return [
    {
      id: "label",
      label: "무엇인가요?",
      type: "text",
      required: true,
      description: "사람이 알아볼 수 있는 이름으로 짧게 적어 주세요.",
      placeholder: "예: 에어컨 사진, 고객 불만 메모",
      maxLength: 160,
    },
    {
      id: "confidence",
      label: "얼마나 확실한가요?",
      type: "select",
      required: true,
      description: "헷갈리면 애매를 골라도 됩니다.",
      defaultValue: "medium",
      options: [
        { value: "high", label: "확실" },
        { value: "medium", label: "보통" },
        { value: "low", label: "애매" },
      ],
    },
    {
      id: "note",
      label: "덧붙일 말",
      type: "textarea",
      required: false,
      description: "헷갈린 이유나 같이 보면 좋은 말을 적습니다.",
      placeholder: "필요할 때만",
      maxLength: 1000,
    },
  ];
}

function normalizeOption(option: z.infer<typeof labelFieldOptionSchema>): LabelFieldOption {
  return typeof option === "string" ? { value: option, label: option } : option;
}

function toObject(value: JsonValue): JsonObject {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return { value };
}

function makeItemId(source: JsonObject, index: number, itemIdField?: string): string {
  const rawId = itemIdField ? source[itemIdField] : source.id;
  if (typeof rawId === "string" && rawId.trim()) {
    return rawId.trim();
  }
  if (typeof rawId === "number" && Number.isFinite(rawId)) {
    return String(rawId);
  }
  return `item_${String(index + 1).padStart(4, "0")}`;
}

function selectDisplayFields(source: JsonObject, displayFields?: string[]): JsonObject {
  if (displayFields?.length) {
    const selected: JsonObject = {};
    for (const field of displayFields) {
      if (field in source) {
        selected[field] = source[field] ?? null;
      }
    }
    for (const [key, value] of Object.entries(source)) {
      if (!(key in selected)) {
        selected[key] = value;
      }
    }
    return selected;
  }

  const selected: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "id") {
      continue;
    }
    selected[key] = value;
  }
  return Object.keys(selected).length ? selected : source;
}
