import type { AgentProfile } from "./profile-store";

export type RoutedInput = {
  targetProfileId: string | null;
  message: string;
};

export function parseRoutedInput(text: string, profiles: AgentProfile[]): RoutedInput {
  if (!text.startsWith("@")) {
    return { targetProfileId: null, message: text };
  }

  const body = text.slice(1);
  const candidates = profiles
    .flatMap((profile) => [profile.id, profile.name, ...profile.aliases].map((label) => ({ label, profile })))
    .filter((candidate) => candidate.label.trim().length > 0)
    .sort((left, right) => right.label.length - left.label.length);

  const lowerBody = body.toLowerCase();
  for (const candidate of candidates) {
    const label = candidate.label.toLowerCase();
    if (lowerBody === label || (lowerBody.startsWith(label) && /\s/.test(body[label.length] ?? ""))) {
      return {
        targetProfileId: candidate.profile.id,
        message: body.slice(candidate.label.length).trimStart(),
      };
    }
  }

  return { targetProfileId: null, message: text };
}
