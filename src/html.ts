/**
 * Shared HTML rendering helpers for Streamline webviews.
 *
 * Every value that originates from the Streamline/Moonshot server (topic
 * names, schema fields, compatibility levels, error messages, ...) is
 * attacker-controlled from the extension's point of view and must be escaped
 * before it is interpolated into webview HTML.
 */

import { randomBytes } from 'crypto';

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
    '`': '&#096;',
    '/': '&#047;'
};

/**
 * Escape a value for safe interpolation into HTML text or a quoted attribute.
 *
 * Accepts arbitrary input (including numbers, `null` and `undefined`) because
 * server payloads are not schema-validated; non-string values are coerced to
 * their string form before escaping.
 */
export function escapeHtml(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/[&<>"'`/]/g, ch => HTML_ESCAPES[ch]);
}

/**
 * Generate a random nonce for a webview Content-Security-Policy.
 *
 * Uses `crypto.randomBytes` (a CSPRNG) rather than `Math.random`, whose output
 * is predictable and therefore unusable as a CSP nonce. A fresh value is
 * produced per rendered document so that only the scripts and styles emitted
 * by this extension are executed.
 */
export function createNonce(): string {
    // 24 random bytes -> 32 base64 characters; `+`/`/` are mapped to the
    // alphanumeric range so the nonce is safe inside a CSP directive and an
    // HTML attribute without further escaping.
    return randomBytes(24)
        .toString('base64')
        .replace(/\+/g, 'A')
        .replace(/\//g, 'B')
        .replace(/=/g, '');
}

/**
 * Build a restrictive, nonce-based Content-Security-Policy meta tag.
 *
 * Denies everything by default; only nonce-tagged inline `<style>`/`<script>`
 * blocks emitted by this extension are allowed to run. When a webview
 * `cspSource` is supplied it is also allowed for `style-src` so that VS Code's
 * own injected theme stylesheet loads, while inline styles still require the
 * nonce (no `'unsafe-inline'`, no `'unsafe-eval'`).
 */
export function cspMetaTag(nonce: string, cspSource?: string): string {
    const imgSrc = cspSource ? `${cspSource} data:` : "'none'";
    const styleSrc = cspSource ? `'nonce-${nonce}' ${cspSource}` : `'nonce-${nonce}'`;
    const policy = [
        "default-src 'none'",
        `img-src ${imgSrc}`,
        `style-src ${styleSrc}`,
        `script-src 'nonce-${nonce}'`,
        "font-src 'none'",
        "connect-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
    ].join('; ');
    return `<meta http-equiv="Content-Security-Policy" content="${policy};">`;
}

/**
 * Clamp an arbitrary percentage to the integer range rendered by the bar
 * width stylesheet. Non-finite values collapse to the minimum width so a
 * malformed server payload can never produce a missing bar.
 */
export function barWidthPercent(pct: number, minimum = 2): number {
    if (!Number.isFinite(pct)) {
        return minimum;
    }
    return Math.min(100, Math.max(minimum, Math.round(pct)));
}

/**
 * CSS class encoding a bar's width, e.g. `bar-w-42`.
 *
 * Widths are expressed as classes rather than inline width style attributes
 * because inline styles are blocked by the nonce-based CSP.
 */
export function barWidthClass(pct: number, minimum = 2): string {
    return `bar-w-${barWidthPercent(pct, minimum)}`;
}

/**
 * Render a table cell containing a proportional bar.
 *
 * `barClass` is one of the extension's own severity classes (`bar-hot`,
 * `bar-warm`, `bar-normal`); it is escaped defensively even though it is never
 * server-controlled.
 */
export function renderBarCell(pct: number, barClass: string): string {
    return `<td><div class="bar-container"><div class="bar-fill ${escapeHtml(barClass)} ${barWidthClass(pct)}"></div></div></td>`;
}

/**
 * Generated stylesheet backing {@link barWidthClass}, emitted inside a
 * nonce-authorized `<style>` block.
 */
export function barWidthStyles(): string {
    const rules: string[] = [];
    for (let pct = 0; pct <= 100; pct++) {
        rules.push(`.bar-w-${pct} { width: ${pct}%; }`);
    }
    return rules.join('\n        ');
}

/**
 * Render a complete, read-only webview document with the shared Streamline
 * styling.
 *
 * Exported (rather than inlined in the panel factory) so tests can assert on
 * the generated markup — in particular that it carries a nonce-based CSP and
 * no CSP-blocked inline style attributes.
 */
export function renderStyledDocument(title: string, bodyContent: string, cspSource?: string): string {
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${cspMetaTag(nonce, cspSource)}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style nonce="${nonce}">
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
        }
        h1 { font-size: 1.4em; margin-bottom: 16px; }
        h2 { font-size: 1.1em; margin-top: 20px; margin-bottom: 8px; color: var(--vscode-descriptionForeground); }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
        }
        th, td {
            text-align: left;
            padding: 8px 12px;
            border: 1px solid var(--vscode-panel-border);
        }
        th {
            background: var(--vscode-editor-inactiveSelectionBackground);
            font-weight: bold;
        }
        tr:hover td { background: var(--vscode-list-hoverBackground); }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.85em;
        }
        .badge-stable { background: #2ea04370; color: #3fb950; }
        .badge-warn { background: #d2992270; color: #e3b341; }
        .badge-error { background: #f8514970; color: #f85149; }
        .info-grid {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 6px 16px;
            margin-bottom: 16px;
        }
        .info-label { color: var(--vscode-descriptionForeground); }
        .empty { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
        .code {
            font-family: var(--vscode-editor-font-family);
            background: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 2px;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .bar-container {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 2px;
            overflow: hidden;
            height: 16px;
            min-width: 100px;
        }
        .bar-fill {
            height: 100%;
            border-radius: 2px;
        }
        .bar-hot { background: #f85149; }
        .bar-warm { background: #e3b341; }
        .bar-normal { background: #3fb950; }
        /* Generated width classes: inline style attributes are blocked by the CSP. */
        ${barWidthStyles()}
    </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
