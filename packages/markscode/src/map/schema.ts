import { Schema } from "effect"

import { SessionID } from "@/session/schema"

export const WireID = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(128)),
)

export class Binding extends Schema.Class<Binding>("Map.Binding")({
  sessionID: SessionID,
  projectID: WireID,
  projectSlug: Schema.optional(Schema.String),
  moduleID: Schema.optional(WireID),
  moduleSlug: Schema.optional(Schema.String),
  taskID: Schema.optional(WireID),
  taskTitle: Schema.optional(Schema.String),
  revision: Schema.Int,
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}) {}

export class BindingInput extends Schema.Class<BindingInput>("Map.BindingInput")({
  sessionID: SessionID,
  projectID: WireID,
  projectSlug: Schema.optional(Schema.String),
  moduleID: Schema.optional(WireID),
  moduleSlug: Schema.optional(Schema.String),
  taskID: Schema.optional(WireID),
  taskTitle: Schema.optional(Schema.String),
}) {}

export * as MapSchema from "./schema"
