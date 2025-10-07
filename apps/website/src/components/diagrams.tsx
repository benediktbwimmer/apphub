import type { FC, ReactNode } from 'react'

type NodeDefinition = {
  id: string
  label: string
  x: number
  y: number
  width?: number
  height?: number
}

type ConnectionDefinition = {
  from: string
  to: string
  dashed?: boolean
}

type AnnotationDefinition = {
  x: number
  y: number
  text: string
  align?: 'start' | 'middle' | 'end'
}

type DiagramSpec = {
  title: string
  nodes: NodeDefinition[]
  connections?: ConnectionDefinition[]
  annotations?: AnnotationDefinition[]
}

const frameWidth = 360
const frameHeight = 220
const nodeDefaultWidth = 92
const nodeDefaultHeight = 44
const connectionPadding = 8
const connectionStartInset = 4
const connectionArrowInset = 10

type NodeRect = {
  x: number
  y: number
  width: number
  height: number
}

const getNodeRect = (node: NodeDefinition): NodeRect => ({
  x: node.x,
  y: node.y,
  width: node.width ?? nodeDefaultWidth,
  height: node.height ?? nodeDefaultHeight
})

const getRectCenter = (rect: NodeRect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2
})

const projectToward = (fromRect: NodeRect, toCenter: { x: number; y: number }) => {
  const center = getRectCenter(fromRect)
  const dx = toCenter.x - center.x
  const dy = toCenter.y - center.y

  if (dx === 0 && dy === 0) {
    return center
  }

  const usableHalfWidth = Math.max(fromRect.width / 2 - connectionPadding, 0.01)
  const usableHalfHeight = Math.max(fromRect.height / 2 - connectionPadding, 0.01)
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : usableHalfWidth / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : usableHalfHeight / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)

  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale
  }
}

const DiagramSurface: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <svg
    role="img"
    aria-label={title}
    viewBox={`0 0 ${frameWidth} ${frameHeight}`}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="diagram-surface" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#01201e" />
        <stop offset="100%" stopColor="#062c2a" />
      </linearGradient>
      <linearGradient id="diagram-node" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="rgba(13, 148, 136, 0.38)" />
        <stop offset="100%" stopColor="rgba(13, 148, 136, 0.16)" />
      </linearGradient>
      <marker
        id="diagram-arrowhead"
        markerWidth="10"
        markerHeight="10"
        refX="7"
        refY="5"
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill="#5eead4" />
      </marker>
    </defs>
    <rect
      x="0.75"
      y="0.75"
      width={frameWidth - 1.5}
      height={frameHeight - 1.5}
      rx="22"
      fill="url(#diagram-surface)"
      stroke="rgba(94, 234, 212, 0.35)"
      strokeWidth="1.5"
    />
    <g>{children}</g>
  </svg>
)

