import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * Global floating scroll-to-top button.
 * Watches the nearest scrollable ancestor (the <main> element in _app layout)
 * and falls back to window scroll. Appears after ~400px of scroll.
 */
export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const scrollerRef = useRef<HTMLElement | Window | null>(null);

  useEffect(() => {
    // Prefer the app's <main> scroller so this works inside the fixed layout.
    const main = document.querySelector("main");
    const scroller: HTMLElement | Window = main ?? window;
    scrollerRef.current = scroller;

    const getTop = () =>
      scroller === window
        ? window.scrollY
        : (scroller as HTMLElement).scrollTop;

    const onScroll = () => setVisible(getTop() > 400);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  const handleClick = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (scroller === window) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      (scroller as HTMLElement).scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Scroll to top"
      title="Scroll to top"
      className="fixed bottom-24 right-4 z-40 grid h-11 w-11 place-items-center rounded-full border border-border bg-card/90 text-foreground shadow-lg backdrop-blur transition-all hover:bg-card hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary md:bottom-6 md:right-6"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
