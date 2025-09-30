const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  foundation,
  defaultThemes,
  defaultThemeRegistry,
  createTheme
} = require('../../dist/designTokens/index.js');

describe('foundation tokens', () => {
  it('exposes immutable palette ramps', () => {
    assert.equal(foundation.palette.violet[500], '#7c3aed');
    assert.equal(foundation.spacing.md, '0.75rem');
    assert.ok(Object.isFrozen(foundation.palette));
    assert.ok(Object.isFrozen(foundation.typography));
  });
});

describe('default themes', () => {
  it('registers the shipped light and dark themes', () => {
    assert.ok(defaultThemeRegistry['apphub-light']);
    assert.ok(defaultThemeRegistry['apphub-dark']);
    assert.equal(defaultThemes.light.scheme, 'light');
    assert.equal(defaultThemes.dark.scheme, 'dark');
  });
});

describe('createTheme', () => {
  it('deep merges overrides without mutating the base theme', () => {
    const base = defaultThemes.light;
    const originalCanvas = base.semantics.surface.canvas;

    const custom = createTheme({
      base,
      id: 'contrast-test',
      label: 'Contrast Test',
      overrides: {
        semantics: {
          surface: {
            canvas: '#ffffff'
          },
          text: {
            primary: '#0b1120'
          }
        }
      }
    });

    assert.equal(custom.id, 'contrast-test');
    assert.equal(custom.label, 'Contrast Test');
    assert.equal(custom.scheme, 'light');
    assert.equal(custom.semantics.surface.canvas, '#ffffff');
    assert.equal(custom.semantics.text.primary, '#0b1120');
    assert.equal(base.semantics.surface.canvas, originalCanvas);
    assert.ok(Object.isFrozen(custom));
    assert.ok(Object.isFrozen(custom.semantics.surface));
  });
});
