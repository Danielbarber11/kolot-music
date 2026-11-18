import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

/**
 * Cloudflare Workers Static Assets has a 25 MiB per-file limit.
 * @huggingface/transformers automatically loads its matched ONNX Runtime WASM from jsDelivr CDN at runtime,
 * so excluding oversized ort-wasm-*.wasm binaries from dist/assets keeps client builds under ~5 MB.
 */
function excludeOversizedOnnxWasmPlugin(): Plugin {
  return {
    name: 'exclude-oversized-onnx-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.wasm') && fileName.includes('ort-wasm')) {
          delete bundle[fileName];
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), excludeOversizedOnnxWasmPlugin()],
    worker: {
      format: 'es' as const,
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
