import { createSimpleContext } from "./helper"
import { interpolate, translate, type Language, type Tr } from "@/util/i18n"

export type { Tr } from "@/util/i18n"

type I18nValue = {
  language: () => Language
  tr: Tr
}

export const { use: useI18n, provider: I18nProvider } = createSimpleContext<I18nValue, { language: Language }>({
  name: "I18n",
  init: (props: { language: Language }) => ({
    language: () => props.language,
    tr: (key, params, fallback) => interpolate(translate(props.language, key, fallback), params),
  }),
})
