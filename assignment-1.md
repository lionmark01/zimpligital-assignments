## 1. Assumptions

- The system supports multiple marketplaces, sales channels, warehouses and logistics carriers.
- Payment processing is outside the scope. Orders are assumed to be commercially valid before entering the fulfillment system.
- An order is considered `RECEIVED` only after basic structural validation, duplicate detection and durable persistence succeed.
- `RECEIVED` does not mean the order can definitely be fulfilled. SKU validation, warehouse selection and inventory reservation happen later.
- The system supports splitting one order into multiple fulfillments across different warehouses.
- The base design does not intentionally start partial-order fulfillment. Warehouse execution begins only after all required items are reserved; failures after execution starts are handled as operational exceptions.
- If some items remain unfulfillable after bounded reallocation attempts, the whole order fulfillment fails and successful reservations are released through compensating actions.
- Allocation uses a local inventory availability projection. This projection may be stale, so the warehouse reservation is the final confirmation of stock availability.
- The warehouse system is authoritative for physical inventory and warehouse operations.
- The carrier is authoritative for shipment and delivery status.
- Internal messages use at-least-once delivery. Consumers deduplicate messages by message ID. External side-effecting operations use a stable internal operation ID across technical retries; adapters pass it as the provider idempotency key where supported and use reconciliation for unknown outcomes otherwise.
- Warehouse and carrier status updates are received mainly through webhooks, with polling and reconciliation as a fallback.
- In the base design, one fulfillment produces one shipment. Therefore, a split order may produce multiple tracking numbers.
- Operational dashboards may be eventually consistent.
- The ingestion path is sized and load-tested to sustain 200,000 orders per minute for at least ten minutes. Downstream fulfillment may lag, and queue storage and backlog-drain capacity are sized separately against fulfillment SLAs.
- Capacity estimates assume two order items on average and that approximately 10% of orders require split fulfillment.
- The ingestion path must absorb the full peak. Warehouse and carrier processing may lag behind ingestion because their capacity is externally constrained.
- The initial service target is to acknowledge a durably persisted order within two seconds at p95 during the expected peak.
- Capacity figures in this document are planning estimates. The design must pass load tests at the target rate with headroom before launch.

## 2. High-Level Architecture

```text
Platform / Channel Adapters
          |
          | order placed
          v
Order Module -----------------------> PostgreSQL + Transactional Outbox
                                                ^
                                                |
Fulfillment Orchestrator -----------------------+
   |                                            | workflow state and
   | direct call                                | reservation / execution /
   v                                            | shipment command outbox
Allocation Module                               |
   |                                            v
   | availability lookup                  Outbox Publisher
   v                                            |
Local Inventory Availability                    v
                                         RabbitMQ Queue Broker

Command consumers:
RabbitMQ Queue Broker -- reservation command --> Reservation Module
Reservation Module -- reserve/release items --> Warehouse Adapter

RabbitMQ Queue Broker -- execution command --> Warehouse Execution Module
Warehouse Execution Module -- pick and pack --> Warehouse Adapter

RabbitMQ Queue Broker -- shipment command --> Shipment Module
Shipment Module -- create shipment --> Carrier Adapter

Result event producers:
Reservation Module -------- reservation result event -------> RabbitMQ Queue Broker
Warehouse Execution Module - execution accepted event ------> RabbitMQ Queue Broker
Shipment Module ----------- shipment created event ---------> RabbitMQ Queue Broker

Event consumers:
RabbitMQ Queue Broker --> Fulfillment Orchestrator
RabbitMQ Queue Broker --> Operational Module --> Operational DB --> Operational API

Warehouse Adapter
   |
   | availability webhook, event or polling result
   v
Inventory Availability Sync Module -> Local Inventory Availability

Warehouse Adapter -> Warehouse Webhook Normalizer / Polling Module -> Queue Broker
Carrier Adapter ---> Carrier Webhook Normalizer / Polling Module ---> Queue Broker
```
The queue broker in the diagram is RabbitMQ. The outbox publisher is the relay that reads committed outbox records and publishes order events and workflow commands. Result events that accompany local state changes use the same outbox mechanism; the diagram omits those repeated database arrows for readability.

