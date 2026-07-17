import {Order, OrderSchema, SearchFilter} from "./types.js";
import Schema from "typebox/schema";

export interface SearchAdapter<T> {
    search(filter: SearchFilter): Promise<T[]>;
}

export class InMemorySearchAdapter implements SearchAdapter<Order> {
    constructor(private readonly orders: Order[]) {
    }

    search(filter: SearchFilter): Promise<Order[]> {
        const compiledSchema = Schema.Compile(OrderSchema);
        const filteredOrders: Order[] = [];
        for (const sampleOrder of this.orders) {
            if (!compiledSchema.Check(sampleOrder)) {
                continue;
            }
            if (filter.destination && filter.destination.province !== sampleOrder.destination.province) {
                continue;
            }
            if (Array.isArray(filter.fulfillmentStatuses) && !filter.fulfillmentStatuses.includes(sampleOrder.fulfillmentStatus)) {
                continue;
            }
            if (filter.stuckForMinutes && ("gte" in filter.stuckForMinutes || "lte" in filter.stuckForMinutes)) {
                if ("gte" in filter.stuckForMinutes && !(sampleOrder.minutesInCurrentStatus >= filter.stuckForMinutes.gte)) {
                    continue;
                }
                if ("lte" in filter.stuckForMinutes && !(sampleOrder.minutesInCurrentStatus <= filter.stuckForMinutes.lte)) {
                    continue;
                }
            }
            if (filter.createdWithinHours !== undefined && !(sampleOrder.createdHoursAgo <= filter.createdWithinHours)) {
                continue;
            }

            filteredOrders.push(sampleOrder);
        }
        return Promise.resolve(filteredOrders.slice(0, filter.limit));
    }
}