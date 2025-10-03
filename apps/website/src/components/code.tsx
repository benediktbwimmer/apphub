import { useMemo } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-typescript'
import './code.css'

export type CodeSnippetProps = {
  code: string
  language?: string
  highlightLines?: number[]
  caption?: string
}

const normalizeLanguage = (language?: string) => {
  if (!language) return 'typescript'
  const lower = language.toLowerCase()
  if (lower === 'ts') return 'typescript'
  if (lower === 'tsx') return 'tsx'
  if (lower === 'js') return 'javascript'
  return lower
}

export const CodeSnippet = ({ code, language, highlightLines, caption }: CodeSnippetProps) => {
  const normalisedLanguage = normalizeLanguage(language)
  const highlightedLines = useMemo(() => new Set(highlightLines ?? []), [highlightLines])

  const segments = useMemo(() => {
    const trimmed = code.replace(/\r\n/g, '\n').trim()
    const grammar = Prism.languages[normalisedLanguage] ?? Prism.languages.typescript
    const highlighted = Prism.highlight(trimmed, grammar, normalisedLanguage)
    return highlighted.split('\n').map((content, index) => ({
      content: content.length > 0 ? content : '&nbsp;',
      highlighted: highlightedLines.has(index + 1)
    }))
  }, [code, normalisedLanguage, highlightedLines])

  return (
    <figure className="code-snippet">
      <pre className="code-snippet__pre" aria-label={`${normalisedLanguage} code example`}>
        <code className={`language-${normalisedLanguage}`}>
          {segments.map((segment, index) => (
            <span
              key={`line-${index}`}
              className={`code-snippet__line${segment.highlighted ? ' is-highlighted' : ''}`}
            >
              <span
                className="code-snippet__code"
                dangerouslySetInnerHTML={{ __html: segment.content }}
              />
            </span>
          ))}
        </code>
      </pre>
      {caption ? <figcaption className="code-snippet__caption">{caption}</figcaption> : null}
    </figure>
  )
}