The initial system is a modular monolith at the code and release level. The same application artifact can run as the order module, fulfillment orchestrator, integration modules, inventory availability sync module, or operational module. These roles are released together initially but can have independent replica counts.

The orchestrator calls allocation directly because it is an internal decision without external side effects. As the workflow advances, reservation, warehouse execution and shipment commands are persisted with workflow state in the transactional outbox and then published to RabbitMQ. Worker results and normalized status updates return as domain events.

Commands use direct exchanges and workload-specific queues. Domain events use a topic exchange, and each consumer group has its own queue. The orchestrator, inventory projection and operational read model therefore receive independent copies of the events they need rather than competing for messages from one shared queue.

The orchestrator creates commands at these workflow boundaries:

- A reservation command is created for each proposed fulfillment after allocation.
- A warehouse execution command is created for each fulfillment only after all active fulfillments have confirmed, unexpired reservations.
- A shipment command is created after the warehouse reports that a fulfillment is packed, package information is available and a carrier service has been selected.

The main workflow is:

```text
Order received
-> Allocation
-> Inventory reservation
-> All-items-reserved check
-> Warehouse execution
-> Picking and packing
-> Shipment creation
-> Shipped
-> Delivered
```

The order-level status is derived from its active fulfillments:

- `RECEIVED`: durably accepted but not allocated.
- `ALLOCATING`: allocation or reservation is in progress.
- `PROCESSING`: all active reservations are confirmed and warehouse execution has started.
- `PARTIALLY_SHIPPED`: at least one, but not all, active fulfillments are shipped.
- `SHIPPED`: all active fulfillments are shipped.
- `PARTIALLY_DELIVERED`: at least one, but not all, active shipments are delivered.
- `DELIVERED`: all active shipments are delivered.
- `FAILED`: fulfillment failed before warehouse execution started.
- `EXCEPTION`: execution has started and the remaining problem requires recovery or operational intervention.

State changes are checked against an explicit transition table. Provider sequence numbers are preferred for external updates. When they are unavailable, the provider event time and current state are used; an older event is retained in the timeline but does not overwrite a newer state. A contradictory event triggers reconciliation instead of being silently discarded.

## 3. Core Services

### Order Module

Responsibilities:

- Receive normalized orders from channel adapters.
- Perform structural validation.
- Enforce order-level idempotency and duplicate detection.
- Persist orders and order items.
- Persist an `OrderReceived` event in the transactional outbox.
- Acknowledge the order only after durable persistence succeeds.

A duplicate order is identified using a source-scoped key such as:

```text
(channel_account_id, external_order_id)
```

The same identity with the same content is treated as an idempotent duplicate. The same identity with conflicting content is treated as an integration conflict.

### Fulfillment Orchestrator

Responsibilities:

- Own the durable long-running workflow state.
- Correlate asynchronous commands and results.
- Invoke allocation.
- Dispatch reservation, warehouse execution and shipment commands.
- Ensure all required items are reserved before warehouse execution starts.
- Track outstanding operations, retries, reallocation attempts, deadlines and compensation.
- Resume safely after the process restarts.
- Validate state transitions and avoid state regression from delayed or out-of-order events.

The orchestrator stores a coordination state, not a duplicate copy of all domain data.

Each allocation attempt receives an `allocation_version`. Reservation results are accepted only when they belong to the current version. Before warehouse execution starts, the orchestrator verifies that every active fulfillment has a confirmed, unexpired reservation with a safety margin. This prevents a delayed result from an older allocation attempt from satisfying the all-items-reserved check.

A partial reservation response causes any confirmed partial quantities to be released before reallocation. Reallocation is bounded to two attempts in the base design. Failure after that moves the order to `FAILED`. Once warehouse execution starts, automatic reallocation is no longer attempted and unresolved failures move the order to `EXCEPTION`.

### Allocation Module

Inputs include:

- Order items and quantities.
- Delivery destination.

