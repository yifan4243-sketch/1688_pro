# Ozon Required Attribute Autofill

Desktop Ozon draft generation owns required category-attribute completion.
Opening the editor or pressing its AI button is not part of the normal success
path.

## Completion Contract

- Preserve valid existing values and system-owned defaults first.
- Load the complete live Ozon dictionary for every remaining dictionary
  attribute. Candidate IDs are scoped to the selected description category and
  type.
- Send all retained 1688 source rows, category metadata, and real candidates to
  the configured AI at temperature zero.
- Require one response per missing required attribute. Dictionary responses are
  accepted only when their ID belongs to the supplied candidate set.
- Retry only unresolved or invalid attributes, for at most three total
  attempts. Never replace an invalid ID with a fuzzy or first-result match.
- Apply accepted common category values to every SKU and then recompute missing
  requirements.

Successful drafts expose `generated.attribute_completion.status = "filled"`.
Failures expose `status = "unresolved"`, the attempt count, and per-attribute
decisions. The desktop queue maps remaining failures to `needs_manual` with the
specific AI or Ozon API reason. Manual completion remains an exception retry
and calls the same backend engine.

## Diagnostic Shape

```ts
{
  status: "filled" | "unresolved";
  attempts: number;
  decisions: Array<{
    attribute_id: number;
    status: "filled" | "invalid" | "unresolved";
    value_text?: string;
    dictionary_value_id?: number;
    source: "existing" | "system" | "ai";
    attempts: number;
    reason: string;
  }>;
  unresolved: Array<{ attribute_id: number; name: string; reason: string }>;
}
```

This workflow prepares drafts only. It never authorizes or performs an Ozon
listing submission.
