import * as assert from 'assert';
import * as vscode from 'vscode';
import { SchemaViewerPanel } from '../../schemaTree';
import { hasMoreMessages, MessageViewerPanel } from '../../messageViewer';
import { StreamlineClient, SchemaInfo, ConsumerGroupMember } from '../../client';
import { renderBarCell, renderStyledDocument, barWidthClass, escapeHtml } from '../../html';
import { buildConsumerGroupMembersTooltip } from '../../extension';

const XSS = '<script>alert("xss")</script>';
const ATTR_XSS = '"><img src=x onerror=alert(1)>';

/** Any `style=` attribute on an element; blocked by the nonce-based CSP. */
const INLINE_STYLE_ATTRIBUTE = /<[a-zA-Z][^>]*\sstyle\s*=/;

function htmlOf(panelHolder: unknown): string {
    return (panelHolder as { _panel: vscode.WebviewPanel })._panel.webview.html;
}

/**
 * Hostile values may legitimately survive as inert *text* (e.g. `onerror=` is
 * harmless once the surrounding angle brackets are escaped), so the assertions
 * are structural: no injected element and no inline handler attribute.
 */
function assertNoInjection(html: string, hostileValues: string[]): void {
    for (const raw of hostileValues) {
        assert.ok(!html.includes(raw), `raw hostile value survived escaping: ${raw}`);
    }
    assert.ok(!/<img/i.test(html), 'an <img> element was injected');
    assert.ok(!/<script(?![^>]*nonce=)/i.test(html), 'a script without the CSP nonce was injected');
    assert.ok(!/<\w+[^>]*\son\w+\s*=/i.test(html), 'an inline event handler attribute was injected');
}

/**
 * Inline `style=` attributes are silently dropped under a nonce-based CSP, so
 * any that reach the document are a rendering bug, not just a style nit.
 */
function assertNoInlineStyleAttributes(html: string): void {
    const offender = html.match(INLINE_STYLE_ATTRIBUTE);
    assert.strictEqual(
        offender,
        null,
        `CSP-blocked inline style attribute in generated HTML: ${offender?.[0] ?? ''}`
    );
    assert.ok(
        !/\.style\.(display|width|height)\s*=/.test(html),
        'webview scripts must toggle CSS classes instead of writing inline styles'
    );
}

/** Entities produced by `escapeHtml`, for a single decoding pass. */
const ENTITY_DECODES: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'",
    '&#096;': '`',
    '&#047;': '/'
};

/**
 * Decode HTML entities exactly once. A value that was escaped twice still
 * contains entity text (e.g. `&lt;`) after this pass, which is what the
 * double-escape regression tests assert against.
 */
