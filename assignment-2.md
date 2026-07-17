# Assignment 2: AI-Powered Fulfillment Search Assistant

## 1. Problem

Fulfillment operations teams often need to find a specific group of orders quickly, but the available search tools usually require knowledge of internal fields, status codes and advanced filtering rules.

For example, a user may want to search for:

> Orders going to Bangkok that have been stuck in picking for more than two hours.

Without assistance, the user may need to understand several internal filters and combine them correctly.

This feature allows the user to describe the search in natural language. The AI converts the request into a structured filter that the application can validate and use with the existing search system.

The AI does not query the database directly and does not generate database-specific query syntax.

## 2. Target User

The primary user is:

- Fulfillment operations staff monitoring delayed or failed orders.

This user understands the business problem they want to investigate, but they may not know the internal field names or advanced search syntax.

## 3. Product Context

The feature is added to the existing order or fulfillment search page in the back-office product.

The page still keeps the normal filter controls. The AI search box is an additional way to create those filters.

## 4. AI Capability

The AI performs one limited task:

> Convert a natural-language fulfillment search request into a supported structured filter.

Example user request:

```text
Show orders going to Bangkok that have been stuck in picking for more than two hours during the last 24 hours.
```

Example AI output:

```json
{
  "destination": {
    "province": "Bangkok"
  },
  "fulfillmentStatuses": ["PICKING"],
  "stuckForMinutes": {
    "gte": 120
  },
  "createdWithinHours": 24,
  "limit": 50
}
```

The AI is not allowed to:

- Generate or execute raw SQL or datastore-specific queries.
- Change, cancel, allocate or update orders.
- Decide which records the user is authorized to access.
- Add unsupported fields or operators.
- Return an unlimited result set.

## 5. Demo

The runnable TypeScript demo is included in ai-demo/. It contains the prompt, mock AI output, input/output types, validation, error handling and sample data. See ai-demo/README.md for setup and run instructions.

## 6. Explanation

### Why This Feature Is Valuable

The feature reduces the time required to build complex operational searches.

It also lowers the need for operations users to understand internal status codes, field names or query syntax.

The normal filter interface remains available, so the AI feature improves usability without replacing the existing deterministic search capability.

### What Data Is Sent to AI

The minimum required data is sent:

- The user's natural-language search request.
- The supported filter schema.
- Allowed status values and operators.
- Optional language or timezone context when needed.

The AI does not need the full order dataset to interpret the request.

### What Data Should Not Be Sent to AI

The following data should not be sent unless it is required and approved:

- Customer names.
- Phone numbers.
- Email addresses.
- Full delivery addresses.
- Payment information.
- Authentication tokens.
- Internal secrets.
- Complete order or shipment records.

User authorization rules should also not be delegated to the AI.

### How the AI Output Is Used

The AI output is treated as an untrusted suggestion.

The application:

1. Validates it against a strict schema.
2. Applies product limits and authorization rules.
3. Displays the interpreted filters to the user.
4. Passes the validated filter to the existing deterministic search layer.

The AI never executes a database query directly.

### Whether Human Approval Is Required

The user should be able to review and edit the interpreted filters before running the search.

Human approval is not required for every low-risk search if the product immediately displays the interpreted filters and the action is read-only. However, the feature must never use the interpreted result to perform write actions automatically.

### Guardrails

Required guardrails include:

- Strict schema validation.
- Allowlisted fields and values.
- Result-size and time-range limits.
- Authorization is applied outside the AI layer.
- No raw SQL or datastore query generation.
- No write operations.

### What Happens If AI Is Wrong or Unavailable

If the AI produces invalid output, the request is rejected and the user is asked to rephrase it or use the standard filters.

If the AI produces a valid but incorrect interpretation, the displayed filters allow the user to correct it before or after running the search.

If the AI provider is unavailable, the existing deterministic search interface remains available. The core product workflow is therefore not dependent on AI availability.

### How Success Would Be Evaluated

Possible success metrics include:

- Percentage of AI-generated filters accepted without manual changes.
- Search success rate.
- Time required to find the correct order set.
- Reduction in the use of advanced manual filters.
- Number of user corrections after interpretation.
- Invalid-output and unsupported-request rate.
- AI availability and response latency.
- User satisfaction from operations teams.

A small pilot should compare AI-assisted search with the existing filter interface for the same operational tasks.
