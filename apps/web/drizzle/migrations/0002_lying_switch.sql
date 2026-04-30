-- orders.order_number は (business_date, order_number) の per-day ユニークに変更する。
-- 既存行は本番運用 1 日分のみ。created_at の先頭 10 文字 (JST 形式 'YYYY-MM-DD HH:MM:SS') から
-- business_date を導出して backfill する。
-- ALTER TABLE ADD COLUMN ... NOT NULL は既存行があると失敗するため、
-- 一時的に DEFAULT '' を付与し backfill 後に運用する。新規 INSERT は drizzle 側で必ず値を付与する。
DROP INDEX `orders_order_number_unique`;--> statement-breakpoint
ALTER TABLE `orders` ADD `business_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `orders` SET `business_date` = substr(`created_at`, 1, 10);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_business_date_order_number_unique` ON `orders` (`business_date`,`order_number`);
