/**
 * Placeholder domain module so the `core` TypeScript project (domain + application)
 * has a compilation unit during scaffolding (US-001). The real value objects, entities,
 * and the `Walk` aggregate land in US-002 onward; this file can be removed once the
 * domain has its own modules.
 *
 * Pure data only — no DOM, no Canvas, per ADR-0003.
 */
export const APP_NAME = "90 Waypoint Map" as const;
