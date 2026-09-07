/**
 * Shared resolution of Streamline settings that exist under both a canonical
 * key and a deprecated alias.
 *
 * `WorkspaceConfiguration.get()` never returns `undefined` for a setting that
 * declares a `default` in package.json, so `get(canonical) ?? get(alias)` can
 * never fall through to the alias — the canonical default silently wins and an
 * explicitly configured alias is ignored. These helpers therefore use
 * `inspect()` so that "explicitly configured" can be distinguished from
 * "defaulted":
 *
 *   1. an explicitly configured canonical value (any scope) wins;
 *   2. otherwise an explicitly configured deprecated alias is honoured;
 *   3. otherwise the canonical default from the manifest is used.
 *
 * Assumption: every `inspect()` field except `defaultValue` counts as an
 * explicit configuration. `defaultLanguageValue` is included in the explicit
 * chain (at lowest priority) because VS Code resolves it above `defaultValue`,
 * so ignoring it would contradict what `get()` reports.
 */

import * as vscode from 'vscode';

const SECTION = 'streamline';

/** Fallbacks used only when the manifest default is missing or unusable. */
const MAX_MESSAGES_FALLBACK = 100;
const REFRESH_INTERVAL_FALLBACK = 5000;

/** A usable numeric setting: finite and positive (both keys have `minimum` > 0). */
function isUsableNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Value explicitly configured for `key` at any scope, in VS Code's own
 * precedence order (most specific first), or `undefined` when the setting is
 * only supplying its manifest default.
 */
export function explicitSettingValue<T>(
    config: vscode.WorkspaceConfiguration,
    key: string
): T | undefined {
    const info = config.inspect<T>(key);
    if (!info) {
        return undefined;
    }
    return info.workspaceFolderLanguageValue
        ?? info.workspaceFolderValue
        ?? info.workspaceLanguageValue
        ?? info.workspaceValue
        ?? info.globalLanguageValue
        ?? info.globalValue
        ?? info.defaultLanguageValue;
}

/**
 * Resolve a numeric setting that has a deprecated alias, preferring an
 * explicitly configured canonical value, then an explicitly configured alias,
 * then the canonical manifest default.
 */
export function resolveAliasedNumber(
    canonicalKey: string,
    deprecatedKey: string,
    fallback: number,
    config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(SECTION)
): number {
    const canonical = explicitSettingValue<number>(config, canonicalKey);
    if (isUsableNumber(canonical)) {
        return canonical;
    }

    const deprecated = explicitSettingValue<number>(config, deprecatedKey);
    if (isUsableNumber(deprecated)) {
        return deprecated;
    }

    const canonicalDefault = config.inspect<number>(canonicalKey)?.defaultValue;
    return isUsableNumber(canonicalDefault) ? canonicalDefault : fallback;
}

/**
 * Effective message viewer limit: `streamline.maxMessages`, falling back to the
 * deprecated `streamline.maxMessagesToShow` only when that alias is explicitly
 * configured and the canonical key is not.
 */
export function getEffectiveMaxMessages(): number {
    return resolveAliasedNumber('maxMessages', 'maxMessagesToShow', MAX_MESSAGES_FALLBACK);
}

/**
 * Effective auto-refresh interval in milliseconds: `streamline.refreshInterval`,
 * falling back to the deprecated `streamline.autoRefreshInterval` only when that
 * alias is explicitly configured and the canonical key is not.
 */
export function getEffectiveRefreshInterval(): number {
    return resolveAliasedNumber('refreshInterval', 'autoRefreshInterval', REFRESH_INTERVAL_FALLBACK);
}
