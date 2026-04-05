CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`description` text,
	`is_available` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	CONSTRAINT "orders_status_check" CHECK("status" IN ('pending','brewing','ready','completed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_number_unique` ON `orders` (`order_number`);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`menu_item_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `order_number_counters` (
	`business_date` text PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL
);
