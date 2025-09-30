const COLOR_CLASS_REGEX = /\b(?:bg|text|border|ring|stroke|fill)-(?:slate|gray|grey|blue|lightblue|darkblue|sky|violet|indigo|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald|teal|cyan|stone|neutral|zinc|warmgray|coolgray|truegray|black|white)(?:[-/][\w.-]+)?\b/gi;

function checkLiteral(context, node, value) {
  if (typeof value !== 'string') {
    return;
  }

  let match;
  while ((match = COLOR_CLASS_REGEX.exec(value)) !== null) {
    context.report({
      node,
      messageId: 'rawColorClass',
      data: {
        className: match[0]
      }
    });
  }
}

export default {
  meta: {
    name: 'semantic-tokens-plugin'
  },
  rules: {
    'no-raw-color-classnames': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Disallow Tailwind color utility classes in favour of semantic tokens or CSS variable-backed utilities.'
        },
        messages: {
          rawColorClass:
            'Replace Tailwind color utility "{{className}}" with a semantic token class or CSS variable backed utility.'
        }
      },
      create(context) {
        return {
          Literal(node) {
            checkLiteral(context, node, node.value);
          },
          TemplateLiteral(node) {
            if (node.expressions.length > 0) {
              return;
            }
            const text = node.quasis.map((quasi) => quasi.value.cooked ?? '').join('');
            checkLiteral(context, node, text);
          }
        };
      }
    }
  }
};