function decodeEntitiesOnce(value: string): string {
    return value.replace(/&(?:amp|lt|gt|quot|#039|#096|#047);/g, m => ENTITY_DECODES[m]);
}

function assertRestrictiveCsp(html: string): void {    const nonceMatch = html.match(/script-src 'nonce-([A-Za-z0-9]{32})'/);
    assert.ok(nonceMatch, 'missing nonce-based script-src directive');
    assert.ok(html.includes("default-src 'none'"), 'missing default-src none');
    assert.ok(html.includes(`style-src 'nonce-${nonceMatch![1]}'`), 'style-src must use the same nonce');
    assert.ok(!html.includes("'unsafe-inline'"), 'CSP must not allow unsafe-inline');
    assert.ok(!html.includes("'unsafe-eval'"), 'CSP must not allow unsafe-eval');
    assert.ok(!/<style(?![^>]*nonce=)/.test(html), 'every <style> block must carry the nonce');
    assert.ok(!/<script(?![^>]*nonce=)/.test(html), 'every <script> block must carry the nonce');
    assertNoInlineStyleAttributes(html);
}

suite('Consumer group member tooltip', () => {
    /** Mirrors the member-count cell rendered by `streamline.viewConsumerGroups`. */
    function renderMemberCell(members: ConsumerGroupMember[] | undefined, count: number): string {
        const tooltip = buildConsumerGroupMembersTooltip(members);
        return `<td title="${escapeHtml(tooltip)}">${escapeHtml(count)}</td>`;
    }

    function member(clientId: string, host: string): ConsumerGroupMember {
        return { memberId: `m-${clientId}`, clientId, host, assignments: [] };
    }

    test('builds the tooltip from raw member values', () => {
        const tooltip = buildConsumerGroupMembersTooltip([
            member('consumer-1', '10.0.0.1'),
            member('consumer-2', '10.0.0.2')
        ]);
        assert.strictEqual(tooltip, 'consumer-1 (10.0.0.1), consumer-2 (10.0.0.2)');
    });

    test('reports "None" when a group has no members', () => {
        assert.strictEqual(buildConsumerGroupMembersTooltip(undefined), 'None');
        assert.strictEqual(buildConsumerGroupMembersTooltip([]), 'None');
        assert.ok(renderMemberCell([], 0).includes('title="None"'));
    });

    test('escapes ordinary values exactly once so the tooltip reads back verbatim', () => {
        const html = renderMemberCell([member('svc & co', 'a<b>.example.com')], 1);
        // One round of escaping: `&` -> `&amp;`, never `&amp;amp;`.
        assert.ok(html.includes('title="svc &amp; co (a&lt;b&gt;.example.com)"'), `unexpected cell: ${html}`);
        assert.ok(!html.includes('&amp;amp;'), 'value was escaped twice');
        assert.ok(!html.includes('&amp;lt;'), 'value was escaped twice');

        // Decoding the attribute once must reproduce the raw member text.
        const attr = html.match(/title="([^"]*)"/)![1];
        assert.strictEqual(decodeEntitiesOnce(attr), 'svc & co (a<b>.example.com)');
    });

    test('a hostile member value cannot break out of the title attribute', () => {
        const hostile = member(ATTR_XSS, `${XSS}`);
        const html = renderMemberCell([hostile], 1);
        const attr = html.match(/title="([^"]*)"/)![1];

        assert.ok(!html.includes(ATTR_XSS), 'raw hostile clientId survived escaping');
        assert.ok(!html.includes(XSS), 'raw hostile host survived escaping');
        assert.ok(!/<img/i.test(html), 'an <img> element was injected');
        assert.ok(!/<script/i.test(html), 'a <script> element was injected');
        // Nothing that could terminate the attribute or open a tag remains raw
        // inside it, so the surrounding `onerror=` text is inert.
        assert.ok(
            /^[^<>"'`/]*$/.test(attr),
            `title attribute retains markup-significant characters: ${attr}`
        );
        // Still exactly one escaping pass: the raw value decodes back cleanly.
        assert.strictEqual(
            decodeEntitiesOnce(attr),
            `${ATTR_XSS} (${XSS})`,
            'tooltip text must round-trip through a single escaping pass'
        );
    });
});

suite('Webview security', () => {
    const extensionUri = vscode.Uri.file(__dirname);

    teardown(() => {
        SchemaViewerPanel.currentPanel?.dispose();
        MessageViewerPanel.currentPanel?.dispose();
    });

    test('schema viewer escapes hostile server fields and applies a nonce CSP', async () => {
        const hostileSchema = {
            subject: XSS,
            version: ATTR_XSS,
            id: '</span><script>alert(2)</script>',
            schemaType: '<img src=x onerror=alert(3)>',
            schema: '{"doc":"<script>alert(4)</script>"}'
        } as unknown as SchemaInfo;

        const client = {
            getSchema: async () => hostileSchema,
            getSubjectCompatibility: async () => ({ compatibilityLevel: '<script>alert(5)</script>' }),
            getSubjectVersions: async () => [1, ATTR_XSS]
        } as unknown as StreamlineClient;

        await SchemaViewerPanel.createOrShow(extensionUri, client, 'hostile-subject', 'latest');
        const html = htmlOf(SchemaViewerPanel.currentPanel);

        assertNoInjection(html, [XSS, ATTR_XSS, '<img src=x onerror=alert(3)>', '<script>alert(5)</script>']);
        assertRestrictiveCsp(html);
        assert.ok(html.includes('&lt;script&gt;'), 'expected escaped schema subject in output');
    });

    test('schema viewer error page escapes the server error message', async () => {
        const client = {
            getSchema: async () => {
                throw new Error(XSS);
            },
            getSubjectCompatibility: async () => ({ compatibilityLevel: 'NONE' }),
            getSubjectVersions: async () => [1]
        } as unknown as StreamlineClient;

        await SchemaViewerPanel.createOrShow(extensionUri, client, 'broken', 'latest');
        const html = htmlOf(SchemaViewerPanel.currentPanel);

        assertNoInjection(html, [XSS]);
        assertRestrictiveCsp(html);
    });

    test('message viewer escapes the topic title and ships no inline handlers', async () => {
        const client = {
            consume: async () => []
        } as unknown as StreamlineClient;

        MessageViewerPanel.createOrShow(extensionUri, client, `topic-${ATTR_XSS}`);
        const html = htmlOf(MessageViewerPanel.currentPanel);

        assertNoInjection(html, [ATTR_XSS]);
        assertRestrictiveCsp(html);
        assert.ok(html.includes('data-index='), 'copy buttons must use delegated listeners');
    });

    test('message viewer hides the load-more control with a nonce-authorized class', async () => {
        const client = {
            consume: async () => []
        } as unknown as StreamlineClient;

        MessageViewerPanel.createOrShow(extensionUri, client, 'load-more-topic');
        const html = htmlOf(MessageViewerPanel.currentPanel);

        assert.ok(
            /<div class="load-more hidden" id="loadMore">/.test(html),
            'the load-more control must start hidden via a CSS class, not style="display: none"'
        );
        assert.ok(/\.hidden\s*\{\s*display:\s*none;\s*\}/.test(html), 'the hidden class must be defined in the nonce-authorized stylesheet');
        assert.ok(
            html.includes("classList.toggle('hidden'"),
            'visibility must be toggled through classList'
        );
        // The empty-message branch must hide the control before returning.
        const emptyBranch = html.slice(html.indexOf("if (msgs.length === 0)"));
        assert.ok(
            emptyBranch.indexOf('setLoadMoreVisible(false)') < emptyBranch.indexOf('return;'),
            'rendering an empty message list must hide the load-more control'
        );
        assertNoInlineStyleAttributes(html);
    });

    test('message viewer load-more visibility follows the effective page size, not a hard-coded 100', async () => {
        assert.strictEqual(hasMoreMessages(16, 17), false);
        assert.strictEqual(hasMoreMessages(17, 17), true);
        assert.strictEqual(hasMoreMessages(321, 321), true);

        const client = {
            consume: async () => []
        } as unknown as StreamlineClient;
        MessageViewerPanel.createOrShow(extensionUri, client, 'configured-page-size');
        const html = htmlOf(MessageViewerPanel.currentPanel);

        assert.ok(html.includes('renderMessages(messages, message.total, Boolean(message.hasMore))'));
        assert.ok(html.includes('setLoadMoreVisible(hasMore)'));
        assert.ok(!html.includes('msgs.length >= 100'), 'the deprecated fixed page size must not return');
    });
});

suite('Styled webview documents (lag dashboard / partition hotspots)', () => {
    /** Mirrors the markup produced by the lag dashboard and hotspot commands. */
    function barTableDocument(percentages: number[]): string {
        const rows = percentages.map((pct, i) => {
            const barClass = pct > 80 ? 'bar-hot' : pct > 40 ? 'bar-warm' : 'bar-normal';
            return `<tr><td>partition-${i}</td>${renderBarCell(pct, barClass)}</tr>`;
        }).join('');
        return renderStyledDocument(
            'Consumer Lag Dashboard',
            `<h1>Consumer Lag Dashboard</h1><table><tbody>${rows}</tbody></table>`,
            'vscode-webview://abc'
        );
    }

    test('bar cells carry no CSP-blocked inline style attribute', () => {
        const html = barTableDocument([0, 2, 17, 50, 99, 100]);
        assertNoInlineStyleAttributes(html);
        assert.ok(!html.includes('${'), 'no unresolved template placeholder');
        assert.ok(!/style="width/.test(html), 'bar widths must not use inline styles');
    });

    test('bar widths are preserved through generated, nonce-authorized CSS', () => {
        const html = barTableDocument([0, 17, 100]);
        const styleBlock = html.slice(html.indexOf('<style'), html.indexOf('</style>'));

        for (const [pct, expected] of [[0, 2], [17, 17], [100, 100]] as [number, number][]) {
            assert.ok(html.includes(`bar-fill bar-normal bar-w-${expected}`)
                || html.includes(`bar-fill bar-warm bar-w-${expected}`)
                || html.includes(`bar-fill bar-hot bar-w-${expected}`),
            `missing width class for ${pct}%`);
            assert.ok(
                styleBlock.includes(`.bar-w-${expected} { width: ${expected}%; }`),
                `the stylesheet must define the width for bar-w-${expected}`
            );
        }
        assert.strictEqual(barWidthClass(0), 'bar-w-2', 'zero-width bars stay visible at the 2% minimum');
    });

    test('styled documents apply the restrictive CSP and honour the webview cspSource', () => {
        const html = barTableDocument([42]);
        assertRestrictiveCsp(html);
        const nonce = html.match(/script-src 'nonce-([A-Za-z0-9]{32})'/)![1];
        assert.ok(
            html.includes(`style-src 'nonce-${nonce}' vscode-webview://abc`),
            'style-src must include the provided webview cspSource alongside the nonce'
        );
        assert.ok(/<style nonce="[A-Za-z0-9]{32}">/.test(html), 'the stylesheet must be nonce-authorized');
    });

    test('styled documents escape hostile titles and body content', () => {
        const html = renderStyledDocument(
            `Trace: ${ATTR_XSS}`,
            `<div class="empty">${XSS.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
            'vscode-webview://abc'
        );
        assertNoInjection(html, [ATTR_XSS, XSS]);
        assertRestrictiveCsp(html);
    });
});
