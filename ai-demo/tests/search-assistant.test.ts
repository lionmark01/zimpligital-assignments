import test from "node:test";
import assert from "node:assert/strict";
import Schema from "typebox/schema";
import {completionAPI} from "../src/ai-client.js";
import {UnsupportedRequestError} from "../src/errors.js";
import {sampleOrders} from "../src/sample-data.js";
import {InMemorySearchAdapter} from "../src/search-adapter.js";
import {NaturalLanguageSearchInputSchema, type SearchFilter, SearchFilterSchema} from "../src/types.js";

const compiledNaturalLanguageInputSchema = Schema.Compile(NaturalLanguageSearchInputSchema);
const compiledSearchFilterSchema = Schema.Compile(SearchFilterSchema);

test("Rejects empty natural-language search input", () => {
    const input = {
        query: "   ",
        locale: "en"
    };

    assert.equal(compiledNaturalLanguageInputSchema.Check(input), false);
});

test("Returns a validated search filter for a supported request", async () => {
    const filter = await completionAPI("Show orders going to Bangkok that have been stuck in picking for more than two hours during the last 24 hours");

    assert.equal(compiledSearchFilterSchema.Check(filter), true);
    assert.deepEqual(filter, {
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
    });
});

test("Rejects unsupported fulfillment search requests", async () => {
    await assert.rejects(
        completionAPI("Show delayed orders in Chiang Mai"),
        UnsupportedRequestError
    );
});

test("Rejects unsupported AI filter values", () => {
    const aiResponse = {
        fulfillmentStatuses: [
            "UNKNOWN_STATUS"
        ],
        limit: 50
    };

    assert.equal(compiledSearchFilterSchema.Check(aiResponse), false);
});

test("Rejects unsupported AI filter field", () => {
    const aiResponse = {
        fulfillmentStatuses: [
            "DELIVERED"
        ],
        limit: 50,
        unknownField: "hello"
    };

    assert.equal(compiledSearchFilterSchema.Check(aiResponse), false);
});

test("Rejects AI filters that exceed the maximum limit", () => {
    const aiResponse = {
        fulfillmentStatuses: [
            "PICKING"
        ],
        limit: 999
    };

    assert.equal(compiledSearchFilterSchema.Check(aiResponse), false);
});

test("Rejects AI filters that have a non-integer limit", () => {
    const aiResponse = {
        fulfillmentStatuses: [
            "PICKING"
        ],
        limit: 30.5
    };

    assert.equal(compiledSearchFilterSchema.Check(aiResponse), false);
});

test("Search adapter returns matching orders only", async () => {
    const filter: SearchFilter = {
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
    const searchAdapter = new InMemorySearchAdapter(sampleOrders);

    const orders = await searchAdapter.search(filter);

    assert.deepEqual(
        orders.map((order) => order.id),
        [
            "ORD-1001",
            "ORD-1003"
        ]
    );
});
