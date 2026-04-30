CREATE TABLE `brew_units` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`menu_item_id` text NOT NULL,
	`order_item_id` text,
	`status` text DEFAULT 'brewing' NOT NULL,
	`business_date` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "brew_units_status_check" CHECK("brew_units"."status" IN ('brewing', 'ready'))
);
--> statement-breakpoint
CREATE INDEX `idx_brew_units_menu_date` ON `brew_units` (`menu_item_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `idx_brew_units_order_item` ON `brew_units` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `idx_brew_units_batch` ON `brew_units` (`batch_id`);