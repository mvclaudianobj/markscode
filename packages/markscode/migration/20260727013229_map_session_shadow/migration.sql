CREATE TABLE `map_session_shadow` (
	`session_id` text PRIMARY KEY,
	`binding_revision` integer NOT NULL,
	`account_id` text NOT NULL,
	`account_revision` integer NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text NOT NULL,
	`module_id` text,
	`task_id` text,
	`project_version` integer NOT NULL,
	`module_version` integer,
	`task_version` integer,
	`project_json` text NOT NULL,
	`module_json` text,
	`task_json` text,
	`time_observed` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_map_session_shadow_session_id_map_session_binding_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `map_session_binding`(`session_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_map_session_shadow_account_id_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `account_state` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `map_session_binding` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `map_session_shadow_time_observed_idx` ON `map_session_shadow` (`time_observed`);
