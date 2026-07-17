import {Type} from "typebox";

export const FulfillmentStatusSchema = Type.Union([
    Type.Literal("RECEIVED"),
    Type.Literal("RESERVING"),
    Type.Literal("PICKING"),
    Type.Literal("PACKED"),
    Type.Literal("SHIPPED"),
    Type.Literal("DELIVERED"),
    Type.Literal("FAILED")
]);
export const LocaleSchema = Type.Union(
    [
        Type.Literal("th"),
        Type.Literal("en")
    ]
);

export const NaturalLanguageSearchInputSchema = Type.Object({
    query: Type.String({ minLength: 1, pattern: "\\S" }),
    locale: Type.Optional(LocaleSchema)
}, {
    additionalProperties: false
});
export const SearchFilterSchema = Type.Object({
    destination: Type.Optional(
        Type.Object({
            province: Type.String({ minLength: 1, pattern: "\\S" })
        }, {
            additionalProperties: false
        })
    ),
    fulfillmentStatuses: Type.Optional(Type.Array(FulfillmentStatusSchema)),
    stuckForMinutes: Type.Optional(
        Type.Union([
            Type.Object({
                gte: Type.Integer({ minimum: 1, maximum: 300 })
            }, {
                additionalProperties: false
            }),
            Type.Object({
                lte: Type.Integer({ minimum: 1, maximum: 300 })
            }, {
                additionalProperties: false
            })
        ])
    ),
    createdWithinHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 48 })),
    limit: Type.Integer({ minimum: 10, maximum: 50 })
}, {
    additionalProperties: false
});

export const OrderSchema = Type.Object({
    id: Type.String({ minLength: 1, pattern: "\\S" }),
    destination: Type.Object({
        province: Type.String({ minLength: 1, pattern: "\\S" })
    }, {
        additionalProperties: false
    }),
    fulfillmentStatus: FulfillmentStatusSchema,
    minutesInCurrentStatus: Type.Integer({ minimum: 0 }),
    createdHoursAgo: Type.Integer({ minimum: 0 })
}, {
    additionalProperties: false
});

export type FulfillmentStatus = Type.Static<typeof FulfillmentStatusSchema>;
export type Locale = Type.Static<typeof LocaleSchema>;
export type NaturalLanguageSearchInput = Type.Static<typeof NaturalLanguageSearchInputSchema>;
export type SearchFilter = Type.Static<typeof SearchFilterSchema>;
export type Order = Type.Static<typeof OrderSchema>;