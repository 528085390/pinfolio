import { Laptop, Server, KeyRound, Globe, Package } from 'lucide-react'

const MAP: Record<string, any> = {
  device: Laptop,
  server: Server,
  account: KeyRound,
  domain: Globe,
  other: Package,
}

export function KindIcon({ kind, size = 15 }: { kind: string; size?: number }) {
  const C = MAP[kind] || Package
  return <C size={size} />
}