The module reads the local inventory availability projection and returns an allocation proposal rather than raw availability data.

The base allocation policy is:

1. Remove warehouses that cannot serve the destination or required constraints.
2. Prefer fewer fulfillment splits where practical.
3. Prefer warehouses closer to the destination.
4. Use remaining inventory balance as a secondary factor.

The allocation result is only a proposal until inventory reservation succeeds.

### Reservation Module

Responsibilities:

- Consume reserve and release commands.
- Call the correct warehouse adapter.
- Create or release inventory reservations.
- Pass the stable internal operation ID to the warehouse adapter.
- Perform only bounded technical retries when the operation is safe to retry.
- Publish the normalized reservation result through the transactional outbox.

The module does not decide whether to reallocate, fail the order, or compensate. Those are workflow decisions owned by the orchestrator.

### Warehouse Execution Module

Responsibilities:

- Consume warehouse execution commands after all required inventory is reserved.
- Submit picking and packing work through the appropriate warehouse adapter.
- Store the external warehouse job ID.
- Publish the normalized execution-accepted or execution-rejected result through the transactional outbox.

Long-running statuses such as `PICKING`, `PACKED`, and `READY_FOR_PICKUP` return through webhook or polling and are processed by the orchestrator.

### Shipment Module

Inputs include:

- Fulfillment ID.
- Selected carrier.
- Origin warehouse.
- Delivery destination.
- Package information.
- Stable internal operation ID.

Responsibilities:

- Consume shipment creation commands.
- Call the selected carrier through the correct adapter.
- Create a shipment.
- Store the external shipment ID and tracking number.
- Publish the normalized shipment-created or shipment-failed result through the transactional outbox.

Carrier selection is kept as an orchestration-level policy. The base policy removes services that cannot serve the destination or package constraints, removes services that cannot meet the promised delivery window, and chooses the lowest-cost remaining service. A configured fallback service may be used when the preferred service is unavailable; otherwise the fulfillment moves to `EXCEPTION`.

Later shipment statuses are normalized by the carrier webhook or polling adapter and published as domain events for the orchestrator and operational module.

### Operational Module

Responsibilities:

- Consume fulfillment events from its own RabbitMQ queue.
- Maintain the operational read model in the operational database.
- Expose order lookup, fulfillment timeline, blocking reason and integration failures through the operational API.
- Monitor projection lag and show when operational data may be stale.

The module is read-only from the workflow perspective. It does not make allocation or fulfillment decisions.

### Integration Operation Handling

Every side-effecting warehouse or carrier request is represented by a durable operation with one of these states:

- `PENDING`: persisted but not sent.
- `SENT`: the request may have reached the provider.
- `CONFIRMED`: the result is known and stored.
- `UNKNOWN`: the request may have succeeded, but the result was not received.
- `FAILED`: the operation is known to have failed.

The orchestrator creates the `PENDING` operation and command outbox record in one transaction. A worker records `SENT` before making the external call. A known response updates the operation, its domain record and the result outbox event in one transaction; a timeout or lost response moves the operation to `UNKNOWN`.

If the provider supports idempotency keys, an `UNKNOWN` operation may be retried using the same operation ID. Otherwise it is reconciled by querying the provider with an external reference or by searching recent provider records. It is not blindly retried because that could create duplicate reservations, warehouse jobs or shipments. If the provider offers no safe lookup mechanism, the operation moves to manual review after bounded reconciliation attempts.

External webhook events are persisted in an inbox before processing. A provider event ID is used for deduplication when available; otherwise the system uses a payload fingerprint scoped by integration and event time. The inbox update, domain state change and outgoing outbox event are committed in one database transaction.

## 4. Main Data Model

### ChannelAccount

Represents one configured marketplace or e-commerce channel account.

Important data includes the channel type, merchant or account identity, credential reference and operational status.

### SKU

Represents the internal product identity used by allocation and fulfillment.

### ExternalSKUMap

Maps a channel-specific or warehouse-specific SKU to an internal SKU. A mapping is scoped by integration because the same external SKU value may refer to different products in different accounts.

