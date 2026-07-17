# AI-Powered Fulfillment Search Demo

This folder contains the small TypeScript demo for Assignment 2.

The demo shows how a natural-language fulfillment search request can be converted into a validated structured filter before it is used by the application search layer.

The AI response is mocked. No real AI API key or external service is required.

## Requirements

- Node.js 20 or later
- npm

## Install

```bash
npm install
```

## Run The Demo

```bash
npm run demo
```

The demo should:

1. Read a sample natural-language fulfillment search request.
2. Build the AI instruction used for the request.
3. Return a mock AI-generated structured filter.
4. Validate the AI output against the allowed schema.
5. Print the interpreted filter and matching sample orders.

## Sample Input

```json
{
  "query": "Show orders going to Bangkok that have been stuck in picking for more than two hours during the last 24 hours",
  "locale": "en"
}
```

## Expected AI Output Shape

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

## Validation And Error Handling

The demo validates both the user input and the mocked AI output before running the search.

1. User input is checked against the natural-language search input schema.
2. The mocked AI output is checked against the supported search filter schema.
3. Unsupported requests return `UNSUPPORTED_REQUEST`.
4. Invalid AI responses return `INVALID_AI_RESPONSE`.
5. AI provider failures would return `AI_UNAVAILABLE` in a real integration.

If validation fails, the demo stops before searching and prints a structured error. In a product flow, the user should fall back to the standard filter UI or rephrase the request.

## Notes

- The AI output is treated as untrusted data.
- The application validates the output before using it.
- The AI does not generate SQL or datastore-specific query syntax.
- The AI does not read customer records or execute searches directly.
- If the AI output is invalid or unavailable, the user should fall back to the standard filter UI.
