import * as esbuild from 'esbuild'
import copy from 'esbuild-plugin-copy'

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/app.js',
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
          from: ['src/styles.css'],
          to: ['dist/app.css'],
        },
      ],
    }),
  ],
})
