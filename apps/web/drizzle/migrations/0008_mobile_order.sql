CREATE TABLE `mobile_order_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`store_token` text NOT NULL,
	`business_date` text NOT NULL,
	`order_number` integer NOT NULL,
	`status` text DEFAULT 'awaiting_payment' NOT NULL,
	`paid_at` text,
	`accepted_order_id` text,
	`idempotency_key` text NOT NULL,
	`public_token` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	CONSTRAINT "mobile_order_requests_status_check" CHECK("mobile_order_requests"."status" IN ('awaiting_payment','paid','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_order_requests_idempotency_unique` ON `mobile_order_requests` (`store_token`,`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_order_requests_public_token_unique` ON `mobile_order_requests` (`public_token`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_order_requests_business_date_order_number_unique` ON `mobile_order_requests` (`business_date`,`order_number`);
--> statement-breakpoint
CREATE INDEX `mobile_order_requests_store_date_status_idx` ON `mobile_order_requests` (`store_token`,`business_date`,`status`);
--> statement-breakpoint
CREATE TABLE `mobile_order_request_items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`menu_item_id` text NOT NULL,
	`item_name_at_order` text NOT NULL,
	`unit_price_at_order` integer NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	CONSTRAINT "mobile_order_request_items_quantity_positive" CHECK("mobile_order_request_items"."quantity" > 0),
	CONSTRAINT "mobile_order_request_items_price_non_negative" CHECK("mobile_order_request_items"."unit_price_at_order" >= 0),
	FOREIGN KEY (`request_id`) REFERENCES `mobile_order_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `mobile_order_request_items_request_idx` ON `mobile_order_request_items` (`request_id`);
--> statement-breakpoint
CREATE TABLE `mobile_order_acceptance` (
	`id` text PRIMARY KEY NOT NULL,
	`store_token` text NOT NULL,
	`business_date` text NOT NULL,
	`is_accepting` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	CONSTRAINT "mobile_order_acceptance_boolean_check" CHECK("mobile_order_acceptance"."is_accepting" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_order_acceptance_store_date_unique` ON `mobile_order_acceptance` (`store_token`,`business_date`);
--> statement-breakpoint
ALTER TABLE `orders` ADD `mobile_request_id` text REFERENCES mobile_order_requests(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_mobile_request_id_unique` ON `orders` (`mobile_request_id`);
