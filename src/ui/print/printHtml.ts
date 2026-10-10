/** The @font-face rules of the self-hosted Cairo, copied into the print frame so receipts use the same font (offline). */
export function cairoFontFaces(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSFontFaceRule && /cairo/i.test(rule.style.getPropertyValue('font-family')))
          rules.push(rule.cssText);
      }
    } catch {
      // a cross-origin sheet cannot be read; we only use our own
    }
  }
  return rules.join('\n');
}

/**
 * Prints an HTML document through the OS printer driver: hidden iframe, wait for the fonts, `print()`. Resolves when the print was
 * handed to the browser, never waits for the paper, and rejects if it could not start so the screen can offer "print again".
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;inset-inline-end:0;inset-block-end:0;width:0;height:0;border:0;visibility:hidden';
    const cleanup = (): void => void setTimeout(() => frame.remove(), 60_000);
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        return reject(new Error('print frame has no window'));
      }
      void (async () => {
        try {
          await win.document.fonts.ready;
          win.focus();
          win.print();
          resolve();
        } catch (e) {
          reject(e instanceof Error ? e : new Error('print failed'));
        } finally {
          cleanup();
        }
      })();
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
