export function provider(input: string) {
  const label = input.replace(/big-pickle/gi, "Marks-big").replace(/kilo-auto\/free/gi, "Marks-klfree")
  if (/^(opencode|kilocode|kilo)(?:$|-)/i.test(label)) return label.replace(/^(opencode|kilocode|kilo)/i, "marks")
  return label
}

export function model(input: string) {
  return input
    .replace(/big-pickle(?=(?:marks|opencode|kilocode|kilo)-)/gi, "Marks-big/")
    .replace(/big-pickle/gi, "Marks-big")
    .replace(/kilo-auto\/free/gi, "Marks-klfree")
    .replace(/\b(opencode|kilocode|kilo)\b/gi, "marks")
}

export function modelWithProvider(input: { providerID: string; modelID: string; modelName?: string; variant?: string }) {
  const variant = input.variant ? `/${input.variant}` : ""
  const providerLabel = provider(input.providerID)
  const modelLabel = model(input.modelName ?? input.modelID)
  if (modelLabel.startsWith(`${providerLabel}/`)) return `${modelLabel}${variant}`
  return `${providerLabel}/${modelLabel}${variant}`
}

export * as VisualLabel from "./visual-label"
