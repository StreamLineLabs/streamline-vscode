import * as assert from 'assert';
import { escapeHtml, createNonce, cspMetaTag, barWidthClass, barWidthPercent, barWidthStyles } from '../../html';

const HOSTILE_STRINGS = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    `' onmouseover='alert(1)`,
    '</style><script>fetch("http://evil.test")</script>',
    '`${alert(1)}`',
    'javascript:/*--></title></style></textarea></script></xmp><svg/onload=alert()>'
];

suite('HTML escaping helpers', () => {
    test('escapes all HTML-significant characters', () => {
        assert.strictEqual(
            escapeHtml('<a href="x">&\'`/</a>'),
            '&lt;a href=&quot;x&quot;&gt;&amp;&#039;&#096;&#047;&lt;&#047;a&gt;'
        );
    });

    test('neutralises hostile server-controlled strings', () => {
        for (const hostile of HOSTILE_STRINGS) {
            const escaped = escapeHtml(hostile);
            assert.ok(!escaped.includes('<'), `unescaped '<' for ${hostile}`);
            assert.ok(!escaped.includes('>'), `unescaped '>' for ${hostile}`);
            assert.ok(!escaped.includes('"'), `unescaped '"' for ${hostile}`);
            assert.ok(!escaped.includes("'"), `unescaped "'" for ${hostile}`);
        }
    });

    test('is idempotent-safe for plain text and coerces non-strings', () => {
        assert.strictEqual(escapeHtml('plain text 123'), 'plain text 123');
        assert.strictEqual(escapeHtml(42), '42');
        assert.strictEqual(escapeHtml(null), '');
        assert.strictEqual(escapeHtml(undefined), '');
        assert.strictEqual(escapeHtml(false), 'false');
    });

    test('createNonce returns a fresh, high-entropy alphanumeric value', () => {
        const a = createNonce();
        const b = createNonce();
        assert.match(a, /^[A-Za-z0-9]{32}$/);
        assert.match(b, /^[A-Za-z0-9]{32}$/);
        assert.notStrictEqual(a, b);
    });

    test('createNonce produces a CSP-safe value of the supported length', () => {
        // 24 CSPRNG bytes rendered as 32 alphanumeric characters: long enough
        // that a nonce cannot be guessed, and free of characters that would
        // need escaping inside a CSP directive or an HTML attribute.
        for (let i = 0; i < 50; i++) {
            const nonce = createNonce();
            assert.strictEqual(nonce.length, 32, 'nonce must be 32 characters');
            assert.match(nonce, /^[A-Za-z0-9]{32}$/, 'nonce must be alphanumeric');
            assert.ok(new Set(nonce).size > 8, 'nonce must not collapse to a low-entropy value');
        }
    });

    test('createNonce values are unique across many draws', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 500; i++) {
            seen.add(createNonce());
        }
        assert.strictEqual(seen.size, 500, 'nonces must not repeat');
    });

    test('cspMetaTag denies by default and only allows the nonce', () => {
        const nonce = createNonce();
        const tag = cspMetaTag(nonce);
        assert.ok(tag.includes("default-src 'none'"));
        assert.ok(tag.includes(`script-src 'nonce-${nonce}'`));
        assert.ok(tag.includes(`style-src 'nonce-${nonce}'`));
        assert.ok(tag.includes("object-src 'none'"));
        assert.ok(tag.includes("base-uri 'none'"));
        assert.ok(!tag.includes("'unsafe-inline'"));
        assert.ok(!tag.includes("'unsafe-eval'"));
    });

    test('cspMetaTag allows images only from the webview source when given', () => {
        const nonce = createNonce();
        assert.ok(cspMetaTag(nonce, 'vscode-resource://host').includes('img-src vscode-resource://host data:'));
        assert.ok(cspMetaTag(nonce).includes("img-src 'none'"));
    });

    test('cspMetaTag adds the webview source to style-src while keeping the nonce', () => {
        const nonce = createNonce();
        const tag = cspMetaTag(nonce, 'vscode-resource://host');
        assert.ok(
            tag.includes(`style-src 'nonce-${nonce}' vscode-resource://host`),
            'style-src must authorize both the nonce and the webview cspSource'
        );
        assert.ok(tag.includes(`script-src 'nonce-${nonce}'`), 'script-src must stay nonce-only');
        assert.ok(!/script-src[^;]*vscode-resource/.test(tag), 'cspSource must not widen script-src');
        assert.ok(!tag.includes("'unsafe-inline'"));
        assert.ok(!tag.includes("'unsafe-eval'"));
    });
});

suite('Bar width stylesheet', () => {
    test('clamps percentages into the generated range', () => {
        assert.strictEqual(barWidthPercent(0), 2);
        assert.strictEqual(barWidthPercent(42), 42);
        assert.strictEqual(barWidthPercent(42.6), 43);
        assert.strictEqual(barWidthPercent(1000), 100);
        assert.strictEqual(barWidthPercent(-5), 2);
        assert.strictEqual(barWidthPercent(NaN), 2);
        assert.strictEqual(barWidthPercent(Infinity), 2);
        assert.strictEqual(barWidthPercent(0, 0), 0);
    });

    test('emits a CSS class instead of an inline style attribute', () => {
        assert.strictEqual(barWidthClass(0), 'bar-w-2');
        assert.strictEqual(barWidthClass(37), 'bar-w-37');
        assert.strictEqual(barWidthClass(100), 'bar-w-100');
        assert.ok(!barWidthClass(50).includes('style'));
    });

    test('the generated stylesheet covers every emitted class', () => {
        const styles = barWidthStyles();
        for (const pct of [0, 1, 2, 37, 99, 100]) {
            assert.ok(
                styles.includes(`.${barWidthClass(pct, 0)} { width: ${barWidthPercent(pct, 0)}%; }`),
                `missing rule for ${pct}%`
            );
        }
        assert.strictEqual(styles.split('\n').length, 101);
        assert.ok(!/[<>]/.test(styles), 'generated CSS must not contain markup characters');
    });
});
