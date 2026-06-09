/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles the server + its transitive deps into
  // .next/standalone, so the published package can start with just `node`.
  // No `next` binary, no `tsx`, no toolchain on the user's machine.
  output: 'standalone',
  // Both better-sqlite3 (native bindings) and `bindings` itself must be
  // treated as Node-only so the instrumentation hook's import chain doesn't
  // get pulled into the edge bundle. Without this Next tries to resolve
  // `fs` / `path` from `bindings`, fails, and 500s the first request.
  serverExternalPackages: ['better-sqlite3', 'bindings'],
  typedRoutes: false,
};

export default nextConfig;