### Warehouse

Stores warehouse identity, operational status, service area and supported capabilities.

### InventoryAvailability

Stores the local availability projection for one unique `(warehouse_id, sku_id)` pair.

Important data includes available quantity, source version and last update time. This table is not authoritative; a successful warehouse reservation is still required.

### CarrierService

Represents a configured carrier service, including its service area, package constraints, expected delivery SLA and operational status.

### Order

Represents the original order received from a marketplace or sales channel.

Important data includes:

- Internal order ID.
- Channel account ID and external order ID.
- Destination.
- Promised fulfillment or delivery deadline, where supplied by the channel.
- Overall status.
- Received and updated timestamps.

### OrderItem

Represents an internal SKU and ordered quantity. The original external SKU is retained for traceability, but allocation uses the internal SKU resolved through `ExternalSKUMap`.

### Fulfillment

Represents a group of order items assigned to one warehouse.

Important data includes the warehouse ID, allocation version and current fulfillment status.

### FulfillmentItem

Maps part or all of an order item to a fulfillment.

This entity allows one order item to be split across multiple warehouses when necessary.

### Reservation

Represents one inventory reservation attempt for a fulfillment.

Important data includes:

- Fulfillment and warehouse IDs.
- Allocation version.
- Internal operation ID.
- External reservation ID.
- Status and failure reason.
- Expiration time, where supported.

### ReservationItem

Stores the requested and reserved quantity for each fulfillment item. This supports warehouse responses where some items succeed and others fail.

### WarehouseExecutionJob

Represents one picking and packing submission to a warehouse.

Important data includes:

- Fulfillment ID.
- Internal operation ID.
- External warehouse job ID.
- Current status and failure reason.

### Shipment

Represents the physical delivery created with a carrier.

Important data includes:

- Fulfillment ID.
- Carrier ID.
- Internal operation ID.
- External shipment ID.
- Tracking number.
- Shipment status.
- Shipped and delivered timestamps.

### FulfillmentWorkflow

Stores the orchestration state required to continue a long-running workflow.

Important data includes:

- Order ID.
- Current phase.
- Outstanding operations.
- Retry and reallocation count.
- Current allocation version.
- Deadline and compensation status.
- Optimistic concurrency version.

### IntegrationOperation

Records one durable side-effecting request to a warehouse or carrier.

Important data includes:

- Unique internal operation ID.
- Operation type and target integration.
- Related fulfillment or shipment ID.
- Current operation state.
- Request attempt count and timestamps.
- External reference and last failure reason.

### WebhookInbox

Stores external webhook identity, integration scope, payload reference and processing status. A unique provider event ID is used where available; a scoped payload fingerprint is the fallback deduplication key.

### ProcessedMessage

Records processed message IDs using a unique `(consumer_name, message_id)` key. The record is persisted in the same database transaction as workflow state changes and outgoing outbox messages, allowing redelivered messages to be handled idempotently.

Key invariants include a unique `(channel_account_id, external_order_id)`, a unique internal operation ID, fulfillment-item quantities that do not exceed the source order-item quantity, and only one active allocation version for an order workflow.

## 5. Technology Choices

### TypeScript, Node.js

The company mainly uses TypeScript, so using the same stack reduces the learning curve and operational overhead.

### PostgreSQL

The transactional PostgreSQL database stores business state, workflow state, the local inventory projection, integration operations, outbox records and webhook deduplication records. A separate PostgreSQL database stores the operational read model so dashboard queries do not affect order processing.

It is suitable because the model is relational and requires:

- Transactions.
- Unique constraints.
- Optimistic concurrency control.
- Reliable updates to business state and outbox records in one transaction.

### RabbitMQ

RabbitMQ is used for durable commands and events between modules.

It fits the initial system because the workflow is mainly command-oriented and needs:

- Durable queues.
- Consumer acknowledgements.
- Routing by workload.
- Retry and dead-letter queues.

Kafka may be considered later if long-term event retention, frequent replay or a larger event-stream consumer ecosystem becomes a primary requirement. It is not introduced initially because those capabilities are not required by the base command-oriented workflow.

