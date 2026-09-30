import packageJson from '../package.json';

export const SDK_NAME: string = packageJson.name || 'vfsclient';
export const SDK_VERSION: string = packageJson.version || '0.0.1';

/**
 * Returns the detected runtime name and version.
 * e.g. "Bun/1.4.3 (darwin-arm64)", "Node.js/v22.2.0 (darwin-arm64)", or "Browser"
 */
export function getRuntimeInfo(): string {
  if (typeof process !== 'undefined' && process.versions) {
    const platform = process.platform ? `; ${process.platform}-${process.arch || 'unknown'}` : '';
    if (process.versions.bun) {
      return `Bun/${process.versions.bun}${platform}`;
    }
    if (process.versions.node) {
      return `Node.js/${process.versions.node}${platform}`;
    }
  }

  // Deno check
  if (typeof (globalThis as any).Deno !== 'undefined') {
    const deno = (globalThis as any).Deno;
    const version = deno.version?.deno || 'unknown';
    return `Deno/${version}`;
  }

  if (typeof window !== 'undefined') {
    return 'Browser';
  }

  return 'Unknown';
}

/**
 * Builds standard User-Agent string:
 * e.g. "@cubis/vfsclient/1.0.0 (Bun/1.4.3; darwin-arm64)"
 */
export function getUserAgent(): string {
  const runtime = getRuntimeInfo();
  return `${SDK_NAME}/${SDK_VERSION} (${runtime})`;
}
