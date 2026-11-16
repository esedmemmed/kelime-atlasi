/** Public repository of the Turkish edition; change this in a fork. */
export const REPO_URL = "https://github.com/esedmemmed/kelime-atlasi";
/** Public site of the Turkish edition (share links, canonical URL). */
export const SITE_URL = "https://esedmemmed.github.io/kelime-atlasi/";
/** The original project this edition is adapted from. */
export const ORIGINAL_REPO_URL = "https://github.com/designfuchen/word-atlas";

/** Base URL of the optional sync server (empty = sync disabled). */
export const SYNC_URL = (import.meta.env?.VITE_SYNC_URL || "").replace(/\/$/, "");
