import Schema from "typebox/schema";
import {type SearchFilter, SearchFilterSchema} from "./types.js";
import {InvalidAIResponseError, UnsupportedRequestError} from "./errors.js";

export const completionAPI = async (fulfillmentRequestPrompt: string): Promise<SearchFilter> => {
    if (!fulfillmentRequestPrompt.includes("Bangkok") || !fulfillmentRequestPrompt.includes("picking")) {
        throw new UnsupportedRequestError("The request cannot be safely converted to a supported filter.");
    }
    const resultFromCompletionAPI = {
        destination: {
            province: "Bangkok"
        },
        fulfillmentStatuses: [
            "PICKING"
        ],
        stuckForMinutes: {
            gte: 120
        },
        createdWithinHours: 24,
        limit: 50
    };

    const compiledSchema = Schema.Compile(SearchFilterSchema);
    if (!compiledSchema.Check(resultFromCompletionAPI)) {
        throw new InvalidAIResponseError("The response from AI cannot be safely converted to a supported filter.");
    }
    return resultFromCompletionAPI;
};