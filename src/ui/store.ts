import { create } from "zustand";
export const useUI = create<{
  toast: string;
  notify: (message: string) => void;
}>((set) => ({ toast: "", notify: (toast) => set({ toast }) }));
export function haptic(
  pattern: "tap" | "select" | "success" | "warning" | "error",
  enabled = true,
) {
  if (!enabled) return;
  const patterns = {
    tap: 8,
    select: 12,
    success: [12, 40, 12],
    warning: [30, 50, 30],
    error: [45, 35, 45],
  };
  if (navigator.vibrate) navigator.vibrate(patterns[pattern]);
  else if (CSS.supports("-webkit-touch-callout", "none")) {
    const input = document.createElement("input");
    input.type = "checkbox";
    if (!("switch" in input)) return;
    input.setAttribute("switch", "");
    input.style.cssText = "position:fixed;left:-100px;opacity:0";
    document.body.append(input);
    input.click();
    input.remove();
  }
}
