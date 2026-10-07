PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `menu_items`
	ADD `fulfillment_type` text DEFAULT 'brew' NOT NULL
	CONSTRAINT `menu_items_fulfillment_type_check`
	CHECK (`fulfillment_type` IN ('brew', 'direct'));--> statement-breakpoint
CREATE TABLE `__new_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`menu_item_id` text NOT NULL,
	`unit_price_at_order` integer NOT NULL,
	`fulfillment_type_at_order` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+9 hours')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `order_items_unit_price_at_order_check`
		CHECK (`unit_price_at_order` >= 0),
	CONSTRAINT `order_items_fulfillment_type_at_order_check`
		CHECK (`fulfillment_type_at_order` IN ('brew', 'direct'))
);--> statement-breakpoint
INSERT INTO `__new_order_items`(
	`id`,
	`order_id`,
	`menu_item_id`,
	`unit_price_at_order`,
	`fulfillment_type_at_order`,
	`quantity`,
	`created_at`,
	`updated_at`
)
SELECT
	`order_items`.`id`,
	`order_items`.`order_id`,
	`order_items`.`menu_item_id`,
	`menu_items`.`price`,
	`menu_items`.`fulfillment_type`,
	`order_items`.`quantity`,
	`order_items`.`created_at`,
	`order_items`.`updated_at`
FROM `order_items`
INNER JOIN `menu_items`
	ON `menu_items`.`id` = `order_items`.`menu_item_id`;--> statement-breakpoint
CREATE TABLE `__brew_unit_order_item_links` (
	`brew_unit_id` text PRIMARY KEY NOT NULL,
	`order_item_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__brew_unit_order_item_links` (`brew_unit_id`, `order_item_id`)
SELECT `id`, `order_item_id`
FROM `brew_units`
WHERE `order_item_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `order_items`;--> statement-breakpoint
ALTER TABLE `__new_order_items` RENAME TO `order_items`;--> statement-breakpoint
UPDATE `brew_units`
SET `order_item_id` = (
	SELECT `order_item_id`
	FROM `__brew_unit_order_item_links`
	WHERE `brew_unit_id` = `brew_units`.`id`
)
WHERE `id` IN (
	SELECT `brew_unit_id`
	FROM `__brew_unit_order_item_links`
);--> statement-breakpoint
DROP TABLE `__brew_unit_order_item_links`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
