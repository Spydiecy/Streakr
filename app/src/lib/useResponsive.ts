import { useWindowDimensions } from "react-native";

/**
 * Breakpoints for the web build.
 *
 * Streakr is mobile-first, and on a wide desktop viewport a full-bleed
 * mobile layout stretches into unreadable 1400px-wide rows. Rather than
 * designing a second desktop information architecture, content is capped to a
 * comfortable column and centred, with the ambient glow still filling the
 * whole viewport so it reads as an intentional app shell rather than a
 * stretched phone screen.
 */
export const CONTENT_MAX_WIDTH = 560;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isWide = width >= 720;
  return {
    width,
    height,
    /** Desktop / large tablet — content should be centred and capped. */
    isWide,
    /** Roomier gutters once there's space for them. */
    gutter: isWide ? 28 : 20,
    contentMaxWidth: CONTENT_MAX_WIDTH,
  };
}
