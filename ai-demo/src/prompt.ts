export const getAIInstruction = (): string => {
    return `
    Convert the user's fulfillment search request into the provided JSON schema.

    Supported output JSON:
    {
      destination?: { province: string, min length: 1, must have at least one non-whitespace character },
      fulfillmentStatuses?: one of ["RECEIVED", "RESERVING", "PICKING", "PACKED", "SHIPPED", "DELIVERED", "FAILED"],
      stuckForMinutes?: { gte: integer, min 1, max 300 } or { lte: integer, min 1, max 300 },
      createdWithinHours?: integer, min 1, max 48,
      limit: integer, min 10, max 50
    }
    
    Error output JSON:
    {
        error: "UNSUPPORTED_REQUEST",
        message: string
    }

    Rules:
    - Use only supported fields and values.
    - Do not generate SQL or database-specific syntax.
    - Do not invent values that are not present in the request.
    - Use a default limit of 50.
    - The maximum limit is 50.
    - If the request is ambiguous or cannot be represented safely, return an error.
    - Return JSON only.
    `;
};