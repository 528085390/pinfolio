import { Laptop, Server, KeyRound, Globe, Package, Rss, Network } from 'lucide-react'

const MAP: Record<string, any> = {
  device: Laptop,
  server: Server,
  account: KeyRound,
  domain: Globe,
  node: Network,
  subscription: Rss,
  other: Package,
}

export function KindIcon({ kind, size = 15 }: { kind: string; size?: number }) {
  const C = MAP[kind] || Package
  return <C size={size} />
}
