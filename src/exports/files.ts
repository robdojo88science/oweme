export function downloadFile(file: File | Blob, name?: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name || (file instanceof File ? file.name : "OweMe-export");
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied)
    throw new Error("Copy is unavailable. Select and copy the text manually.");
}
export async function shareFile(
  file: File,
  text: string,
): Promise<"shared" | "downloaded" | "cancelled"> {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "OweMe", text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return "cancelled";
    }
  }
  downloadFile(file);
  try {
    await copyText(text);
  } catch {
    /* The downloaded file remains available when clipboard permission is denied. */
  }
  return "downloaded";
}
export function emailFile(file: File, text: string, email = ""): void {
  downloadFile(file);
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("OweMe - " + file.name)}&body=${encodeURIComponent(text + "\n\nAttach the downloaded PDF before sending.")}`;
}
export function printFile(file: File): void {
  const url = URL.createObjectURL(file);
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.title = "Print OweMe document";
  frame.src = url;
  frame.onload = () => {
    window.setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        downloadFile(file);
      }
    }, 400);
  };
  document.body.append(frame);
  window.setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 120_000);
}