### Operational Read Model and Metrics

A separate PostgreSQL database is sufficient for indexed lookup by order ID, external order ID and tracking number in the initial design. It can be replaced with a specialized search or analytical store only if measured query volume or query patterns require it.

Prometheus-style metrics and dashboards are used for queue depth, oldest message age, projection lag, error rate and end-to-end latency. Domain-level order lookup comes from the operational read model rather than the metrics system.

## 6. Trade-offs

### Modular Monolith vs Microservices

A modular monolith reduces release, networking and distributed transaction complexity. The same artifact supports multiple process roles with independent replica counts, but all modules are versioned and released together initially.

The trade-off is release coupling and limited failure isolation between modules sharing a process role. Clear module boundaries are kept so that a workload can be extracted later if separate release ownership or stronger failure isolation becomes necessary.

### RabbitMQ vs Kafka

RabbitMQ fits the command-oriented workflow and provides explicit routing, acknowledgements and dead-letter handling. The trade-off is weaker support for long-term event retention and replay compared with Kafka.

### Local Inventory Projection vs Real-Time Warehouse Queries

A local projection avoids querying multiple warehouses for every order and reduces latency and dependency fan-out.

The trade-off is eventual consistency. The design accepts stale reads and relies on reservation as the authoritative confirmation.

### Split Fulfillment vs Operational Simplicity

Split fulfillment improves the chance of fulfilling an order when no single warehouse has all items.

The trade-off is more shipments, tracking numbers, delivery variation, warehouse operations and compensation complexity. The allocator therefore prefers fewer splits where practical.

### Orchestration vs Choreography

A central orchestrator makes the long-running workflow, retries, reallocation and compensation easier to understand.

The trade-off is that the orchestrator can become too complex if unrelated business rules are added to it. Allocation and external side effects remain separate module responsibilities.

### At-Least-Once vs Exactly-Once

At-least-once delivery is realistic when integrating with external warehouses and carriers.

The trade-off is that consumers must handle duplicate messages, and external operations require idempotency keys or reconciliation for unknown outcomes.

### Availability vs Immediate Consistency

The system continues accepting orders during temporary downstream failures and stores work in durable queues.

The trade-off is eventual consistency and possible backlog growth. A queue can absorb a temporary spike, but it cannot solve a permanent capacity shortage in a warehouse or carrier.

## 7. Scaling Plan

The required workload is:

```text
2,000,000 orders per day
~23 orders per second on average

200,000 orders per minute at peak
~3,333 orders per second

Peak traffic is about 144 times the daily average.
A ten-minute peak contains up to 2,000,000 orders.
```

With the stated assumptions, the peak ingestion workload is approximately:

```text
Order transactions:  3,333 per second
Order rows:          3,333 per second
Order item rows:     6,666 per second
Initial outbox rows: 3,333 per second

Minimum initial inserts, excluding indexes and later workflow updates:
~13,000 rows per second
```

A complete workflow is expected to produce roughly 10-15 broker messages, depending on splits and external status updates. If workflows are drained at the peak ingestion rate, this gives an upper-bound planning envelope of approximately 33,000-50,000 messages per second. The actual concurrent rate depends on stage-specific worker throughput and downstream capacity, so the broker and database must be load-tested with a mixed workload rather than extrapolated from order ingestion alone.

The ingestion path must sustain the full peak for at least ten minutes. Durable queues decouple ingestion from downstream processing, whose capacity is constrained by each warehouse and carrier. This does not imply that orders are physically fulfilled at the ingestion rate; queue storage, processing throughput and backlog-drain time must be sized against fulfillment SLAs.

### Order Ingestion

- Keep API instances stateless and horizontally scalable.
- Perform only structural validation and durable persistence before acknowledging an order.
- Do not call warehouse or carrier systems in the ingestion path.
- Use database connection pooling and controlled concurrency.
- Store business state and the `OrderReceived` outbox record in one transaction.
- Keep the ingestion transaction short and avoid synchronous reads from workflow or reporting tables.
- Validate the database, indexes and outbox publisher at the target rate with at least 2x headroom before launch.

