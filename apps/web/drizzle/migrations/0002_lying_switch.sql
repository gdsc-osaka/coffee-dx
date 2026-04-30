DROP INDEX `orders_order_number_unique`;--> statement-breakpoint
ALTER TABLE `orders` ADD `business_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `orders` SET `business_date` = substr(`created_at`, 1, 10);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_business_date_order_number_unique` ON `orders` (`business_date`,`order_number`);