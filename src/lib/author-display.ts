import { AUTHOR_LABELS } from "./types";
import type { AuthorKey, Profile } from "./types";

type AuthorProfile = Pick<Profile, "author_key" | "display_name"> | null | undefined;

export function makeAuthorNames(profiles: AuthorProfile[] = []) {
  const hasProfiles = profiles.some((profile) => !!profile?.display_name?.trim());
  const names: Record<AuthorKey, string> = hasProfiles
    ? { white: "User 2", brown: "User 1" }
    : { ...AUTHOR_LABELS };

  profiles.forEach((profile) => {
    const key = profile?.author_key;
    const name = profile?.display_name?.trim();
    if ((key === "white" || key === "brown") && name) {
      names[key] = name;
    }
  });

  return names;
}

export function authorDisplayName(
  profile: AuthorProfile,
  fallbackKey: AuthorKey,
  fallbackNames?: Record<AuthorKey, string>
) {
  return profile?.display_name?.trim() || fallbackNames?.[fallbackKey] || AUTHOR_LABELS[fallbackKey];
}