### RabbitMQ and Workers

- Use direct exchanges and separate durable command queues for reservation, warehouse execution and shipment creation.
- Publish domain events to a topic exchange with a separate queue for each consumer group.
- Scale consumer replicas using queue depth, oldest message age and processing latency.
- Use dead-letter queues for messages that exceed bounded retry limits.
- Make all consumers idempotent.
- Load test based on message rate, not only order rate, because one order produces multiple commands and events.
- Use publisher confirms and replicated durable queues so accepted messages survive a broker-node failure.
- If one high-volume queue becomes a bottleneck, divide it into a fixed number of queues using a stable hash of order ID. This preserves per-order routing while allowing queue-level parallelism.

### Protect External Systems

Worker count must not exceed the practical capacity of a warehouse or carrier.

Use:

- Per-integration rate limits.
- Concurrency limits.
- Exponential backoff with jitter.
- Circuit breakers.
- Backpressure.
- Progressive recovery after an outage.

If incoming work remains higher than downstream capacity, the system must reroute work, prioritize by SLA, add downstream capacity or accept degraded service. Increasing queue size alone does not solve this problem.

### PostgreSQL

- Add indexes based on actual access patterns, including external order identity, workflow status, operation IDs and external integration IDs.
- Partition high-growth tables where useful, for example by creation time.
- Archive processed outbox and historical integration records according to a retention policy.
- Keep operational reporting queries away from the transactional database.
- Use read replicas only for reads that can tolerate replication lag.
- Scale outbox publishers using safe batch claiming.

The initial design starts with one transactional primary. The estimated 3,333 transactions per second represents order ingestion only, not the total database workload. Capacity must be validated using a mixed workload that includes ingestion, workflow transitions, inbox and outbox processing, integration operations and backlog draining. Separate connection pools and worker backpressure protect ingestion capacity. If load tests cannot meet the target with headroom, order data and its workflow can be sharded by a stable hash of (channel_account_id, external_order_id).

### Inventory Availability Projection

- Key and index the projection by warehouse and SKU.
- Use warehouse-provided sequence or version values to reject stale updates.
- Use incremental webhook updates as the primary path.
- Trigger targeted reconciliation after sequence gaps or processing failures.
- Run rolling periodic reconciliation to detect silent divergence.
- Rate-limit and batch reconciliation work.
- Move the projection to a distributed key-value store only if measured PostgreSQL throughput or data size becomes a real bottleneck.

### Operational Visibility

The operational read model is stored in a separate PostgreSQL database and updated asynchronously by a dedicated RabbitMQ consumer queue. It supports lookup by internal order ID, external order ID and tracking number and exposes the fulfillment timeline, current blocking reason and failed integration attempts.

The normal projection-lag target is less than 60 seconds. The system monitors the last successfully processed event, projection lag and failed projection messages. The dashboard displays a stale-data warning when the target is exceeded. A batch reconciliation job compares active workflows with the read model and repairs missing or divergent records.

A workflow is considered stuck when it has no progress beyond its phase-specific deadline. An order is considered at risk when the remaining time before its promised fulfillment deadline is below the expected time for its current and remaining phases.

The operational views combine domain data from the read model with queue and latency metrics. They include:

- Orders by state.
- Queue backlog and oldest message age.
- Stuck workflows.
- Reservation failures by warehouse.
- Warehouse execution backlog.
- Shipment failures by carrier.
- Orders at risk of missing SLA.
- End-to-end fulfillment latency.

### Growth Beyond the Initial Design

The system should evolve from measured bottlenecks rather than splitting every module in advance.

Likely extraction points are:

1. Order ingestion, if API scaling and worker scaling become very different.
2. Reservation and warehouse execution, if they require independent failure isolation.
3. Inventory projection if PostgreSQL is no longer sufficient.
4. Operational analytics, if reporting volume requires a specialized store.
5. A Kafka event stream alongside RabbitMQ, if long-term event retention and replay become core requirements. RabbitMQ may remain the command transport.