const DiagramNode: FC<{ node: NodeDefinition }> = ({ node }) => {
  const width = node.width ?? nodeDefaultWidth
  const height = node.height ?? nodeDefaultHeight
  const cx = node.x + width / 2
  const cy = node.y + height / 2
  const lines = node.label.split('\n')
  const lineHeight = 16
  const firstLineY = cy - ((lines.length - 1) * lineHeight) / 2

  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={width}
        height={height}
        rx={14}
        fill="url(#diagram-node)"
        stroke="rgba(45, 212, 191, 0.65)"
        strokeWidth="1.5"
      />
      <rect
        x={node.x + 3}
        y={node.y + 3}
        width={width - 6}
        height={height - 6}
        rx={12}
        stroke="rgba(45, 212, 191, 0.28)"
        fill="transparent"
      />
      {lines.map((line, index) => (
        <text
          key={`${node.id}-line-${index}`}
          x={cx}
          y={firstLineY + index * lineHeight}
          fill="#ecfeff"
          fontSize="12"
          textAnchor="middle"
          dominantBaseline="middle"
          fontWeight={500}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

const renderConnections = (nodes: NodeDefinition[], connections?: ConnectionDefinition[]) => {
  if (!connections) return null
  const nodeMap = new Map(nodes.map((entry) => [entry.id, entry]))

  return connections.map((connection, index) => {
    const from = nodeMap.get(connection.from)
    const to = nodeMap.get(connection.to)
    if (!from || !to) return null

    const fromRect = getNodeRect(from)
    const toRect = getNodeRect(to)
    const fromCenter = getRectCenter(fromRect)
    const toCenter = getRectCenter(toRect)
    let start = projectToward(fromRect, toCenter)
    let end = projectToward(toRect, fromCenter)

    const dx = end.x - start.x
    const dy = end.y - start.y
    const distance = Math.hypot(dx, dy)

    if (distance > 0) {
      const ux = dx / distance
      const uy = dy / distance
      start = {
        x: start.x + ux * connectionStartInset,
        y: start.y + uy * connectionStartInset
      }
      end = {
        x: end.x - ux * connectionArrowInset,
        y: end.y - uy * connectionArrowInset
      }
    }

    return (
      <path
        key={`${connection.from}-${connection.to}-${index}`}
        d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`}
        stroke="rgba(94, 234, 212, 0.75)"
        strokeWidth="2"
        strokeDasharray={connection.dashed ? '6 6' : undefined}
        markerEnd="url(#diagram-arrowhead)"
        fill="none"
      />
    )
  })
}

const renderAnnotations = (annotations?: AnnotationDefinition[]) => {
  if (!annotations) return null
  return annotations.map((annotation, index) => (
    <text
      key={`annotation-${index}`}
      x={annotation.x}
      y={annotation.y}
      fill="rgba(125, 211, 252, 0.9)"
      fontSize="11"
      textAnchor={annotation.align ?? 'start'}
    >
      {annotation.text}
    </text>
  ))
}

const createDiagram = (spec: DiagramSpec): FC => {
  const DiagramComponent: FC = () => (
    <DiagramSurface title={spec.title}>
      {renderConnections(spec.nodes, spec.connections)}
      {renderAnnotations(spec.annotations)}
      {spec.nodes.map((node) => (
        <DiagramNode key={node.id} node={node} />
      ))}
    </DiagramSurface>
  )

  DiagramComponent.displayName = `${spec.title.replace(/\s+/g, '')}Diagram`
  return DiagramComponent
}

export const DataPlaneDiagram = createDiagram({
  title: 'Data plane flow',
  nodes: [
    { id: 'ingest', label: 'Ingestion\nWorkers', x: 20, y: 30 },
    { id: 'stream', label: 'Streaming\nFeeds', x: 136, y: 24 },
    { id: 'bus', label: 'Event\nBus', x: 252, y: 30 },
    { id: 'core', label: 'Workflows /\nJobs / Assets', x: 118, y: 90, width: 140, height: 68 },
    {
      id: 'timestore',
      label: 'Timestore\nStaging -> Parquet',
      x: 16,
      y: 164,
      width: 148,
      height: 52
    },
    {
      id: 'stores',
      label: 'Filestore +\nMetastore Events',
      x: 212,
      y: 164,
      width: 140,
      height: 52
    }
  ],
  connections: [
    { from: 'ingest', to: 'core' },
    { from: 'stream', to: 'core' },
    { from: 'core', to: 'bus' },
    { from: 'bus', to: 'core' },
    { from: 'core', to: 'timestore' },
    { from: 'core', to: 'stores' },
    { from: 'timestore', to: 'core', dashed: true },
    { from: 'stores', to: 'core', dashed: true },
    { from: 'bus', to: 'stores', dashed: true }
  ]
})

export const DeploymentOptionsDiagram = createDiagram({
  title: 'Deployment options',
  nodes: [
    { id: 'control', label: 'Control Plane', x: 130, y: 26, width: 120, height: 60 },
    { id: 'servers', label: 'Single\nMachine', x: 24, y: 134 },
    { id: 'cloud', label: 'Cloud\nKubernetes', x: 132, y: 148 },
    { id: 'hybrid', label: 'Hybrid\nEdge Sites', x: 240, y: 134 }
  ],
  connections: [
    { from: 'control', to: 'servers' },
    { from: 'control', to: 'cloud' },
    { from: 'control', to: 'hybrid' }
  ]
})

export const EventBusDiagram = createDiagram({
  title: 'Event bus coordination',
  nodes: [
    { id: 'producers', label: 'Module Jobs\n& Assets', x: 24, y: 40 },
    { id: 'bus', label: 'Event\nBus', x: 204, y: 36, width: 120, height: 52 },
    { id: 'workflows', label: 'Workflows', x: 24, y: 148 },
    { id: 'triggers', label: 'Triggers /\nSchedules', x: 204, y: 144, width: 120, height: 52 },
    { id: 'external', label: 'External\nSystems', x: 312, y: 92 }
  ],
  connections: [
    { from: 'producers', to: 'bus' },
    { from: 'bus', to: 'workflows' },
    { from: 'bus', to: 'triggers' },
    { from: 'bus', to: 'external' },
    { from: 'triggers', to: 'bus', dashed: true },
    { from: 'external', to: 'bus', dashed: true }
  ]
})

export const ModuleLifecycleDiagram = createDiagram({
  title: 'Module lifecycle',
  nodes: [
    { id: 'design', label: 'Scope\nWorkflows & Assets', x: 24, y: 44, width: 140, height: 68 },
    { id: 'develop', label: 'Build\nModule Bundle', x: 224, y: 44, width: 136, height: 68 },
    { id: 'deploy', label: 'Operate &\nObserve', x: 224, y: 156, width: 136, height: 68 },
    { id: 'evolve', label: 'Evolve\nVersion', x: 24, y: 156, width: 140, height: 68 }
  ],
  connections: [
    { from: 'design', to: 'develop' },
    { from: 'develop', to: 'deploy' },
    { from: 'deploy', to: 'evolve' },
    { from: 'evolve', to: 'design', dashed: true }
  ]
})

export const ObservatoryFlowDiagram = createDiagram({
  title: 'Observatory data flow',
  nodes: [
    { id: 'sensors', label: 'Field\nSensors', x: 20, y: 112, width: 88, height: 48 },
    { id: 'gateway', label: 'Gateway /\nEvent Bus', x: 128, y: 24, width: 112, height: 52 },
    { id: 'jobs', label: 'Module Jobs\n& Workflows', x: 118, y: 96, width: 140, height: 64 },
    { id: 'filestore', label: 'Filestore\nInventory', x: 16, y: 164, width: 104, height: 48 },
    { id: 'metastore', label: 'Metastore\nDocuments', x: 132, y: 164, width: 112, height: 48 },
    { id: 'timestore', label: 'Timestore\nParquet', x: 248, y: 164, width: 104, height: 48 },
    { id: 'ui', label: 'UI Graph\nDashboards', x: 252, y: 32, width: 96, height: 56 }
  ],
  connections: [
    { from: 'sensors', to: 'gateway' },
    { from: 'gateway', to: 'jobs' },
    { from: 'jobs', to: 'filestore' },
    { from: 'jobs', to: 'metastore' },
    { from: 'jobs', to: 'timestore' },
    { from: 'gateway', to: 'ui' },
    { from: 'timestore', to: 'ui', dashed: true },
    { from: 'filestore', to: 'jobs', dashed: true },
    { from: 'metastore', to: 'jobs', dashed: true }
  ]
})

export const SystemArchitectureDiagram = createDiagram({
  title: 'System architecture overview',
  nodes: [
    { id: 'ui', label: 'Unified\nUI', x: 24, y: 24, width: 96, height: 56 },
    { id: 'gateway', label: 'API\nGateway', x: 132, y: 24, width: 96, height: 56 },
    { id: 'workflows', label: 'Workflows\n& Jobs', x: 240, y: 24, width: 108, height: 60 },
    { id: 'bus', label: 'Event\nBus', x: 134, y: 96, width: 112, height: 64 },
    { id: 'filestore', label: 'Filestore', x: 24, y: 168, width: 96, height: 56 },
    { id: 'timestore', label: 'Timestore', x: 134, y: 168, width: 96, height: 56 },
    { id: 'metastore', label: 'Metastore', x: 244, y: 168, width: 96, height: 56 }
  ],
  connections: [
    { from: 'ui', to: 'gateway' },
    { from: 'gateway', to: 'workflows' },
    { from: 'gateway', to: 'bus' },
    { from: 'workflows', to: 'bus' },
    { from: 'bus', to: 'filestore' },
    { from: 'bus', to: 'timestore' },
    { from: 'bus', to: 'metastore' },
    { from: 'filestore', to: 'bus', dashed: true },
    { from: 'timestore', to: 'bus', dashed: true },
    { from: 'metastore', to: 'bus', dashed: true }
  ]
})

export const UiGraphDiagram = createDiagram({
  title: 'UI graph highlights',
  nodes: [
    { id: 'workflows', label: 'Graph View\nWorkflows', x: 24, y: 108 },
    { id: 'assets', label: 'Assets &\nLineage', x: 132, y: 36 },
    { id: 'sql', label: 'SQL +\nAnalytics', x: 240, y: 108 },
    { id: 'status', label: 'Streaming\nStatus', x: 132, y: 178 }
  ],
  connections: [
    { from: 'assets', to: 'workflows' },
    { from: 'assets', to: 'sql' },
    { from: 'workflows', to: 'status' },
    { from: 'sql', to: 'status', dashed: true }
  ]
})

export const BusinessConstellationDiagram = createDiagram({
  title: 'Business constellation',
  nodes: [
    { id: 'platform', label: 'AppHub\nPlatform', x: 130, y: 30, width: 120, height: 68 },
    { id: 'leadership', label: 'Leadership', x: 20, y: 162 },
    { id: 'operations', label: 'Operations', x: 140, y: 174 },
    { id: 'engineering', label: 'Engineering', x: 260, y: 162 }
  ],
  connections: [
    { from: 'platform', to: 'leadership' },
    { from: 'platform', to: 'operations' },
    { from: 'platform', to: 'engineering' },
    { from: 'leadership', to: 'operations', dashed: true },
    { from: 'operations', to: 'engineering', dashed: true }
  ]
})

export const BusinessObservatoryDiagram = createDiagram({
  title: 'Observatory programme',
  nodes: [
    { id: 'telemetry', label: 'Telemetry\nFeeds', x: 20, y: 120 },
    { id: 'module', label: 'Module\nServices', x: 128, y: 52 },
    { id: 'governance', label: 'Governance', x: 236, y: 120 },
    { id: 'dashboards', label: 'Dashboards', x: 128, y: 176 }
  ],
  connections: [
    { from: 'telemetry', to: 'module' },
    { from: 'module', to: 'governance' },
    { from: 'module', to: 'dashboards' },
    { from: 'governance', to: 'dashboards' }
  ]
})

export const AdoptionJourneyDiagram = createDiagram({
  title: 'Adoption journey',
  nodes: [
    { id: 'frame', label: 'Frame\nModule', x: 24, y: 52 },
    { id: 'lab', label: 'Co-build\n& Teach', x: 132, y: 120 },
    { id: 'launch', label: 'Launch\nRunbooks', x: 240, y: 52 },
    { id: 'expand', label: 'Expand\nModules', x: 132, y: 188 }
  ],
  connections: [
    { from: 'frame', to: 'lab' },
    { from: 'lab', to: 'launch' },
    { from: 'launch', to: 'expand' },
    { from: 'expand', to: 'frame', dashed: true }
  ]
})
export const EventFlowDiagram = createDiagram({
  title: 'Event-driven flow',
  nodes: [
    { id: 'sources', label: 'Module\nJobs', x: 20, y: 92 },
    { id: 'router', label: 'Event\nRouter', x: 128, y: 52 },
    { id: 'bus', label: 'Redis +\nBullMQ Bus', x: 236, y: 92, width: 120, height: 52 },
    { id: 'workflows', label: 'Workflows', x: 128, y: 164 },
    { id: 'metrics', label: 'Metrics &\nAlerts', x: 236, y: 164 }
  ],
  connections: [
    { from: 'sources', to: 'router' },
    { from: 'router', to: 'bus' },
    { from: 'bus', to: 'workflows' },
    { from: 'workflows', to: 'metrics' },
    { from: 'metrics', to: 'router', dashed: true }
  ]
})

export const FilestoreStackDiagram = createDiagram({
  title: 'Filestore stack',
  nodes: [
    { id: 'clients', label: 'Workers &\nModules', x: 24, y: 132 },
    { id: 'api', label: 'Filestore\nAPI', x: 132, y: 52 },
    { id: 'ledger', label: 'Metadata\nLedger & Events', x: 240, y: 132, width: 120, height: 60 },
    { id: 'storage', label: 'Object\nStorage', x: 132, y: 196 }
  ],
  connections: [
    { from: 'clients', to: 'api' },
    { from: 'api', to: 'ledger' },
    { from: 'api', to: 'storage' },
    { from: 'ledger', to: 'clients', dashed: true },
    { from: 'ledger', to: 'storage', dashed: true }
  ]
})

export const ObservabilityDiagram = createDiagram({
  title: 'Observability signals',
  nodes: [
    { id: 'workers', label: 'Queues &\nWorkers', x: 26, y: 54 },
    { id: 'metrics', label: 'Metrics', x: 134, y: 18, width: 96, height: 48 },
    { id: 'logs', label: 'Structured\nLogs', x: 134, y: 98 },
    { id: 'traces', label: 'Traces', x: 134, y: 178 },
    { id: 'dash', label: 'Dashboards', x: 242, y: 54 },
    { id: 'alerts', label: 'Alerts', x: 242, y: 154 }
  ],
  connections: [
    { from: 'workers', to: 'metrics' },
    { from: 'workers', to: 'logs' },
    { from: 'workers', to: 'traces' },
    { from: 'metrics', to: 'dash' },
    { from: 'logs', to: 'dash' },
    { from: 'metrics', to: 'alerts' },
    { from: 'traces', to: 'alerts', dashed: true }
  ]
})

export const TechnicalArchitectureDiagram = createDiagram({
  title: 'Technical architecture',
  nodes: [
    { id: 'gateway', label: 'API Gateway', x: 28, y: 40 },
    { id: 'scheduler', label: 'Scheduler', x: 140, y: 24 },
    { id: 'worker', label: 'Workers', x: 252, y: 40 },
    { id: 'storage', label: 'Storage\nAdapters', x: 28, y: 152 },
    { id: 'catalog', label: 'Metadata\nCatalog', x: 140, y: 180 },
    { id: 'observability', label: 'Observability\nStack', x: 252, y: 152 }
  ],
  connections: [
    { from: 'gateway', to: 'scheduler' },
    { from: 'scheduler', to: 'worker' },
    { from: 'worker', to: 'storage' },
    { from: 'worker', to: 'observability' },
    { from: 'storage', to: 'catalog' },
    { from: 'catalog', to: 'gateway' }
  ]
})

export const TimestoreStackDiagram = createDiagram({
  title: 'Timestore stack',
  nodes: [
    { id: 'ingest', label: 'Ingest\nJobs', x: 24, y: 124 },
    { id: 'duckdb', label: 'DuckDB\nPlanner', x: 132, y: 44 },
    { id: 'parquet', label: 'Parquet\nPartitions', x: 240, y: 124 },
    { id: 'sql', label: 'ANSI SQL\nAPI', x: 132, y: 196 }
  ],
  connections: [
    { from: 'ingest', to: 'duckdb' },
    { from: 'duckdb', to: 'parquet' },
    { from: 'duckdb', to: 'sql' },
    { from: 'sql', to: 'parquet', dashed: true }
  ]
})
