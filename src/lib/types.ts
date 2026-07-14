export type AuthorKey = "white" | "brown";

export function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function asRow<T>(value: unknown): T {
  return value as T;
}

export interface Profile {
  id: string;
  account: string;
  author_key: AuthorKey;
  display_name: string;
  created_at: string;
  weather_text?: string | null;
  weather_updated_at?: string | null;
  weather_lat?: number | null;
  weather_lng?: number | null;
  weather_label?: string | null;
  mood_text?: string | null;
  mood_date?: string | null;
  doing_text?: string | null;
  doing_date?: string | null;
  last_seen_at?: string | null;
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_markdown: string;
  storage_path: string | null;
  author_id: string;
  tags: string[] | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  profiles?: Pick<Profile, "display_name" | "author_key"> | null;
}

export interface Photo {
  id: string;
  owner_id: string;
  title: string | null;
  caption: string | null;
  taken_on: string | null;
  storage_path: string;
  mime_type: string | null;
  created_at: string;
  profiles?: Pick<Profile, "display_name" | "author_key"> | null;
  publicUrl?: string;
}

export interface LifeRecord {
  id: string;
  owner_id: string;
  record_on: string;
  mood: string;
  body: string;
  created_at: string;
  updated_at: string;
  profiles?: Pick<Profile, "display_name" | "author_key"> | null;
}

export type CommentTarget = "blog" | "record";

export interface Comment {
  id: string;
  target_type: CommentTarget;
  target_id: string;
  author_id: string;
  body: string;
  created_at: string;
  profiles?: Pick<Profile, "display_name" | "author_key"> | null;
}

export type PlaceTone = "night" | "desert" | "forest" | "sea";

export interface Place {
  id: string;
  owner_id: string;
  name: string;
  note: string;
  tone: PlaceTone;
  created_at: string;
  updated_at: string;
  profiles?: Pick<Profile, "display_name" | "author_key"> | null;
}

export const PLACE_TONE_LABELS: Record<PlaceTone, string> = {
  night: "Starlight",
  desert: "Sunset",
  forest: "Forest",
  sea: "Seaside",
};

export interface ActivityEntry {
  id: string;
  owner_id: string;
  activity_on: string;
  period: string;
  category: string;
  minutes: number;
  body: string;
  start_time?: string | null;
  end_time?: string | null;
  created_at: string;
  updated_at: string;
  profiles?: Pick<Profile, "display_name" | "author_key"> | null;
}

export interface TodoItem {
  id: string;
  owner_id: string;
  title: string;
  due_on: string | null;
  completed: boolean;
  completed_on: string | null;
  completed_start_time: string | null;
  completed_end_time: string | null;
  completed_minutes: number;
  activity_entry_id: string | null;
  archived_at?: string | null;
  completion_ranges?: TodoCompletionRange[];
  created_at: string;
  updated_at: string;
  profiles?: Pick<Profile, "display_name" | "author_key"> | null;
}

export interface TodoCompletionRange {
  start_time: string | null;
  end_time: string | null;
  minutes: number | null;
}

export const AUTHOR_LABELS: Record<AuthorKey, string> = {
  white: "White",
  brown: "Brown",
};

export const AUTHOR_COLORS: Record<AuthorKey, string> = {
  white: "#7aa6d4",
  brown: "#d49356",
};

export const MOOD_LABELS: Record<string, string> = {
  happy: "Happy",
  loved: "Loved",
  calm: "Calm",
  tired: "Tired",
  down: "Low",
  moody: "Moody",
};

export const ACTIVITY_PERIODS = [
  { key: "morning", label: "Early Morning", time: "05:00-08:00", minutes: 180 },
  { key: "forenoon", label: "Morning", time: "08:00-11:00", minutes: 180 },
  { key: "noon", label: "Noon", time: "11:00-14:00", minutes: 180 },
  { key: "afternoon", label: "Afternoon", time: "14:00-17:00", minutes: 180 },
  { key: "dusk", label: "Dusk", time: "17:00-19:00", minutes: 120 },
  { key: "evening", label: "Evening", time: "19:00-23:00", minutes: 240 },
  { key: "midnight", label: "Late Night", time: "23:00-05:00", minutes: 360 },
] as const;

export const ACTIVITY_CATEGORIES = ["学习", "工作", "约会", "家务", "娱乐", "休息", "运动", "其他"] as const;

export const ACTIVITY_CATEGORY_LABELS: Record<string, string> = {
  学习: "Study",
  工作: "Work",
  约会: "Date",
  家务: "Chores",
  娱乐: "Fun",
  休息: "Rest",
  运动: "Workout",
  其他: "Other",
};

export const CATEGORY_COLORS: Record<string, string> = {
  学习: "#7aa6d4",
  工作: "#91c6b6",
  约会: "#e6a6bd",
  家务: "#d49356",
  娱乐: "#a7c978",
  休息: "#b9aedb",
  运动: "#efb36f",
  其他: "#9aa7b7",
};
