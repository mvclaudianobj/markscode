CREATE TABLE `remote_ssh_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`org_id` text,
	`name` text NOT NULL,
	`type` text DEFAULT 'ssh' NOT NULL,
	`host` text NOT NULL,
	`user` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`transport` text,
	`identity_file` text,
	`key_name` text,
	`host_alias` text,
	`credential_ref` text,
	`auth_method` text,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `remote_ssh_profile_name_idx` ON `remote_ssh_profile` (`name`);
--> statement-breakpoint
CREATE INDEX `remote_ssh_profile_host_idx` ON `remote_ssh_profile` (`host`);
