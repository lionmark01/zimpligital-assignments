import {getAIInstruction} from "./prompt.js";
import {completionAPI} from "./ai-client.js";
import {sampleOrders, sampleSearchInput} from "./sample-data.js";
import Schema from "typebox/schema";
import {NaturalLanguageSearchInputSchema, type SearchFilter} from "./types.js";
import {InMemorySearchAdapter} from "./search-adapter.js";
import {AIUnavailableError, InvalidAIResponseError, UnsupportedRequestError} from "./errors.js";

const compiledNaturalLanguageSearchInputSchema = Schema.Compile(NaturalLanguageSearchInputSchema);
if (!compiledNaturalLanguageSearchInputSchema.Check(sampleSearchInput)) {
    console.error({
        error: "BAD_INPUT",
        message: "Invalid search input format"
    });
    process.exit(1);
}

const aiInstruction = getAIInstruction();
const completedPrompt = `${aiInstruction}\n\nUser: ${sampleSearchInput.query}`;

let searchFilterFromCompletionAPI: SearchFilter;
try {
    searchFilterFromCompletionAPI = await completionAPI(completedPrompt);
    console.log("Search filter from completion API:");
    console.log(searchFilterFromCompletionAPI);
} catch (e: unknown) {
    if (e instanceof UnsupportedRequestError) {
        console.error({
            error: "UNSUPPORTED_REQUEST",
            message: e.message
        });
    } else if (e instanceof InvalidAIResponseError) {
        console.error({
            error: "INVALID_AI_RESPONSE",
            message: e.message
        });
    } else if (e instanceof AIUnavailableError) {
        console.error({
            error: "AI_UNAVAILABLE",
            message: e.message
        });
    } else {
        console.error({
            error: "UNEXPECTED_ERROR",
            message: "Unexpected error while interpreting the AI search request."
        });
    }
    process.exit(1);
}

const inMemorySearchAdapter = new InMemorySearchAdapter(sampleOrders);
const matchingOrders = await inMemorySearchAdapter.search(searchFilterFromCompletionAPI);

console.log("\nMatched orders:");
console.log(matchingOrders);