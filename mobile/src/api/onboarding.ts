import { http, path } from '@/lib/http'

export interface OnboardingOption {
  id?: string
  label: string
  role_ids: string[]
  channel_ids: string[]
}
export interface OnboardingQuestion {
  id?: string
  title: string
  multiple: boolean
  options: OnboardingOption[]
}

/** Onboarding de serveur : server/src/handlers/onboarding.rs. */
export const onboardingApi = {
  get: (serverId: string) => http.get<{ questions: OnboardingQuestion[]; selected: string[] }>(path`/servers/${serverId}/onboarding`),
  save: (serverId: string, questions: OnboardingQuestion[]) => http.put<unknown>(path`/servers/${serverId}/onboarding`, { questions }),
  answer: (serverId: string, optionIds: string[]) => http.put<{ ok: boolean }>(path`/servers/${serverId}/onboarding/answers`, { option_ids: optionIds }),
}
