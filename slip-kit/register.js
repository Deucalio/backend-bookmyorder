// slip-kit/register.js
//
// The slip-kit modules are authored in ESM + JSX (so they can share the exact
// same React-PDF layout the app uses). The backend itself is plain CommonJS,
// so we register @babel/register scoped to this folder only — every other
// backend file keeps loading natively with zero transform overhead.

require('@babel/register')({
  only: [/slip-kit/],
  extensions: ['.js', '.jsx'],
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'classic' }],
  ],
  babelrc: false,
  configFile: false,
  cache: true,
});
