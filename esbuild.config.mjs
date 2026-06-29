import * as esbuild from 'esbuild'
import copy from 'esbuild-plugin-copy'

await esbuild.build({
  entryPoints: ['src/web/main.ts'],
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
          from: ['src/web/styles.css'],
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
