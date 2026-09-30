import { createHash } from 'node:crypto'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

function origin(url: string | undefined) {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// Adds a Content-Security-Policy meta tag to the built index.html. The page may
// only talk to itself, Supabase and n8n; the inline theme script is allowed by
// its hash. Build only - the dev server needs inline scripts for hot reload.
function contentSecurityPolicy(env: Record<string, string>): Plugin {
  return {
    name: 'ff-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const scriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
        )
        const connect = ["'self'", origin(env.VITE_SUPABASE_URL), origin(env.VITE_N8N_BASE_URL)]
          .filter(Boolean)
          .join(' ')
        const csp = [
          "default-src 'self'",
          `script-src 'self' ${scriptHashes.join(' ')}`,
          "style-src 'self'",
          "img-src 'self' data:",
          "font-src 'self'",
          `connect-src ${connect}`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ')
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        )
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), tailwindcss(), contentSecurityPolicy(env)],
  }
})
