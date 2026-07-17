import type {NaturalLanguageSearchInput, Order} from "./types.js";

export const sampleSearchInput: NaturalLanguageSearchInput = {
    query: "Show orders going to Bangkok that have been stuck in picking for more than two hours during the last 24 hours",
    locale: "en"
};

export const sampleOrders: Order[] = [
    {
        id: "ORD-1001",
        destination: {
            province: "Bangkok",
        },
        fulfillmentStatus: "PICKING",
        minutesInCurrentStatus: 145,
        createdHoursAgo: 6
    },
    {
        id: "ORD-1002",
        destination: {
            province: "Bangkok",
        },
        fulfillmentStatus: "PACKED",
        minutesInCurrentStatus: 20,
        createdHoursAgo: 3
    },
    {
        id: "ORD-1003",
        destination: {
            province: "Bangkok",
        },
        fulfillmentStatus: "PICKING",
        minutesInCurrentStatus: 130,
        createdHoursAgo: 3
    },
    {
        id: "ORD-1004",
        destination: {
            province: "Chiang Mai",
        },
        fulfillmentStatus: "PICKING",
        minutesInCurrentStatus: 180,
        createdHoursAgo: 8
    }
];