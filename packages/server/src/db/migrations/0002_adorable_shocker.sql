CREATE TABLE `run_findings` (
	`run_id` text NOT NULL,
	`finding_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `finding_id`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `run_findings` (`run_id`, `finding_id`, `created_at`) SELECT `run_id`, `id`, `created_at` FROM `findings`;
