import * as esbuild from 'esbuild'
import copy from 'esbuild-plugin-copy'

// Build output from @radio-services/web package
await esbuild.build({
  entryPoints: ['packages/web/src/main.ts'],
  bundle: true,
  outfile: 'public/admin/app.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  minify: true,
  loader: {
    '.ts': 'ts',
  },
  plugins: [
    copy({
      resolveFrom: 'cwd',
      assets: [
        {
          from: ['packages/web/src/styles.css'],
          to: ['public/admin/app.css'],
        },
        {
          from: ['public/admin/index.html'],
          to: ['public/admin/index.html'],
        },
      ],
    }),
  ],
})
