// invoice-kit/register.js
//
// Same pattern as slip-kit/register.js — scoped @babel/register so the ESM+JSX
// files in this folder can be required from the CommonJS backend. Loaded by
// invoice.routes.js before it requires renderInvoice.

require('@babel/register')({
  only: [/invoice-kit/],
  extensions: ['.js', '.jsx'],
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'classic' }],
  ],
  babelrc: false,
  configFile: false,
  cache: true,
});
