type SafeLocalRedirectOptions = {
    blockedPaths?: ReadonlySet<string>
    blockedPrefixes?: readonly string[]
}

export function safeLocalRedirectPath(
    value: string | null | undefined,
    requestUrl: string,
    options: SafeLocalRedirectOptions = {},
): string | null {
    if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
        return null
    }

    try {
        const trustedOrigin = new URL(requestUrl).origin
        const resolved = new URL(value, trustedOrigin)

        if (resolved.origin !== trustedOrigin) {
            return null
        }

        const canonicalPath = decodeURIComponent(resolved.pathname)

        if (canonicalPath.includes('\\') || options.blockedPaths?.has(canonicalPath)) {
            return null
        }

        if (options.blockedPrefixes?.some((prefix) => canonicalPath.startsWith(prefix))) {
            return null
        }

        return `${resolved.pathname}${resolved.search}${resolved.hash}`
    } catch {
        return null
    }
}
