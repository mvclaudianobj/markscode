CREATE TABLE `map_session_binding` (
	`session_id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`project_slug` text,
	`module_id` text,
	`module_slug` text,
	`task_id` text,
	`task_title` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_map_session_binding_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
