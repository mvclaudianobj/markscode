ALTER TABLE `remote_ssh_profile` ADD COLUMN `protocol` text;
--> statement-breakpoint
ALTER TABLE `remote_ssh_profile` ADD COLUMN `master_key_ref` text;
--> statement-breakpoint
ALTER TABLE `remote_ssh_profile` ADD COLUMN `encrypted_password` text;
--> statement-breakpoint
ALTER TABLE `remote_ssh_profile` ADD COLUMN `pki_enabled` integer DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `remote_ssh_profile_protocol_idx` ON `remote_ssh_profile` (`protocol`);
