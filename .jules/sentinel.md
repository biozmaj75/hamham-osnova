## 2026-11-09 - Path Traversal Boundary Validation and Security Headers in Local Server
**Vulnerability:** Path validation in static file serving used string prefix check `p.startsWith(SITE)` which does not enforce path boundary delimiters, and responses lacked standard defense-in-depth security headers (clickjacking and referrer policy).
**Learning:** Using `path.relative(base, target)` ensures that paths cannot escape the base directory regardless of trailing separators or prefix overlap.
**Prevention:** Always validate relative paths using `path.relative` or boundary-delimited base paths, and enforce standard security headers (`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`) on HTTP responses.
