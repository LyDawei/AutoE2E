/**
 * Convert route path to a valid screenshot name
 *
 * Examples:
 * - "/" -> "home"
 * - "/users" -> "users"
 * - "/users/[id]" -> "users-id"
 * - "/blog/[...slug]" -> "blog-rest"
 */
export function routeToScreenshotName(route: string): string {
  if (route === '/') {
    return 'home';
  }

  return route
    .replace(/^\//, '') // Remove leading slash
    .replace(/\//g, '-') // Replace slashes with dashes
    .replace(/\[([^\]]+)\]/g, '$1') // Remove brackets from dynamic segments
    .replace(/\.\.\./g, 'rest') // Handle rest params
    .replace(/[^a-zA-Z0-9-]/g, '-') // Replace other special chars
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/-$/, ''); // Remove trailing dash
}
