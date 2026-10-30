ALTER TABLE `findings` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `findings` ADD `occurrences` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `findings` ADD `last_seen` integer;--> statement-breakpoint
ALTER TABLE `findings` ADD `issue_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `new_findings` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `duplicate_findings` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `findings` SET `last_seen` = `created_at` WHERE `last_seen` IS NULL;
